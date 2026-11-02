/**
 * 책 읽기 기록의 순수 로직 (화면·네트워크와 무관).
 *
 * 한 권의 기록: 처음 본 날짜, 마지막 위치, 열고 닫은 기록(세션), 하이라이트·메모.
 */

export type BookKind = 'epub' | 'pdf';

export interface Book {
  /** 파일명 (예: `책.epub`) */
  name: string;
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

export interface ReadingState {
  name: string;
  /** 앱이 이 책을 처음 본 시각 */
  firstSeen: string;
  position: string;
  label: string;
  sessions: Session[];
  highlights: Highlight[];
}

export function bookKind(name: string): BookKind | null {
  if (/\.epub$/i.test(name)) return 'epub';
  if (/\.pdf$/i.test(name)) return 'pdf';
  return null;
}

export function emptyState(name: string, now: string): ReadingState {
  return { name, firstSeen: now, position: '', label: '', sessions: [], highlights: [] };
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
export function lastActivity(s: ReadingState): string | null {
  const last = s.sessions[s.sessions.length - 1];
  return last ? (last.closed ?? last.opened) : null;
}
