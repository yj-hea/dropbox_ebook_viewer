<script lang="ts">
  import { onDestroy, untrack } from 'svelte';
  import { downloadBytes, uploadBinary } from '../lib/dropbox/api';
  import { makeCover } from '../lib/ebook/cover';
  import { flushStates, getState, listBooks, loadStates, readingStates, setState } from '../stores/books';
  import {
    addHighlight,
    emptyState,
    endSession,
    lastActivity,
    movePosition,
    removeHighlight,
    startSession,
    updateMemo,
    type Book,
  } from '../lib/ebook/state';
  import BookReader from './BookReader.svelte';

  interface Props {
    root: string;
  }
  let { root }: Props = $props();

  let books = $state<Book[]>([]);
  let loading = $state(false);
  let error = $state('');
  let current = $state<Book | null>(null);
  let expanded = $state<string | null>(null);
  // 목록(기록 보기) 또는 서재(표지 보기)
  let view = $state<'list' | 'shelf'>(readView());
  // 책 파일명 → 표지 이미지 주소
  let covers = $state<Record<string, string>>({});
  const coverUrls = new Map<string, string>();

  function readView(): 'list' | 'shelf' {
    try {
      return localStorage.getItem('books.view') === 'shelf' ? 'shelf' : 'list';
    } catch {
      return 'list';
    }
  }

  function setView(v: 'list' | 'shelf') {
    view = v;
    try {
      localStorage.setItem('books.view', v);
    } catch {
      /* ignore */
    }
  }

  onDestroy(() => {
    for (const url of coverUrls.values()) URL.revokeObjectURL(url);
    coverUrls.clear();
  });

  // 최근에 읽은 책이 위로 오도록 정렬한다 (기록이 없는 책은 아래)
  const rows = $derived(
    books
      .map((book) => ({ book, st: $readingStates[book.name] }))
      .sort((a, b) => (lastActivity(b.st) ?? '').localeCompare(lastActivity(a.st) ?? '')),
  );
  const currentState = $derived(current ? $readingStates[current.name] : undefined);

  async function refresh(r: string) {
    loading = true;
    error = '';
    try {
      books = await listBooks(r);
      await loadStates(r, books);
      void loadCovers(r, books);
    } catch (e) {
      error = '책 목록을 불러오지 못했습니다: ' + (e instanceof Error ? e.message : String(e));
    } finally {
      loading = false;
    }
  }

  // 표지는 한 번 만들어 ebook/.reading/ 에 저장하고, 다음부터는 그 이미지를 받는다
  async function loadCovers(r: string, list: Book[]) {
    for (const b of list) {
      if (covers[b.name]) continue;
      const path = `${r}/ebook/.reading/${b.name}.cover.jpg`;
      try {
        let bytes = await downloadBytes(path);
        if (!bytes) {
          const book = await downloadBytes(b.path);
          if (!book) continue;
          const blob = await makeCover(book, b.kind);
          if (!blob) continue;
          bytes = await blob.arrayBuffer();
          await uploadBinary(path, bytes, 'overwrite');
        }
        const url = URL.createObjectURL(new Blob([bytes], { type: 'image/jpeg' }));
        coverUrls.set(b.name, url);
        covers[b.name] = url;
      } catch {
        /* 표지가 없으면 제목만 보여 준다 */
      }
    }
  }

  // 볼트가 바뀌면 목록을 다시 읽는다
  $effect(() => {
    const r = root;
    untrack(() => void refresh(r));
  });

  function now(): string {
    return new Date().toISOString();
  }

  function newId(): string {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  function fmt(iso: string | null | undefined): string {
    if (!iso) return '-';
    return new Date(iso).toLocaleString('ko-KR', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  }

  function open(book: Book) {
    const st = getState(book.name) ?? emptyState(book.name, now());
    setState(root, startSession(st, now()));
    current = book;
  }

  function close() {
    if (current) {
      const st = getState(current.name);
      if (st) setState(root, endSession(st, now()));
    }
    flushStates();
    current = null;
  }

  function onMove(position: string, label: string) {
    if (!current) return;
    const st = getState(current.name);
    if (!st || (st.position === position && st.label === label)) return;
    setState(root, movePosition(st, position, label));
  }

  function onHighlight(h: { text: string; position: string; label: string }) {
    if (!current) return;
    const st = getState(current.name);
    if (st) setState(root, addHighlight(st, { ...h, id: newId(), memo: '', created: now() }));
  }

  function onMemo(id: string, memo: string) {
    const st = current && getState(current.name);
    if (st) setState(root, updateMemo(st, id, memo));
  }

  function onRemoveHighlight(id: string) {
    const st = current && getState(current.name);
    if (st) setState(root, removeHighlight(st, id));
  }
</script>

{#if current && currentState}
  <BookReader
    book={current}
    reading={currentState}
    {onMove}
    {onHighlight}
    {onMemo}
    onRemoveHighlight={onRemoveHighlight}
    onClose={close}
  />
{:else}
  <div class="shelf">
    <header class="head">
      <h2>책</h2>
      <span class="count">{books.length}권</span>
      <div class="spacer"></div>
      <button class="btn" class:on={view === 'list'} onclick={() => setView('list')} title="목록 보기" aria-label="목록 보기">
        <i class="fa-solid fa-list"></i>
      </button>
      <button class="btn" class:on={view === 'shelf'} onclick={() => setView('shelf')} title="서재 보기" aria-label="서재 보기">
        <i class="fa-solid fa-table-cells-large"></i>
      </button>
      <button class="btn" onclick={() => refresh(root)} disabled={loading} title="새로고침" aria-label="새로고침">
        <i class="fa-solid fa-rotate"></i>
      </button>
    </header>

    {#if error}
      <p class="msg err">{error}</p>
    {/if}

    {#if loading && books.length === 0}
      <p class="msg">불러오는 중…</p>
    {:else if books.length === 0}
      <p class="msg">볼트의 <code>ebook/</code> 폴더에 EPUB 또는 PDF 파일을 넣으면 여기에 나타납니다.</p>
    {:else if view === 'shelf'}
      <ul class="shelf-grid">
        {#each rows as { book, st } (book.path)}
          <li>
            <button class="cover-card" onclick={() => open(book)} title={book.name}>
              {#if covers[book.name]}
                <img src={covers[book.name]} alt="" />
              {:else}
                <span class="placeholder">
                  <i class="fa-solid {book.kind === 'pdf' ? 'fa-file-pdf' : 'fa-book'}"></i>
                  <span>{book.name.replace(/\.(epub|pdf)$/i, '')}</span>
                </span>
              {/if}
            </button>
            <div class="cap">{book.name.replace(/\.(epub|pdf)$/i, '')}</div>
            {#if st && lastActivity(st)}<div class="sub">{fmt(lastActivity(st))}</div>{/if}
          </li>
        {/each}
      </ul>
    {:else}
      <ul class="list">
        {#each rows as { book, st } (book.path)}
          <li class="item">
            <div class="row">
              <button class="open" onclick={() => open(book)}>
                <i class="fa-solid {book.kind === 'pdf' ? 'fa-file-pdf' : 'fa-book'}"></i>
                <span class="name">{book.name}</span>
              </button>
              <button
                class="btn"
                class:on={expanded === book.path}
                onclick={() => (expanded = expanded === book.path ? null : book.path)}
                title="읽기 기록"
                aria-label="읽기 기록"
              >
                <i class="fa-solid fa-clock-rotate-left"></i>
              </button>
            </div>
            <div class="meta">
              추가 {fmt(st?.firstSeen)} · 마지막 {fmt(lastActivity(st))}
              {#if st?.label}· {st.label}{/if}
              {#if st && st.highlights.length}· 하이라이트 {st.highlights.length}{/if}
            </div>

            {#if expanded === book.path && st}
              <div class="history">
                {#if st.sessions.length === 0}
                  <p class="msg">아직 연 기록이 없습니다.</p>
                {/if}
                {#each [...st.sessions].reverse() as s (s.opened)}
                  <div class="sess">
                    {fmt(s.opened)} → {s.closed ? fmt(s.closed) : '읽는 중'}
                    <span class="loc">{s.label || '-'}</span>
                  </div>
                {/each}
                {#each st.highlights as h (h.id)}
                  <div class="sess quote">
                    “{h.text}”
                    {#if h.memo}<span class="memo">— {h.memo}</span>{/if}
                    <span class="loc">({h.label})</span>
                  </div>
                {/each}
              </div>
            {/if}
          </li>
        {/each}
      </ul>
    {/if}
  </div>
{/if}

<style>
  .shelf {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    padding: 1rem clamp(0.75rem, 3vw, 2rem);
    background: var(--bg);
    color: var(--text);
  }
  .head {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    margin-bottom: 0.8rem;
  }
  h2 {
    margin: 0;
    font-size: 1.2rem;
  }
  .count {
    color: var(--text-muted);
    font-size: 0.88rem;
  }
  .spacer {
    flex: 1;
  }
  .btn {
    background: none;
    border: 1px solid transparent;
    border-radius: 6px;
    color: var(--text-muted);
    padding: 0.3rem 0.5rem;
  }
  .btn:hover:not(:disabled) {
    background: var(--bg-elev);
    color: var(--text);
  }
  .btn.on {
    color: var(--accent);
  }
  .msg {
    color: var(--text-muted);
    font-size: 0.9rem;
  }
  .msg.err {
    color: #c0392b;
  }
  .list {
    list-style: none;
    margin: 0;
    padding: 0;
  }
  .item {
    border-bottom: 1px solid var(--border);
    padding: 0.5rem 0;
  }
  .row {
    display: flex;
    align-items: center;
    gap: 0.4rem;
  }
  .open {
    flex: 1;
    min-width: 0;
    display: flex;
    align-items: center;
    gap: 0.5rem;
    background: none;
    border: none;
    color: var(--text);
    text-align: left;
    font-weight: 600;
    padding: 0.3rem 0.2rem;
    border-radius: 6px;
  }
  .open:hover {
    color: var(--accent);
  }
  .name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .meta {
    color: var(--text-muted);
    font-size: 0.8rem;
    padding-left: 1.6rem;
  }
  .history {
    margin: 0.4rem 0 0 1.6rem;
    font-size: 0.82rem;
  }
  .sess {
    padding: 0.2rem 0;
    border-left: 2px solid var(--border);
    padding-left: 0.5rem;
    margin-bottom: 0.2rem;
  }
  .sess.quote {
    font-style: italic;
  }
  .loc,
  .memo {
    color: var(--text-muted);
    margin-left: 0.3rem;
  }
  code {
    font-size: 0.85em;
  }
  .btn.on {
    color: var(--accent);
  }
  .shelf-grid {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(clamp(88px, 22vw, 130px), 1fr));
    gap: 1.1rem 0.9rem;
  }
  .cover-card {
    display: block;
    width: 100%;
    aspect-ratio: 2 / 3;
    padding: 0;
    border: none;
    border-radius: 4px;
    overflow: hidden;
    background: var(--bg-elev);
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
  }
  .cover-card:hover {
    box-shadow: 0 4px 14px rgba(0, 0, 0, 0.25);
  }
  .cover-card img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
  }
  .placeholder {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 0.5rem;
    width: 100%;
    height: 100%;
    padding: 0.6rem;
    color: var(--text-muted);
    font-size: 0.8rem;
    text-align: center;
    word-break: break-all;
  }
  .placeholder i {
    font-size: 1.6rem;
  }
  .cap {
    margin-top: 0.4rem;
    font-size: 0.85rem;
    font-weight: 600;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .sub {
    color: var(--text-muted);
    font-size: 0.75rem;
  }
</style>
