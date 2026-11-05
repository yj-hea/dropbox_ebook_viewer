/**
 * Dropbox HTTP API 래퍼 — 목록, 다운로드, 업로드, 이동/삭제, 공유링크.
 * 경로는 Dropbox 루트부터의 절대 경로 (예: `/eb_260529_dropbox/note.md`).
 */

import { getAccessToken } from './auth';

// Dropbox 요청 동시 실행 수 제한과 429(요청 과다) 재시도.
// 처음 열 때 책마다 기록 파일을 한꺼번에 받으면 429가 나므로 몇 개씩만 보낸다.
const MAX_PARALLEL = 4;
const MAX_RETRIES = 5;
let running = 0;
const waiting: (() => void)[] = [];

async function withSlot<T>(task: () => Promise<T>): Promise<T> {
  if (running >= MAX_PARALLEL) await new Promise<void>((resolve) => waiting.push(resolve));
  running++;
  try {
    return await task();
  } finally {
    running--;
    waiting.shift()?.();
  }
}

// 파일 쓰기는 한 번에 하나씩, 간격을 두고 보낸다. 몰아서 쓰면 Dropbox가 429(쓰기 과다)로 막는다.
const WRITE_GAP_MS = 800;
let writeQueue: Promise<unknown> = Promise.resolve();
let lastWriteAt = 0;

function paced<T>(task: () => Promise<T>): Promise<T> {
  const run = writeQueue.then(async () => {
    const wait = lastWriteAt + WRITE_GAP_MS - Date.now();
    if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
    lastWriteAt = Date.now();
    return task();
  });
  writeQueue = run.catch(() => undefined);
  return run;
}

async function sendWithRetry(url: string, init?: RequestInit): Promise<Response> {
  for (let tries = 0; ; tries++) {
    const res = await withSlot(() => fetch(url, init));
    if (res.status !== 429 || tries >= MAX_RETRIES) return res;
    await new Promise((resolve) => setTimeout(resolve, 1000 * 2 ** tries));
  }
}

export async function dbxFetch(url: string, init?: RequestInit): Promise<Response> {
  if (url.endsWith('/files/upload')) return paced(() => sendWithRetry(url, init));
  return sendWithRetry(url, init);
}

const RPC_URL = 'https://api.dropboxapi.com/2';
const CONTENT_URL = 'https://content.dropboxapi.com/2';

export class DropboxApiError extends Error {
  constructor(
    public status: number,
    public detail: string,
  ) {
    super(`Dropbox API ${status}: ${detail}`);
    this.name = 'DropboxApiError';
  }
}

export function normalizePath(path: string): string {
  const trimmed = path.trim();
  if (!trimmed || trimmed === '/') return '';
  return trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
}

/** Dropbox-API-Arg 헤더는 ASCII 만 허용하므로 비-ASCII 를 \uXXXX 로 이스케이프. */
function apiArg(obj: unknown): string {
  return JSON.stringify(obj).replace(
    /[^\u0000-\u007f]/g,
    (c) => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'),
  );
}

async function authHeader(): Promise<string> {
  const token = await getAccessToken();
  if (!token) throw new Error('Dropbox 로그인 필요');
  return `Bearer ${token}`;
}

