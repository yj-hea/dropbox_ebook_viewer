/**
 * 현재 열린 노트 상태.
 */
import { writable } from 'svelte/store';

export interface OpenNote {
  /** 볼트 루트 기준 상대 경로 (예: `01_Project/foo.md`) */
  relPath: string;
  /** Dropbox 절대 경로 */
  absPath: string;
  /** 디스크에 저장된 시점의 내용 */
  savedContent: string;
  /** 에디터 현재 내용 */
  content: string;
  /** Dropbox rev (충돌 감지용) */
  rev: string;
}

/** 현재 열린 노트. null = 열린 노트 없음. */
export const openNote = writable<OpenNote | null>(null);

/** 미저장 변경 여부. */
export const isDirty = writable<boolean>(false);

/** 저장 진행 중. */
export const isSaving = writable<boolean>(false);

/** 사용자에게 보여줄 일시 상태 메시지. */
export const statusMessage = writable<string>('');

