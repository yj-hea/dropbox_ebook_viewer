/**
 * 책 읽기 기록의 순수 로직 (화면·네트워크와 무관).
 *
 * 한 권의 기록: 처음 본 날짜, 마지막 위치, 열고 닫은 기록(세션), 하이라이트·메모.
 */

export type BookKind = 'epub' | 'pdf';

export interface Book {
  /** 파일명 (예: `책.epub`) */
  name: string;
  /** 폴더 기준 상대 경로 (예: `소설/현대/책.epub`). 기록과 표지의 키로 쓴다. */
  rel: string;
  /** 책이 들어 있는 폴더의 상대 경로 (최상위면 빈 문자열) */
  folder: string;
  /** Dropbox 절대 경로 */
  path: string;
  kind: BookKind;
}

export interface Session {
  opened: string;
  /** 아직 열려 있으면 undefined */
  closed?: string;
  /** 다시 열 때 쓸 위치 (EPUB: CFI, PDF: 페이지 번호) */
  position: string;
  /** 사람이 읽는 위치 (예: `3장 · 4/12`, `12쪽`) */
  label: string;
}

export interface Highlight {
  id: string;
  /** 선택한 글 */
  text: string;
  /** 메모 */
  memo: string;
  /** 위치 (EPUB: CFI 범위, PDF: 페이지 번호) */
  position: string;
  label: string;
  created: string;
}

/** 북마크: 위치 하나를 표시해 두는 것 (글이나 메모는 없다) */
export interface Bookmark {
  id: string;
  position: string;
  label: string;
  created: string;
}

/** 페이지 메모: 하이라이트 없이 위치 하나에 적는 메모 */
export interface PageNote {
  id: string;
  position: string;
  label: string;
  text: string;
  created: string;
}

export interface ReadingState {
  /** 책의 상대 경로 (키) */
  name: string;
  /** 앱이 이 책을 처음 본 시각 */
  firstSeen: string;
  position: string;
  label: string;
  sessions: Session[];
  highlights: Highlight[];
  /** 즐겨찾기 여부. 책의 실제 위치와는 무관하다. */
  favorite?: boolean;
  bookmarks?: Bookmark[];
  pageNotes?: PageNote[];
}

export function bookKind(name: string): BookKind | null {
  if (/\.epub$/i.test(name)) return 'epub';
  if (/\.pdf$/i.test(name)) return 'pdf';
  return null;
}

export function emptyState(name: string, now: string): ReadingState {
  return {
    name,
    firstSeen: now,
    position: '',
    label: '',
    sessions: [],
    highlights: [],
    favorite: false,
    bookmarks: [],
    pageNotes: [],
  };
}

export function setFavorite(s: ReadingState, on: boolean): ReadingState {
  return { ...s, favorite: on };
}

/** 저장된 JSON을 읽는다. 형식이 깨졌으면 빈 기록으로 시작한다. */
export function parseState(raw: string | null, name: string, now: string): ReadingState {
  if (!raw) return emptyState(name, now);
  try {
    const data = JSON.parse(raw) as Partial<ReadingState>;
    return {
      name,
      firstSeen: typeof data.firstSeen === 'string' ? data.firstSeen : now,
      position: typeof data.position === 'string' ? data.position : '',
      label: typeof data.label === 'string' ? data.label : '',
      sessions: Array.isArray(data.sessions) ? data.sessions : [],
      highlights: Array.isArray(data.highlights) ? data.highlights : [],
      favorite: data.favorite === true,
      bookmarks: Array.isArray(data.bookmarks) ? data.bookmarks : [],
      pageNotes: Array.isArray(data.pageNotes) ? data.pageNotes : [],
    };
  } catch {
    return emptyState(name, now);
  }
}

function closeOpenSession(s: ReadingState, now: string): Session[] {
  const last = s.sessions[s.sessions.length - 1];
  if (!last || last.closed) return s.sessions;
  return [...s.sessions.slice(0, -1), { ...last, closed: now }];
}

/** 책을 열었다. 이전 세션이 남아 있으면 먼저 닫는다. */
export function startSession(s: ReadingState, now: string): ReadingState {
  return {
    ...s,
    sessions: [
      ...closeOpenSession(s, now),
      { opened: now, position: s.position, label: s.label },
    ],
  };
}

/** 읽는 위치가 바뀌었다. 열려 있는 세션의 위치도 함께 갱신한다. */
export function movePosition(s: ReadingState, position: string, label: string): ReadingState {
  const last = s.sessions[s.sessions.length - 1];
  const sessions =
    last && !last.closed ? [...s.sessions.slice(0, -1), { ...last, position, label }] : s.sessions;
  return { ...s, position, label, sessions };
}

/** 책을 닫았다. */
export function endSession(s: ReadingState, now: string): ReadingState {
  return { ...s, sessions: closeOpenSession(s, now) };
}

export function addHighlight(s: ReadingState, h: Highlight): ReadingState {
  return { ...s, highlights: [...s.highlights, h] };
}

export function updateMemo(s: ReadingState, id: string, memo: string): ReadingState {
  return { ...s, highlights: s.highlights.map((h) => (h.id === id ? { ...h, memo } : h)) };
}

export function removeHighlight(s: ReadingState, id: string): ReadingState {
  return { ...s, highlights: s.highlights.filter((h) => h.id !== id) };
}

/** 마지막으로 열었거나 닫은 시각 (기록이 없으면 null). 정렬에 쓴다. */
export function lastActivity(s: ReadingState | undefined): string | null {
  const last = s?.sessions[(s?.sessions.length ?? 0) - 1];
  return last ? (last.closed ?? last.opened) : null;
}

export type SortKey = 'recent' | 'name' | 'added';

export const SORT_LABELS: Record<SortKey, string> = {
  recent: '최근 읽은 순',
  name: '이름순',
  added: '추가된 순',
};

/** 정렬 기준에 따라 책 목록을 정렬한 새 배열을 돌려준다. */
export function sortBooks<T extends { book: Book; st?: ReadingState | undefined }>(items: T[], key: SortKey): T[] {
  const list = [...items];
  if (key === 'name') return list.sort((a, b) => a.book.name.localeCompare(b.book.name, 'ko'));
  if (key === 'added') {
    return list.sort((a, b) => (b.st?.firstSeen ?? '').localeCompare(a.st?.firstSeen ?? ''));
  }
  return list.sort((a, b) => (lastActivity(b.st) ?? '').localeCompare(lastActivity(a.st) ?? ''));
}

/** 현재 위치에 북마크가 있으면 그 북마크, 없으면 undefined */
export function bookmarkAt(s: ReadingState, position: string): Bookmark | undefined {
  return (s.bookmarks ?? []).find((b) => b.position === position);
}

export function toggleBookmark(s: ReadingState, position: string, label: string, id: string, now: string): ReadingState {
  const list = s.bookmarks ?? [];
  const hit = list.find((b) => b.position === position);
  if (hit) return { ...s, bookmarks: list.filter((b) => b.id !== hit.id) };
  return { ...s, bookmarks: [...list, { id, position, label, created: now }] };
}

export function addPageNote(s: ReadingState, note: PageNote): ReadingState {
  return { ...s, pageNotes: [...(s.pageNotes ?? []), note] };
}

export function updatePageNote(s: ReadingState, id: string, text: string): ReadingState {
  return { ...s, pageNotes: (s.pageNotes ?? []).map((n) => (n.id === id ? { ...n, text } : n)) };
}

export function removePageNote(s: ReadingState, id: string): ReadingState {
  return { ...s, pageNotes: (s.pageNotes ?? []).filter((n) => n.id !== id) };
}