async function rpc<T>(endpoint: string, body: unknown): Promise<T> {
  const res = await dbxFetch(`${RPC_URL}${endpoint}`, {
    method: 'POST',
    headers: {
      Authorization: await authHeader(),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    throw new DropboxApiError(res.status, txt);
  }
  return (await res.json()) as T;
}

function isNotFound(text: string): boolean {
  return text.includes('not_found') || text.includes('path/not_found');
}

// 폴더/파일 목록 ───────────────────────────────────────────

export type EntryType = 'file' | 'folder';

export interface Entry {
  type: EntryType;
  name: string;
  path: string;
  rev?: string;
  size?: number;
  serverModified?: string;
}

export async function listFolder(path: string, recursive = false): Promise<Entry[]> {
  const auth = await authHeader();
  const entries: Entry[] = [];
  let cursor: string | null = null;
  for (;;) {
    const endpoint = cursor ? '/files/list_folder/continue' : '/files/list_folder';
    const body = cursor
      ? { cursor }
      : { path: normalizePath(path), recursive, include_deleted: false };
    const res = await dbxFetch(`${RPC_URL}${endpoint}`, {
      method: 'POST',
      headers: { Authorization: auth, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (res.status === 409) {
      const txt = await res.text().catch(() => '');
      if (isNotFound(txt)) return entries;
      throw new DropboxApiError(res.status, txt);
    }
    if (!res.ok) throw new DropboxApiError(res.status, await res.text().catch(() => ''));
    const data = (await res.json()) as {
      entries: Array<{
        '.tag': string;
        name: string;
        path_display: string;
        rev?: string;
        size?: number;
        server_modified?: string;
      }>;
      cursor: string;
      has_more: boolean;
    };
    for (const e of data.entries) {
      if (e['.tag'] !== 'file' && e['.tag'] !== 'folder') continue;
      entries.push({
        type: e['.tag'] as EntryType,
        name: e.name,
        path: e.path_display,
        rev: e.rev,
        size: e.size,
        serverModified: e.server_modified,
      });
    }
    if (!data.has_more) break;
    cursor = data.cursor;
  }
  return entries;
}

// 다운로드 / 업로드 ─────────────────────────────────────────

export interface DownloadResult {
  content: string;
  rev: string;
  name: string;
  path: string;
}

export async function downloadFile(path: string): Promise<DownloadResult | null> {
  const res = await dbxFetch(`${CONTENT_URL}/files/download`, {
    method: 'POST',
    headers: {
      Authorization: await authHeader(),
      'Dropbox-API-Arg': apiArg({ path: normalizePath(path) }),
    },
  });
  if (res.status === 409) {
    const body = await res.text().catch(() => '');
    if (isNotFound(body)) return null;
    throw new DropboxApiError(res.status, body);
  }
  if (!res.ok) throw new DropboxApiError(res.status, await res.text().catch(() => ''));
  const meta = JSON.parse(res.headers.get('Dropbox-API-Result') ?? '{}') as {
    rev?: string;
    name?: string;
    path_display?: string;
  };
  const content = await res.text();
  return {
    content,
    rev: meta.rev ?? '',
    name: meta.name ?? '',
    path: meta.path_display ?? path,
  };
}

/** 파일을 바이트 그대로 받는다 (EPUB·PDF 같은 바이너리용). 없으면 null. */
export async function downloadBytes(path: string): Promise<ArrayBuffer | null> {
  const res = await dbxFetch(`${CONTENT_URL}/files/download`, {
    method: 'POST',
    headers: {
      Authorization: await authHeader(),
      'Dropbox-API-Arg': apiArg({ path: normalizePath(path) }),
    },
  });
  if (res.status === 409) {
    const body = await res.text().catch(() => '');
    if (isNotFound(body)) return null;
    throw new DropboxApiError(res.status, body);
  }
  if (!res.ok) throw new DropboxApiError(res.status, await res.text().catch(() => ''));
  return res.arrayBuffer();
}

export type UploadMode = 'overwrite' | 'add' | { update: string };

interface UploadResult {
  rev: string;
  name: string;
  path: string;
}

async function uploadRaw(path: string, body: BodyInit, mode: UploadMode): Promise<UploadResult> {
  const apiArgs = {
    path: normalizePath(path),
    mode: typeof mode === 'string' ? { '.tag': mode } : { '.tag': 'update', update: mode.update },
    autorename: mode === 'add',
    mute: true,
  };
  const res = await dbxFetch(`${CONTENT_URL}/files/upload`, {
    method: 'POST',
    headers: {
      Authorization: await authHeader(),
      'Content-Type': 'application/octet-stream',
      'Dropbox-API-Arg': apiArg(apiArgs),
    },
    body,
  });
  if (!res.ok) throw new DropboxApiError(res.status, await res.text().catch(() => ''));
  const data = (await res.json()) as { rev: string; name: string; path_display: string };
  return { rev: data.rev, name: data.name, path: data.path_display };
}

export function uploadText(path: string, content: string, mode: UploadMode = 'overwrite') {
  return uploadRaw(path, new TextEncoder().encode(content), mode);
}

export function uploadBinary(path: string, bytes: ArrayBuffer | Uint8Array, mode: UploadMode = 'add') {
  return uploadRaw(path, bytes as BodyInit, mode);
}

export async function deleteFile(path: string): Promise<void> {
  await rpc('/files/delete_v2', { path: normalizePath(path) });
}

export async function moveFile(from: string, to: string): Promise<void> {
  await rpc('/files/move_v2', {
    from_path: normalizePath(from),
    to_path: normalizePath(to),
    autorename: false,
  });
}

export async function createFolder(path: string): Promise<void> {
  const res = await dbxFetch(`${RPC_URL}/files/create_folder_v2`, {
    method: 'POST',
    headers: { Authorization: await authHeader(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ path: normalizePath(path) }),
  });
  if (res.status === 409) return;
  if (!res.ok) throw new DropboxApiError(res.status, await res.text().catch(() => ''));
}

// 검색 ──────────────────────────────────────────────────────

export interface SearchHit {
  name: string;
  path: string;
}

/** 폴더 안에서 파일 이름이 정확히 일치하는 파일을 찾는다 (이미지 임베드용, 확장자 제한 없음). */
export async function findFileByName(root: string, name: string): Promise<SearchHit | null> {
  const base = name.split('/').pop() ?? name;
  const data = await rpc<{
    matches: Array<{ metadata?: { metadata?: { '.tag'?: string; name?: string; path_display?: string } } }>;
  }>('/files/search_v2', {
    query: base,
    options: { path: normalizePath(root), max_results: 20, filename_only: true },
  });
  for (const m of data.matches) {
    const md = m.metadata?.metadata;
    if (md?.['.tag'] === 'file' && md.path_display && md.name?.toLowerCase() === base.toLowerCase()) {
      return { name: md.name, path: md.path_display };
    }
  }
  return null;
}

/** 폴더 내 파일명 + 본문 검색 (Dropbox 서버 검색). */
export async function searchVault(root: string, query: string): Promise<SearchHit[]> {
  const data = await rpc<{
    matches: Array<{ metadata?: { metadata?: { '.tag'?: string; name?: string; path_display?: string } } }>;
  }>('/files/search_v2', {
    query,
    options: {
      path: normalizePath(root),
      max_results: 50,
      file_extensions: ['md'],
      filename_only: false,
    },
  });
  const hits: SearchHit[] = [];
  for (const m of data.matches) {
    const md = m.metadata?.metadata;
    if (md?.['.tag'] === 'file' && md.path_display) {
      hits.push({ name: md.name ?? '', path: md.path_display });
    }
  }
  return hits;
}

// 공유 링크 (이미지 표시용) ─────────────────────────────────

function toRawUrl(url: string): string {
  if (/[?&](dl|raw)=/.test(url)) {
    return url.replace(/([?&])(dl|raw)=\d/, '$1raw=1');
  }
  return url + (url.includes('?') ? '&' : '?') + 'raw=1';
}

/** 파일의 공유 링크(raw=1) 반환. 이미 있으면 기존 링크 재사용. */
export async function getRawSharedLink(path: string): Promise<string> {
  const p = normalizePath(path);
  const res = await dbxFetch(`${RPC_URL}/sharing/create_shared_link_with_settings`, {
    method: 'POST',
    headers: { Authorization: await authHeader(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ path: p }),
  });
  if (res.ok) {
    const data = (await res.json()) as { url: string };
    return toRawUrl(data.url);
  }
  if (res.status === 409) {
    const existing = await rpc<{ links: Array<{ url: string }> }>('/sharing/list_shared_links', {
      path: p,
      direct_only: true,
    });
    const link = existing.links[0];
    if (link) return toRawUrl(link.url);
  }
  throw new DropboxApiError(res.status, await res.text().catch(() => ''));
}
