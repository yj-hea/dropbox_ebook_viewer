/**
 * 책별 독서 노트 저장소. 노트는 `<폴더>/.ebook-reading/<상대 경로>.note.md` 에 마크다운으로 저장한다.
 * 입력이 멈추면 잠시 뒤에 한 번에 보낸다.
 */
import { downloadFile, uploadText } from '../lib/dropbox/api';
import { crashPath, isConflict } from '../lib/ebook/conflict';
import { legacyRecordName, recordName } from '../lib/ebook/paths';
import { statusMessage } from './note';

const SAVE_DELAY = 2000;

/** 노트를 보낼 때 쓰는 기본 폴더 (책 기록과 같은 곳) */
const STATE_DIR = '.ebook-reading';

function base(root: string): string {
  return root.replace(/\/+$/, '');
}

export function notePath(root: string, rel: string): string {
  return `${base(root)}/${STATE_DIR}/${recordName(rel)}.note.md`;
}

function legacyNotePath(root: string, rel: string): string {
  return `${base(root)}/${STATE_DIR}/${legacyRecordName(rel)}.note.md`;
}

/** 읽기에 성공한 노트의 내용. 이 값이 있어야 저장을 허용한다 (읽기 실패 때 빈 내용으로 덮어쓰지 않도록). */
const confirmed = new Map<string, string>();
/** 마지막으로 읽거나 쓴 파일 버전. 저장할 때 이 버전과 같을 때만 덮어쓴다. */
const revs = new Map<string, string>();

/**
 * 노트 내용을 읽는다. 파일이 없으면 빈 문자열, 읽기가 실패하면 예외를 던진다.
 * 실패를 빈 내용으로 바꾸면 기존 노트가 다음 저장에서 지워지므로 일부러 구분한다.
 */
export async function loadNote(root: string, rel: string): Promise<string> {
  const dl = await downloadFile(notePath(root, rel));
  // 예전 이름으로 저장된 노트가 있으면 그 내용을 읽는다 (저장은 새 이름으로 한다)
  const old = dl ? null : await downloadFile(legacyNotePath(root, rel));
  const text = dl ? dl.content : old ? old.content : '';
  if (dl) revs.set(rel, dl.rev);
  confirmed.set(rel, text);
  return text;
}

/** 읽기가 확인되지 않은 노트는 저장하지 않는다. 확인된 내용이 있던 노트를 빈 내용으로 지우는 것도 막는다. */
function allowed(rel: string, text: string): boolean {
  const known = confirmed.get(rel);
  if (known === undefined) return false;
  if (text.trim() === '' && known.trim() !== '') return false;
  return true;
}

interface Pending {
  root: string;
  text: string;
  timer?: ReturnType<typeof setTimeout>;
}
const pending = new Map<string, Pending>();
const busy = new Set<string>();

/** 다른 곳이 먼저 저장한 노트를 `_crashed` 복사본으로 남기고, 현재 내용을 최신으로 저장한다. */
async function keepConflict(root: string, rel: string, text: string): Promise<void> {
  const current = await downloadFile(notePath(root, rel));
  if (current) {
    await uploadText(crashPath(notePath(root, rel), '.note.md'), current.content, 'add');
  }
  const res = await uploadText(notePath(root, rel), text, 'overwrite');
  revs.set(rel, res.rev);
  confirmed.set(rel, text);
  statusMessage.set('독서 노트가 다른 곳에서 함께 수정되어, 이전 버전을 _crashed 파일로 보관했습니다.');
}

async function send(rel: string) {
  const p = pending.get(rel);
  if (!p || busy.has(rel)) return;
  busy.add(rel);
  const sent = p.text;
  if (!allowed(rel, sent)) {
    busy.delete(rel);
    return;
  }
  try {
    const rev = revs.get(rel);
    const res = await uploadText(notePath(p.root, rel), sent, rev ? { update: rev } : 'overwrite');
    revs.set(rel, res.rev);
    confirmed.set(rel, sent);
  } catch (e) {
    if (isConflict(e) && revs.has(rel)) {
      await keepConflict(p.root, rel, sent);
    } else {
      statusMessage.set('독서 노트 저장 실패: ' + (e instanceof Error ? e.message : String(e)));
    }
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
  if (!allowed(rel, text)) return;
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
