/**
 * Dropbox 앱 설정.
 *
 * Vite env 변수 `VITE_DROPBOX_APP_KEY` 로 주입. 설정 안 된 경우 Dropbox 기능은
 * UI 에서 숨김 처리된다.
 *
 * 이 앱은 일반 Dropbox 폴더(Obsidian 볼트)에 접근하므로 "Full Dropbox" access type
 * 으로 등록된 앱 키가 필요하다. 필요한 scope:
 *   files.metadata.read, files.content.read, files.content.write,
 *   sharing.read, sharing.write
 */

const APP_KEY = (import.meta.env.VITE_DROPBOX_APP_KEY ?? '').trim();

export const DROPBOX_APP_KEY = APP_KEY;

/** Dropbox 통합 기능이 활성화된 상태인지 */
export function isDropboxEnabled(): boolean {
  return APP_KEY.length > 0;
}

/** OAuth redirect URI — 현재 origin + 경로 기반. Dropbox 앱 설정에 등록해야 함. */
export function getRedirectUri(): string {
  if (typeof window === 'undefined') return '';
  const { origin, pathname } = window.location;
  const base = pathname.endsWith('/') ? pathname : pathname.replace(/[^/]+$/, '');
  return `${origin}${base}`;
}
