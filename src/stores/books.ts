/**
 * 책 목록과 읽기 기록 저장소.
 *
 * 책은 선택한 폴더와 그 하위 폴더 전부에서 찾는다. 기록은 책마다 따로
 * `<폴더>/.ebook-reading/<상대 경로>.json` 에 저장하므로 원래 파일들과 섞이지 않는다.
 */
import { writable, get } from 'svelte/store';
import {
  createFolder,
  deleteFile,
  downloadFile,
  DropboxApiError,
  listFolder,
  moveFile,
  uploadText,
} from '../lib/dropbox/api';
import { bookKind, emptyState, parseState, type Book, type ReadingState } from '../lib/ebook/state';
import { crashPath, isConflict } from '../lib/ebook/conflict';
import { legacyRecordName, recordName } from '../lib/ebook/paths';
import { statusMessage } from './note';
import { toRelative } from './vault';
import { notePath } from './bookNotes';

export const STATE_DIR = '.ebook-reading';

/** 책별 읽기 기록 (상대 경로 → 기록) */
export const readingStates = writable<Record<string, ReadingState>>({});

// 같은 파일에 짧은 시간 안에 여러 번 쓰면 Dropbox 가 429 로 막으므로 넉넉히 모아서 쓴다
// 기록은 바뀔 때마다 쓰지 않는다. 책을 닫거나 창을 숨길 때 보내고, 그 사이에는 5분마다 자동으로 보낸다.
const AUTOSAVE_MS = 5 * 60 * 1000;
const MAX_TRIES = 4;
/** 마지막으로 저장에 성공한 내용 (같으면 다시 쓰지 않는다) */
const saved = new Map<string, string>();
/** 지금 저장 중인 책 (끝난 뒤 다시 저장해야 하면 dirty) */
const inFlight = new Set<string>();
const dirty = new Set<string>();
/** 읽기가 확인된 책 (기록 파일이 있었거나 새로 만든 책). 여기에 없으면 저장하지 않는다. */
const known = new Set<string>();
/** 마지막으로 읽거나 쓴 파일 버전. 저장할 때 이 버전과 같을 때만 덮어쓴다. */
const revs = new Map<string, string>();

/**
 * 다른 기기나 탭이 먼저 저장한 파일을 `_crashed_yymmddHHMM` 복사본으로 남긴다.
 * 그다음 현재 상태를 최신 파일로 저장한다.
 */
async function keepConflict(root: string, rel: string, json: string): Promise<void> {
  const current = await downloadFile(statePath(root, rel));
  if (current) {
    const copy = crashPath(statePath(root, rel), '.json');
    await uploadText(copy, current.content, 'add');
  }
  const res = await uploadText(statePath(root, rel), json, 'overwrite');
  revs.set(rel, res.rev);
  saved.set(rel, json);
  statusMessage.set('다른 곳에서 함께 수정되어, 이전 버전을 _crashed 파일로 보관했습니다.');
}
/** 저장하지 않은 변경이 있는 책 (상대 경로 → 폴더 경로) */
const pending = new Map<string, string>();

/** 폴더 경로 끝의 `/` 를 떼어 이어 붙이기 쉽게 한다 ('/' 는 빈 문자열). */
function base(root: string): string {
  return root.replace(/\/+$/, '');
}

function statePath(root: string, rel: string): string {
  return `${base(root)}/${STATE_DIR}/${recordName(rel)}.json`;
}

function legacyEncodedStatePath(root: string, rel: string): string {
  return `${base(root)}/${STATE_DIR}/${legacyRecordName(rel)}.json`;
}

/** 이전 버전이 `ebook/` 폴더 안에 남긴 기록 위치 (그 폴더 바로 아래 책만 해당) */
function legacyStatePath(root: string, rel: string): string | null {
  const m = /^ebook\/([^/]+)$/.exec(rel);
  return m ? `${base(root)}/ebook/.reading/${m[1]}.json` : null;
}

/** 썸네일 파일 경로 (목록과 서재에서 함께 쓴다. 작아서 빨리 받는다) */
export function thumbPath(root: string, rel: string): string {
  return `${base(root)}/${STATE_DIR}/${recordName(rel)}.thumb.jpg`;
}

/** 기록 폴더에서 마지막으로 본 파일 이름들. 썸네일이 있는지 요청 없이 확인하는 데 쓴다. */
let folderNames = new Set<string>();

