/**
 * 볼트 루트 경로 상태. localStorage 에 영속.
 *
 * 볼트 루트는 Dropbox 내 절대 경로 (예: `/eb_260529_dropbox`). 빈 문자열은
 * "아직 선택 안 함" 을 의미한다.
 */
import { writable } from 'svelte/store';

const VAULT_KEY = 'vault.root';

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

/** 볼트 루트 기준 상대 경로 → Dropbox 절대 경로. */
export function vaultPath(root: string, relative: string): string {
  const r = root.replace(/\/$/, '');
  const rel = relative.replace(/^\//, '');
  return rel ? `${r}/${rel}` : r;
}

/** Dropbox 절대 경로 → 볼트 루트 기준 상대 경로. */
export function toRelative(root: string, absolute: string): string {
  const r = root.replace(/\/$/, '');
  if (absolute === r) return '';
  if (absolute.startsWith(`${r}/`)) return absolute.slice(r.length + 1);
  return absolute.replace(/^\//, '');
}

/** 숨겨야 하는 항목 (Obsidian 시스템 폴더/숨김 파일). */
export function isHidden(name: string): boolean {
  return name.startsWith('.'); // .obsidian, .trash, .git 등
}

/** 펼쳐진 폴더 경로 — 사이드바 새로고침 시에도 펼침 상태 유지. */
export const expandedFolders = new Set<string>();
