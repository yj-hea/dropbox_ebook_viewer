/**
 * 책 목록과 읽기 기록 저장소.
 *
 * 책은 선택한 폴더와 그 하위 폴더 전부에서 찾는다. 기록은 책마다 따로
 * `<폴더>/.ebook-reading/<상대 경로>.json` 에 저장하므로 원래 파일들과 섞이지 않는다.
 */
import { writable, get } from 'svelte/store';
import { downloadFile, DropboxApiError, listFolder, uploadText } from '../lib/dropbox/api';
import { bookKind, emptyState, parseState, type Book, type ReadingState } from '../lib/ebook/state';
import { statusMessage } from './note';
import { toRelative } from './vault';

export const STATE_DIR = '.ebook-reading';

/** 책별 읽기 기록 (상대 경로 → 기록) */
export const readingStates = writable<Record<string, ReadingState>>({});

// 같은 파일에 짧은 시간 안에 여러 번 쓰면 Dropbox 가 429 로 막으므로 넉넉히 모아서 쓴다
const SAVE_DELAY = 2000;
const MAX_TRIES = 4;
/** 마지막으로 저장에 성공한 내용 (같으면 다시 쓰지 않는다) */
const saved = new Map<string, string>();
/** 지금 저장 중인 책 (끝난 뒤 다시 저장해야 하면 dirty) */
const inFlight = new Set<string>();
const dirty = new Set<string>();
const pending = new Map<string, { root: string; timer: ReturnType<typeof setTimeout> }>();

function statePath(root: string, rel: string): string {
  return `${root}/${STATE_DIR}/${encodeURIComponent(rel)}.json`;
}

/** 이전 버전이 `ebook/` 폴더 안에 남긴 기록 위치 (그 폴더 바로 아래 책만 해당) */
function legacyStatePath(root: string, rel: string): string | null {
  const m = /^ebook\/([^/]+)$/.exec(rel);
  return m ? `${root}/ebook/.reading/${m[1]}.json` : null;
}

export function coverPath(root: string, rel: string): string {
  return `${root}/${STATE_DIR}/${encodeURIComponent(rel)}.cover.jpg`;
}

/** 선택한 폴더와 하위 폴더의 EPUB·PDF 목록. 숨김 폴더(이름이 `.`로 시작)는 건너뛴다. */
export async function listBooks(root: string): Promise<Book[]> {
  const entries = await listFolder(root, true);
  const books: Book[] = [];
  for (const e of entries) {
    if (e.type !== 'file') continue;
    const kind = bookKind(e.name);
    if (!kind) continue;
    const rel = toRelative(root, e.path);
    const parts = rel.split('/');
    if (parts.some((p) => p.startsWith('.'))) continue;
    books.push({ name: e.name, rel, folder: parts.slice(0, -1).join('/'), path: e.path, kind });
  }
  return books.sort((a, b) => a.rel.localeCompare(b.rel, 'ko'));
}

function isWriteLimit(e: unknown): boolean {
  return e instanceof DropboxApiError && e.status === 429;
}

async function save(root: string, rel: string, tries = 0): Promise<void> {
  const state = get(readingStates)[rel];
  if (!state) return;
  const json = JSON.stringify(state, null, 2);
  if (saved.get(rel) === json) return;
  // 한 파일에는 한 번에 하나만 쓴다. 쓰는 중에 바뀌었으면 끝난 뒤 한 번 더 쓴다.
  if (inFlight.has(rel)) {
    dirty.add(rel);
    return;
  }
  inFlight.add(rel);
  try {
    await uploadText(statePath(root, rel), json, 'overwrite');
    saved.set(rel, json);
  } catch (e) {
    if (isWriteLimit(e) && tries < MAX_TRIES) {
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

function scheduleSave(root: string, rel: string) {
  const old = pending.get(rel);
  if (old) clearTimeout(old.timer);
  const timer = setTimeout(() => {
    pending.delete(rel);
    void save(root, rel);
  }, SAVE_DELAY);
  pending.set(rel, { root, timer });
}

/** 기록을 바꾸고 저장을 예약한다. */
export function setState(root: string, next: ReadingState): void {
  readingStates.update((all) => ({ ...all, [next.name]: next }));
  scheduleSave(root, next.name);
}

export function getState(rel: string): ReadingState | undefined {
  return get(readingStates)[rel];
}

async function readStateFile(root: string, rel: string): Promise<string | null> {
  const dl = await downloadFile(statePath(root, rel)).catch(() => null);
  if (dl) return dl.content;
  const legacy = legacyStatePath(root, rel);
  if (!legacy) return null;
  const old = await downloadFile(legacy).catch(() => null);
  return old ? old.content : null;
}

/** 목록의 책마다 기록을 읽는다. 기록 파일이 없으면 지금을 처음 본 날짜로 만들어 바로 저장한다. */
export async function loadStates(root: string, books: Book[]): Promise<void> {
  const now = new Date().toISOString();
  const loaded = await Promise.all(
    books.map(async (b) => {
      const raw = await readStateFile(root, b.rel);
      const state = raw !== null ? parseState(raw, b.rel, now) : emptyState(b.rel, now);
      return { rel: b.rel, state, isNew: raw === null };
    }),
  );
  readingStates.update((all) => ({
    ...all,
    ...Object.fromEntries(loaded.map((l) => [l.rel, l.state])),
  }));
  for (const l of loaded) if (l.isNew) scheduleSave(root, l.rel);
}

/** 예약된 저장을 모두 바로 보낸다 (창을 닫기 전에). */
export function flushStates(): void {
  for (const [rel, p] of pending) {
    clearTimeout(p.timer);
    void save(p.root, rel);
  }
  pending.clear();
}

if (typeof window !== 'undefined') {
  window.addEventListener('pagehide', flushStates);
}
