/**
 * 책 읽기 기록 저장소. 기록은 Dropbox 의 `ebook/.reading/<파일명>.json` 에 책마다 따로 저장한다.
 * 노트 파일과는 섞이지 않으므로 노트 기능에는 영향이 없다.
 */
import { writable, get } from 'svelte/store';
import { downloadFile, DropboxApiError, listFolder, uploadText } from '../lib/dropbox/api';
import { bookKind, emptyState, parseState, type Book, type ReadingState } from '../lib/ebook/state';
import { statusMessage } from './note';

export const BOOK_DIR = 'ebook';

/** 책별 읽기 기록 (파일명 → 기록) */
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

function statePath(root: string, name: string): string {
  return `${root}/${BOOK_DIR}/.reading/${name}.json`;
}

/** ebook/ 폴더의 EPUB·PDF 목록 (폴더가 없으면 빈 목록). */
export async function listBooks(root: string): Promise<Book[]> {
  const entries = await listFolder(`${root}/${BOOK_DIR}`);
  const books: Book[] = [];
  for (const e of entries) {
    if (e.type !== 'file') continue;
    const kind = bookKind(e.name);
    if (kind) books.push({ name: e.name, path: e.path, kind });
  }
  return books.sort((a, b) => a.name.localeCompare(b.name));
}

function isWriteLimit(e: unknown): boolean {
  return e instanceof DropboxApiError && e.status === 429;
}

async function save(root: string, name: string, tries = 0): Promise<void> {
  const state = get(readingStates)[name];
  if (!state) return;
  const json = JSON.stringify(state, null, 2);
  if (saved.get(name) === json) return;
  // 한 파일에는 한 번에 하나만 쓴다. 쓰는 중에 바뀌었으면 끝난 뒤 한 번 더 쓴다.
  if (inFlight.has(name)) {
    dirty.add(name);
    return;
  }
  inFlight.add(name);
  try {
    await uploadText(statePath(root, name), json, 'overwrite');
    saved.set(name, json);
  } catch (e) {
    if (isWriteLimit(e) && tries < MAX_TRIES) {
      inFlight.delete(name);
      await new Promise((r) => setTimeout(r, 1000 * 2 ** tries));
      return save(root, name, tries + 1);
    }
    statusMessage.set('읽기 기록 저장 실패: ' + (e instanceof Error ? e.message : String(e)));
  } finally {
    inFlight.delete(name);
  }
  if (dirty.delete(name)) void save(root, name);
}

function scheduleSave(root: string, name: string) {
  const old = pending.get(name);
  if (old) clearTimeout(old.timer);
  const timer = setTimeout(() => {
    pending.delete(name);
    void save(root, name);
  }, SAVE_DELAY);
  pending.set(name, { root, timer });
}

/** 기록을 바꾸고 저장을 예약한다. */
export function setState(root: string, next: ReadingState): void {
  readingStates.update((all) => ({ ...all, [next.name]: next }));
  scheduleSave(root, next.name);
}

export function getState(name: string): ReadingState | undefined {
  return get(readingStates)[name];
}

/** 목록의 책마다 기록을 읽는다. 기록 파일이 없으면 지금을 처음 본 날짜로 만들어 바로 저장한다. */
export async function loadStates(root: string, books: Book[]): Promise<void> {
  const now = new Date().toISOString();
  const loaded = await Promise.all(
    books.map(async (b) => {
      const dl = await downloadFile(statePath(root, b.name)).catch(() => null);
      const state = dl ? parseState(dl.content, b.name, now) : emptyState(b.name, now);
      return { name: b.name, state, isNew: !dl };
    }),
  );
  readingStates.update((all) => ({
    ...all,
    ...Object.fromEntries(loaded.map((l) => [l.name, l.state])),
  }));
  for (const l of loaded) if (l.isNew) scheduleSave(root, l.name);
}

/** 예약된 저장을 모두 바로 보낸다 (창을 닫기 전에). */
export function flushStates(): void {
  for (const [name, p] of pending) {
    clearTimeout(p.timer);
    void save(p.root, name);
  }
  pending.clear();
}

if (typeof window !== 'undefined') {
  window.addEventListener('pagehide', flushStates);
}
