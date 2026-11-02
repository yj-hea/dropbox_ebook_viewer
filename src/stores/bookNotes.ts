/**
 * 책별 독서 노트 저장소. 노트는 `<폴더>/.ebook-reading/<상대 경로>.note.md` 에 마크다운으로 저장한다.
 * 입력이 멈추면 잠시 뒤에 한 번에 보낸다.
 */
import { downloadFile, uploadText } from '../lib/dropbox/api';
import { statusMessage } from './note';

const SAVE_DELAY = 2000;

/** 노트를 보낼 때 쓰는 기본 폴더 (책 기록과 같은 곳) */
const STATE_DIR = '.ebook-reading';

function base(root: string): string {
  return root.replace(/\/+$/, '');
}

export function notePath(root: string, rel: string): string {
  return `${base(root)}/${STATE_DIR}/${encodeURIComponent(rel)}.note.md`;
}

/** 노트 내용을 읽는다. 아직 없으면 빈 문자열. */
export async function loadNote(root: string, rel: string): Promise<string> {
  const dl = await downloadFile(notePath(root, rel)).catch(() => null);
  return dl ? dl.content : '';
}

interface Pending {
  root: string;
  text: string;
  timer?: ReturnType<typeof setTimeout>;
}
const pending = new Map<string, Pending>();
const busy = new Set<string>();

async function send(rel: string) {
  const p = pending.get(rel);
  if (!p || busy.has(rel)) return;
  busy.add(rel);
  const sent = p.text;
  try {
    await uploadText(notePath(p.root, rel), sent, 'overwrite');
  } catch (e) {
    statusMessage.set('독서 노트 저장 실패: ' + (e instanceof Error ? e.message : String(e)));
  } finally {
    busy.delete(rel);
  }
  // 보내는 동안 바뀌었으면 최신 내용을 다시 보낸다
  const now = pending.get(rel);
  if (now && now.text !== sent) schedule(rel);
}

function schedule(rel: string) {
  const p = pending.get(rel);
  if (!p) return;
  if (p.timer) clearTimeout(p.timer);
  p.timer = setTimeout(() => void send(rel), SAVE_DELAY);
}

/** 노트 내용을 바꾸고 저장을 예약한다. */
export function scheduleNote(root: string, rel: string, text: string): void {
  const p = pending.get(rel);
  pending.set(rel, { root, text, timer: p?.timer });
  schedule(rel);
}

/** 예약된 노트를 바로 보낸다 (창을 닫기 전에). */
export function flushNotes(): void {
  for (const [rel, p] of pending) {
    if (p.timer) clearTimeout(p.timer);
    p.timer = undefined;
    void send(rel);
  }
}

if (typeof window !== 'undefined') {
  window.addEventListener('pagehide', flushNotes);
}