function thumbName(rel: string): string {
  return `${recordName(rel)}.thumb.jpg`;
}

export function hasThumb(rel: string): boolean {
  return folderNames.has(thumbName(rel));
}

export function markThumb(rel: string): void {
  folderNames.add(thumbName(rel));
}

export interface Library {
  books: Book[];
  /** 하위 폴더 경로 목록 (책이 없는 서가도 포함) */
  folders: string[];
}

/** 선택한 폴더와 하위 폴더의 EPUB·PDF 목록과 서가(하위 폴더) 목록. 숨김 항목은 건너뛴다. */
export async function listBooks(root: string): Promise<Library> {
  const entries = await listFolder(root, true);
  const books: Book[] = [];
  const folders: string[] = [];
  for (const e of entries) {
    const rel = toRelative(root, e.path);
    const parts = rel.split('/');
    if (!rel || parts.some((p) => p.startsWith('.'))) continue;
    if (e.type === 'folder') {
      folders.push(rel);
      continue;
    }
    const kind = bookKind(e.name);
    if (!kind) continue;
    books.push({ name: e.name, rel, folder: parts.slice(0, -1).join('/'), path: e.path, kind });
  }
  return {
    books: books.sort((a, b) => a.rel.localeCompare(b.rel, 'ko')),
    folders: folders.sort((a, b) => a.localeCompare(b, 'ko')),
  };
}

/** 서가(폴더)를 만든다. parent 가 빈 문자열이면 선택한 폴더 바로 아래에 만든다. */
export async function createShelf(root: string, parent: string, name: string): Promise<string> {
  const rel = parent ? `${parent}/${name}` : name;
  await createFolder(`${base(root)}/${rel}`);
  return rel;
}

/**
 * 책을 다른 서가로 옮긴다. 기록과 표지도 새 경로로 함께 옮긴다.
 * 옮긴 뒤의 책 정보를 돌려준다.
 */
export async function moveBook(root: string, book: Book, folder: string): Promise<Book> {
  const destRel = folder ? `${folder}/${book.name}` : book.name;
  const destPath = `${base(root)}/${destRel}`;
  if (destRel === book.rel) return book;

  // 저장하지 않은 기록은 옮기기 전에 먼저 보내고, 이전 이름의 저장은 빼 둔다
  if (pending.has(book.rel)) await save(root, book.rel);
  pending.delete(book.rel);

  await moveFile(book.path, destPath);
  await moveFile(thumbPath(root, book.rel), thumbPath(root, destRel)).catch(() => {});
  if (hasThumb(book.rel)) markThumb(destRel);
  await moveFile(notePath(root, book.rel), notePath(root, destRel)).catch(() => {});

  const st = get(readingStates)[book.rel];
  if (st) {
    readingStates.update((all) => {
      const { [book.rel]: _old, ...rest } = all;
      return { ...rest, [destRel]: { ...st, name: destRel } };
    });
    markDirty(root, destRel);
  }
  await deleteFile(statePath(root, book.rel)).catch(() => {});
  saved.delete(book.rel);
  revs.delete(book.rel);
  if (known.has(book.rel)) known.add(destRel);
  known.delete(book.rel);
  return { ...book, rel: destRel, folder, path: destPath };
}

function isWriteLimit(e: unknown): boolean {
  return e instanceof DropboxApiError && e.status === 429;
}

async function save(root: string, rel: string, tries = 0): Promise<void> {
  const state = get(readingStates)[rel];
  // 기록을 제대로 읽지 못한 책은 빈 기록으로 덮어쓰지 않는다
  if (!state || !known.has(rel)) return;
  const json = JSON.stringify(state, null, 2);
  if (saved.get(rel) === json) return;
  // 한 파일에는 한 번에 하나만 쓴다. 쓰는 중에 바뀌었으면 끝난 뒤 한 번 더 쓴다.
  if (inFlight.has(rel)) {
    dirty.add(rel);
    return;
  }
  inFlight.add(rel);
  try {
    const rev = revs.get(rel);
    if (rev) {
      // 읽은 버전이 그대로일 때만 덮어쓴다. 바뀌었으면 충돌로 처리한다.
      const res = await uploadText(statePath(root, rel), json, { update: rev });
      revs.set(rel, res.rev);
      saved.set(rel, json);
    } else {
      const res = await uploadText(statePath(root, rel), json, 'overwrite');
      revs.set(rel, res.rev);
      saved.set(rel, json);
    }
  } catch (e) {
    if (isConflict(e) && revs.has(rel)) {
      try {
        await keepConflict(root, rel, json);
      } catch (err) {
        statusMessage.set('읽기 기록 저장 실패: ' + (err instanceof Error ? err.message : String(err)));
      }
    } else if (isWriteLimit(e) && tries < MAX_TRIES) {
      inFlight.delete(rel);
      await new Promise((r) => setTimeout(r, 1000 * 2 ** tries));
      return save(root, rel, tries + 1);
    }
    statusMessage.set('읽기 기록 저장 실패: ' + (e instanceof Error ? e.message : String(e)));
  } finally {
    inFlight.delete(rel);
  }
  if (dirty.delete(rel)) void save(root, rel);
}

