/**
 * 폴더 루트 경로 상태. localStorage 에 영속.
 *
 * 폴더 루트는 Dropbox 내 절대 경로 (예: `/eb_260529_dropbox`). 빈 문자열은
 * "아직 선택 안 함" 을 의미한다.
 */
import { writable } from 'svelte/store';

const VAULT_KEY = 'ebook.root';

function readVaultRoot(): string {
  try {
    return localStorage.getItem(VAULT_KEY) ?? '';
  } catch {
    return '';
  }
}

export const vaultRoot = writable<string>(readVaultRoot());

vaultRoot.subscribe((v) => {
  try {
    if (v) localStorage.setItem(VAULT_KEY, v);
    else localStorage.removeItem(VAULT_KEY);
  } catch {
    /* ignore */
  }
});

/** 폴더 루트 기준 상대 경로 → Dropbox 절대 경로. */
export function vaultPath(root: string, relative: string): string {
  const r = root.replace(/\/$/, '');
  const rel = relative.replace(/^\//, '');
  return rel ? `${r}/${rel}` : r;
}

/** Dropbox 절대 경로 → 폴더 루트 기준 상대 경로. */
export function toRelative(root: string, absolute: string): string {
  const r = root.replace(/\/$/, '');
  // Dropbox 경로는 대소문자를 구분하지 않으므로 비교도 구분하지 않는다
  if (absolute.toLowerCase() === r.toLowerCase()) return '';
  if (absolute.toLowerCase().startsWith(`${r.toLowerCase()}/`)) return absolute.slice(r.length + 1);
  return absolute.replace(/^\//, '');
}

/** 숨겨야 하는 항목 (숨김 파일과 폴더). */
export function isHidden(name: string): boolean {
  return name.startsWith('.'); // .git 등
}

/** 펼쳐진 폴더 경로 — 사이드바 새로고침 시에도 펼침 상태 유지. */
export const expandedFolders = new Set<string>();
