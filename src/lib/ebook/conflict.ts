/**
 * 동시 수정 충돌 공통 처리: 충돌 복사본 이름과 충돌 여부 판단.
 */
import { DropboxApiError } from '../dropbox/api';

/** 충돌 복사본 이름용 시각 (yymmddHHMM) */
export function crashStamp(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getFullYear() % 100)}${p(d.getMonth() + 1)}${p(d.getDate())}${p(d.getHours())}${p(d.getMinutes())}`;
}

/** 저장할 때 파일 버전이 바뀌어 있었는지 (Dropbox 409) */
export function isConflict(e: unknown): boolean {
  return e instanceof DropboxApiError && e.status === 409;
}

/** `name.ext` 를 `name_crashed_yymmddHHMM.ext` 로 바꾼 경로 */
export function crashPath(path: string, suffix: string): string {
  return path.replace(new RegExp(`${suffix.replace(/\./g, '\\.')}$`), `_crashed_${crashStamp(new Date())}${suffix}`);
}