/** 저장하지 않은 변경으로 표시한다. 실제 저장은 책을 닫을 때, 창을 숨길 때, 5분마다 일어난다. */
function markDirty(root: string, rel: string) {
  pending.set(rel, root);
}

/** 기록을 바꾸고 저장 대기열에 넣는다. */
export function setState(root: string, next: ReadingState): void {
  readingStates.update((all) => ({ ...all, [next.name]: next }));
  markDirty(root, next.name);
}

export function getState(rel: string): ReadingState | undefined {
  return get(readingStates)[rel];
}

/**
 * 폴더의 파일 이름 목록. 목록을 못 받으면 예외를 던진다 (빈 목록으로 보고 덮어쓰지 않도록).
 */
async function listNames(dir: string): Promise<Set<string>> {
  const entries = await listFolder(dir);
  return new Set(entries.filter((e) => e.type === 'file').map((e) => e.name));
}

/**
 * 책마다 기록을 읽는다. 기록 폴더 목록을 한 번 받아서 있는 파일만 내려받는다.
 * 기록이 없는 책은 요청 없이 새 기록을 만든다. 읽기에 실패한 책은 건드리지 않는다.
 */
export async function loadStates(root: string, books: Book[]): Promise<void> {
  const now = new Date().toISOString();
  const names = await listNames(`${base(root)}/${STATE_DIR}`);
  folderNames = names;
  const legacyNames = books.some((b) => b.rel.startsWith('ebook/'))
    ? await listNames(`${base(root)}/ebook/.reading`)
    : new Set<string>();

  let failed = 0;
  const newlyKnown: string[] = [];
  const created: string[] = [];
  await Promise.all(
    books.map(async (b) => {
      try {
        // 새 이름 → 예전 인코딩 이름 → 가장 예전 위치 순서로 찾는다
        const current = `${recordName(b.rel)}.json`;
        const encoded = `${legacyRecordName(b.rel)}.json`;
        const oldest = legacyStatePath(root, b.rel);
        let raw: string | null = null;
        if (names.has(current)) {
          const dl = await downloadFile(statePath(root, b.rel));
          if (dl) {
            revs.set(b.rel, dl.rev);
            raw = dl.content;
          }
        } else if (names.has(encoded)) {
          const dl = await downloadFile(legacyEncodedStatePath(root, b.rel));
          raw = dl ? dl.content : null;
        } else if (oldest && legacyNames.has(oldest.split('/').pop() ?? '')) {
          const dl = await downloadFile(oldest);
          raw = dl ? dl.content : null;
        }
        const state = raw !== null ? parseState(raw, b.rel, now) : emptyState(b.rel, now);
        readingStates.update((all) => ({ ...all, [b.rel]: state }));
        newlyKnown.push(b.rel);
        if (raw === null) created.push(b.rel);
      } catch {
        // 읽기에 실패한 책은 기존 기록을 그대로 두고, 저장도 하지 않는다
        failed++;
      }
    }),
  );
  if (failed > 0) {
    statusMessage.set('일부 책의 읽기 기록을 불러오지 못했습니다. 목록을 새로고침해 주세요.');
  }
  for (const rel of newlyKnown) known.add(rel);
  for (const rel of created) markDirty(root, rel);
}

/** 저장하지 않은 기록을 모두 보낸다 (책을 닫을 때, 창을 숨길 때). */
export function flushStates(): void {
  for (const [rel, root] of pending) {
    pending.delete(rel);
    void save(root, rel);
  }
}

if (typeof window !== 'undefined') {
  setInterval(flushStates, AUTOSAVE_MS);
  window.addEventListener('pagehide', flushStates);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flushStates();
  });
}
