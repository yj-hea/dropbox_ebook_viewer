<script lang="ts">
  import { onDestroy, untrack } from 'svelte';
  import { downloadBytes, uploadBinary } from '../lib/dropbox/api';
  import { makeCover } from '../lib/ebook/cover';
  import {
    addHighlight,
    emptyState,
    endSession,
    lastActivity,
    movePosition,
    removeHighlight,
    addPageNote,
    removePageNote,
    removeBookmark,
    removeSession,
    setFavorite,
    SORT_LABELS,
    toggleBookmark,
    updatePageNote,
    sortBooks,
    startSession,
    updateMemo,
    type Book,
    type SortKey,
  } from '../lib/ebook/state';
  import {
    coverPath,
    createShelf,
    flushStates,
    getState,
    listBooks,
    loadStates,
    moveBook,
    readingStates,
    setState,
  } from '../stores/books';
  import BookReader from './BookReader.svelte';
  import BookNotebook from './BookNotebook.svelte';
  import ShelfDialog from './ShelfDialog.svelte';
  import { flushNotes } from '../stores/bookNotes';

  interface Props {
    root: string;
  }
  let { root }: Props = $props();

  let books = $state<Book[]>([]);
  // 하위 폴더(서가) 목록. 책이 없는 서가도 여기에 있다.
  let folders = $state<string[]>([]);
  // 서가 만들기 또는 책 옮기기 대화상자
  let dialog = $state<{ mode: 'create' } | { mode: 'move'; book: Book } | null>(null);
  let loading = $state(false);
  let error = $state('');
  let current = $state<Book | null>(null);
  // 처음 열 위치 (노트 화면에서 특정 기록으로 갈 때)
  let startAt = $state('');
  // 게시글처럼 보는 책 노트 화면
  let notebook = $state<Book | null>(null);
  const notebookState = $derived(notebook ? $readingStates[notebook.rel] : undefined);
  let expanded = $state<string | null>(null);
  // 목록(기록 보기) 또는 서재(표지 보기)
  let view = $state<'list' | 'shelf'>(readView());
  // 책 상대 경로 → 표지 이미지 주소
  let covers = $state<Record<string, string>>({});
  const coverUrls = new Map<string, string>();

  function readView(): 'list' | 'shelf' {
    try {
      return localStorage.getItem('books.view') === 'shelf' ? 'shelf' : 'list';
    } catch {
      return 'list';
    }
  }

  // 정렬 기준 (기기에 기억한다)
  const SORT_KEYS: SortKey[] = ['recent', 'name', 'added'];
  let sortKey = $state<SortKey>(readSort());

  function readSort(): SortKey {
    try {
      const v = localStorage.getItem('books.sort') as SortKey | null;
      return v && SORT_KEYS.includes(v) ? v : 'recent';
    } catch {
      return 'recent';
    }
  }

  function setSort(v: SortKey) {
    sortKey = v;
    try {
      localStorage.setItem('books.sort', v);
    } catch {
      /* ignore */
    }
  }

  // 즐겨찾기 서가의 접기 상태 키 (폴더 경로와 겹치지 않는 값)
  const FAV_KEY = '\u0000favorites';

  // 접어 둔 서가 (폴더 경로 목록). 기기에 기억한다.
  let collapsed = $state<string[]>(readCollapsed());

  function readCollapsed(): string[] {
    try {
      const v = JSON.parse(localStorage.getItem('books.collapsed') ?? '[]');
      return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
    } catch {
      return [];
    }
  }

  function toggleShelf(key: string) {
    collapsed = collapsed.includes(key) ? collapsed.filter((f) => f !== key) : [...collapsed, key];
    try {
      localStorage.setItem('books.collapsed', JSON.stringify(collapsed));
    } catch {
      /* ignore */
    }
  }

  function setView(v: 'list' | 'shelf') {
    view = v;
    if (v === 'shelf') void loadCovers(root, books);
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

  // 같은 폴더의 책끼리 묶는다 (서가). 최상위 폴더가 먼저, 나머지는 경로순.
  // 각 서가 안에서는 최근에 읽은 책이 위로 온다.
  const shelves = $derived.by(() => {
    const groups = new Map<string, { folder: string; books: { book: Book; st: ReturnType<typeof stateOf> }[] }>();
    for (const f of folders) groups.set(f, { folder: f, books: [] });
    for (const book of books) {
      const g = groups.get(book.folder) ?? { folder: book.folder, books: [] };
      g.books.push({ book, st: $readingStates[book.rel] });
      groups.set(book.folder, g);
    }
    // 책이 없는 서가는 보이지 않는다 (서가 만들기 대화상자의 상위 서가 목록에는 그대로 남는다)
    const result = [...groups.values()]
      .filter((g) => g.books.length > 0)
      .sort((a, b) => {
        if (a.folder === b.folder) return 0;
        if (a.folder === '') return -1;
        if (b.folder === '') return 1;
        return a.folder.localeCompare(b.folder, 'ko');
      })
      .map((g) => ({
        key: g.folder,
        folder: g.folder,
        fav: false,
        books: sortBooks(g.books, sortKey),
      }));

    // 즐겨찾기한 책은 위치와 상관없이 맨 위에 모아 보여 준다 (책은 원래 서가에도 그대로 있다)
    const favs = sortBooks(
      books.filter((b) => $readingStates[b.rel]?.favorite).map((book) => ({ book, st: $readingStates[book.rel] })),
      sortKey,
    );
    if (favs.length === 0) return result;
    return [{ key: FAV_KEY, folder: '', fav: true, books: favs }, ...result];
  });

  function toggleFav(book: Book) {
    const st = getState(book.rel);
    if (st) setState(root, setFavorite(st, !st.favorite));
  }

  async function submitCreate({ name, folder }: { name: string; folder: string }) {
    const rel = await createShelf(root, folder, name);
    folders = [...folders, rel].sort((a, b) => a.localeCompare(b, 'ko'));
  }

  async function submitMove({ folder }: { name: string; folder: string }) {
    if (dialog?.mode !== 'move') return;
    const from = dialog.book;
    const moved = await moveBook(root, from, folder);
    books = books.map((b) => (b.rel === from.rel ? moved : b));
    if (covers[from.rel]) {
      covers[moved.rel] = covers[from.rel];
      delete covers[from.rel];
    }
    if (expanded === from.rel) expanded = moved.rel;
  }

  function stateOf(rel: string) {
    return $readingStates[rel];
  }

  const currentState = $derived(current ? $readingStates[current.rel] : undefined);

  async function refresh(r: string) {
    loading = true;
    error = '';
    try {
      const lib = await listBooks(r);
      books = lib.books;
      folders = lib.folders;
      await loadStates(r, books);
      // 표지는 서재 보기에서만 만든다 (큰 책은 내려받는 데 오래 걸린다)
      if (view === 'shelf') void loadCovers(r, books);
      restoreOpenBook();
    } catch (e) {
      error = '책 목록을 불러오지 못했습니다: ' + (e instanceof Error ? e.message : String(e));
    } finally {
      loading = false;
    }
  }

  // 표지는 한 번 만들어 저장해 두고, 다음부터는 그 이미지를 받는다
  async function loadCovers(r: string, list: Book[]) {
    for (const b of list) {
      if (covers[b.rel]) continue;
      const path = coverPath(r, b.rel);
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
        coverUrls.set(b.rel, url);
        covers[b.rel] = url;
      } catch {
        /* 표지가 없으면 제목만 보여 준다 */
      }
    }
  }

  // 폴더가 바뀌면 목록을 다시 읽는다
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

  function title(name: string): string {
    return name.replace(/\.(epub|pdf)$/i, '');
  }

  function shelfName(folder: string): string {
    return folder || '최상위 폴더';
  }

  // 뒤로 가기가 페이지를 벗어나지 않도록, 책과 노트 화면마다 기록(history) 항목을 하나씩 쓴다
  function viewState(): string | undefined {
    return (history.state as { ebookView?: string } | null)?.ebookView;
  }

  // 새로고침해도 읽던 책으로 돌아가도록 연 책의 경로를 기억한다
  const OPEN_KEY = 'ebook.open';
  let restored = false;

  function restoreOpenBook() {
    if (restored || current || notebook) return;
    restored = true;
    try {
      const rel = localStorage.getItem(OPEN_KEY);
      const book = books.find((b) => b.rel === rel);
      if (book) open(book);
    } catch {
      /* ignore */
    }
  }

  function open(book: Book, at = '') {
    const st = getState(book.rel) ?? emptyState(book.rel, now());
    setState(root, startSession(st, now()));
    try {
      localStorage.setItem(OPEN_KEY, book.rel);
    } catch {
      /* ignore */
    }
    // 노트 화면에서 넘어왔다면 그 항목을 책 항목으로 바꿔서 뒤로 가기가 한 번에 목록으로 돌아가게 한다
    if (viewState() === 'notebook') history.replaceState({ ebookView: 'reader' }, '');
    else if (viewState() !== 'reader') history.pushState({ ebookView: 'reader' }, '');
    startAt = at;
    current = book;
  }

  function openNotebook(book: Book) {
    if (viewState() !== 'notebook') history.pushState({ ebookView: 'notebook' }, '');
    notebook = book;
  }

  function leaveNotebook() {
    notebook = null;
    if (viewState() === 'notebook') history.back();
  }

  function openAt(book: Book, position: string) {
    notebook = null;
    open(book, position);
  }

  // 책 기록을 정리하고 목록으로 돌아간다 (뒤로 가기로 들어온 경우에는 기록을 다시 줄이지 않는다)
  function finishReading() {
    try {
      localStorage.removeItem(OPEN_KEY);
    } catch {
      /* ignore */
    }
    if (current) {
      const st = getState(current.rel);
      if (st) setState(root, endSession(st, now()));
    }
    flushStates();
    flushNotes();
    current = null;
    startAt = '';
  }

  function close() {
    finishReading();
    if (viewState() === 'reader') history.back();
  }

  // 브라우저의 뒤로 가기: 책이나 노트 화면을 닫고 목록으로 간다
  function onPopState() {
    if (current) finishReading();
    else if (notebook) notebook = null;
  }

  $effect(() => {
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  });

  function onMove(position: string, label: string) {
    if (!current) return;
    const st = getState(current.rel);
    if (!st || (st.position === position && st.label === label)) return;
    setState(root, movePosition(st, position, label));
  }

  function onHighlight(h: { text: string; position: string; label: string }) {
    if (!current) return;
    const st = getState(current.rel);
    if (st) setState(root, addHighlight(st, { ...h, id: newId(), memo: '', created: now() }));
  }

  function onMemo(id: string, memo: string) {
    const st = current && getState(current.rel);
    if (st) setState(root, updateMemo(st, id, memo));
  }

  function onToggleBookmark() {
    const st = current && getState(current.rel);
    if (st) setState(root, toggleBookmark(st, st.position, st.label, newId(), now()));
  }

  function onAddPageNote(text: string) {
    const st = current && getState(current.rel);
    if (st) setState(root, addPageNote(st, { id: newId(), position: st.position, label: st.label, text, created: now() }));
  }

  function onUpdatePageNote(id: string, text: string) {
    const st = current && getState(current.rel);
    if (st) setState(root, updatePageNote(st, id, text));
  }

  function onRemovePageNote(id: string) {
    const st = current && getState(current.rel);
    if (st) setState(root, removePageNote(st, id));
  }

  // 기록 하나를 지운다. 되돌릴 수 없으므로 한 번 확인한다.
  function deleteRecord(book: Book, kind: 'session' | 'hl' | 'memo' | 'bm', id: string) {
    const st = getState(book.rel);
    if (!st) return;
    const label = kind === 'session' ? '열고 닫은 기록' : kind === 'bm' ? '북마크' : kind === 'memo' ? '메모' : '하이라이트';
    if (!confirm(`이 ${label}을(를) 지울까요?`)) return;
    if (kind === 'session') setState(root, removeSession(st, id));
    else if (kind === 'hl') setState(root, removeHighlight(st, id));
    else if (kind === 'memo') setState(root, removePageNote(st, id));
    else setState(root, removeBookmark(st, id));
  }

  function onRemoveHighlight(id: string) {
    const st = current && getState(current.rel);
    if (st) setState(root, removeHighlight(st, id));
  }
</script>

{#if current && currentState}
  <BookReader
    {root}
    book={current}
    reading={currentState}
    startAt={startAt}
    {onMove}
    {onHighlight}
    {onMemo}
    onRemoveHighlight={onRemoveHighlight}
    onToggleBookmark={onToggleBookmark}
    onAddPageNote={onAddPageNote}
    onUpdatePageNote={onUpdatePageNote}
    onRemovePageNote={onRemovePageNote}
    onClose={close}
  />
{:else if notebook && notebookState}
  <BookNotebook
    {root}
    book={notebook}
    reading={notebookState}
    onBack={leaveNotebook}
    onDelete={(kind, id) => deleteRecord(notebook!, kind, id)}
    onOpen={(pos) => notebook && openAt(notebook, pos)}
  />
{:else}
  <div class="shelf">
    <header class="head">
      <h2>책</h2>
      <span class="count">{books.length}권</span>
      <div class="spacer"></div>
      <select class="sort" value={sortKey} onchange={(e) => setSort((e.currentTarget as HTMLSelectElement).value as SortKey)} aria-label="정렬">
        {#each SORT_KEYS as k (k)}
          <option value={k}>{SORT_LABELS[k]}</option>
        {/each}
      </select>
      <button class="btn" class:on={view === 'list'} onclick={() => setView('list')} title="목록 보기" aria-label="목록 보기">
        <i class="fa-solid fa-list"></i>
      </button>
      <button class="btn" class:on={view === 'shelf'} onclick={() => setView('shelf')} title="서재 보기" aria-label="서재 보기">
        <i class="fa-solid fa-table-cells-large"></i>
      </button>
      <button class="btn" onclick={() => (dialog = { mode: 'create' })} disabled={loading} title="서가 만들기" aria-label="서가 만들기">
        <i class="fa-solid fa-folder-plus"></i>
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
      <p class="msg">이 폴더와 하위 폴더에서 EPUB 또는 PDF 파일을 찾지 못했습니다.</p>
    {:else}
      {#each shelves as shelf (shelf.key)}
        <section class="shelf-group">
          <h3 class="shelf-title">
            <button
              class="shelf-toggle"
              onclick={() => toggleShelf(shelf.key)}
              aria-expanded={!collapsed.includes(shelf.key)}
            >
              <i class="fa-solid fa-chevron-{collapsed.includes(shelf.key) ? 'right' : 'down'} chev"></i>
              {#if shelf.fav}
                <i class="fa-solid fa-star fav-ico"></i> 즐겨찾기
              {:else}
                <i class="fa-solid fa-folder"></i> {shelfName(shelf.folder)}
              {/if}
              <span class="count">{shelf.books.length}권</span>
            </button>
          </h3>

          {#if collapsed.includes(shelf.key)}
            <!-- 접힌 서가 -->
          {:else if view === 'shelf'}
            <ul class="shelf-grid">
              {#each shelf.books as { book, st } (book.rel)}
                <li>
                  <button class="cover-card" onclick={() => open(book)} title={book.name}>
                    {#if covers[book.rel]}
                      <img src={covers[book.rel]} alt="" />
                    {:else}
                      <span class="placeholder">
                        <i class="fa-solid {book.kind === 'pdf' ? 'fa-file-pdf' : 'fa-book'}"></i>
                        <span>{title(book.name)}</span>
                      </span>
                    {/if}
                  </button>
                  <div class="cap">{title(book.name)}</div>
                  {#if shelf.fav}<div class="sub">{book.folder || '최상위 폴더'}</div>{/if}
                  {#if st && lastActivity(st)}<div class="sub">{fmt(lastActivity(st))}</div>{/if}
                  <div class="card-actions">
                    <button class="btn mv" class:on={st?.favorite} onclick={() => toggleFav(book)} title="즐겨찾기" aria-label="즐겨찾기">
                      <i class="fa-{st?.favorite ? 'solid' : 'regular'} fa-star"></i>
                    </button>
                    <button class="btn mv" onclick={() => (dialog = { mode: 'move', book })} title="서가로 옮기기" aria-label="서가로 옮기기">
                      <i class="fa-solid fa-arrow-right-arrow-left"></i>
                    </button>
                  </div>
                </li>
              {/each}
            </ul>
          {:else}
            <ul class="list">
              {#each shelf.books as { book, st } (book.rel)}
                <li class="item">
                  <div class="row">
                    <button class="open" onclick={() => open(book)}>
                      <i class="fa-solid {book.kind === 'pdf' ? 'fa-file-pdf' : 'fa-book'}"></i>
                      <span class="name">{book.name}</span>
                    </button>
                    <button class="btn" class:on={st?.favorite} onclick={() => toggleFav(book)} title="즐겨찾기" aria-label="즐겨찾기">
                      <i class="fa-{st?.favorite ? 'solid' : 'regular'} fa-star"></i>
                    </button>
                    <button class="btn" onclick={() => openNotebook(book)} title="노트 보기" aria-label="노트 보기">
                      <i class="fa-solid fa-book-open"></i>
                    </button>
                    <button class="btn" onclick={() => (dialog = { mode: 'move', book })} title="서가로 옮기기" aria-label="서가로 옮기기">
                      <i class="fa-solid fa-arrow-right-arrow-left"></i>
                    </button>
                    <button
                      class="btn"
                      class:on={expanded === book.rel}
                      onclick={() => (expanded = expanded === book.rel ? null : book.rel)}
                      title="읽기 기록"
                      aria-label="읽기 기록"
                    >
                      <i class="fa-solid fa-clock-rotate-left"></i>
                    </button>
                  </div>
                  <div class="meta">
                    {#if shelf.fav}{book.folder || '최상위 폴더'} · {/if}
                    추가 {fmt(st?.firstSeen)} · 마지막 {fmt(lastActivity(st))}
                    {#if st?.label}· {st.label}{/if}
                    {#if st && st.highlights.length}· 하이라이트 {st.highlights.length}{/if}
                  </div>

                  {#if expanded === book.rel && st}
                    <div class="history">
                      {#if st.sessions.length === 0}
                        <p class="msg">아직 연 기록이 없습니다.</p>
                      {/if}
                      {#each [...st.sessions].reverse() as s (s.opened)}
                        <div class="sess">
                          {fmt(s.opened)} → {s.closed ? fmt(s.closed) : '읽는 중'}
                          <span class="loc">{s.label || '-'}</span>
                          <button class="x" onclick={() => deleteRecord(book, 'session', s.opened)} title="이 기록 지우기" aria-label="이 기록 지우기">
                            <i class="fa-solid fa-xmark"></i>
                          </button>
                        </div>
                      {/each}
                      {#each st.highlights as h (h.id)}
                        <div class="sess quote">
                          “{h.text}”
                          {#if h.memo}<span class="memo">— {h.memo}</span>{/if}
                          <span class="loc">({h.label})</span>
                          <button class="x" onclick={() => deleteRecord(book, 'hl', h.id)} title="이 하이라이트 지우기" aria-label="이 하이라이트 지우기">
                            <i class="fa-solid fa-xmark"></i>
                          </button>
                        </div>
                      {/each}
                    </div>
                  {/if}
                </li>
              {/each}
            </ul>
          {/if}
        </section>
      {/each}
    {/if}
  </div>
{/if}

{#if dialog?.mode === 'create'}
  <ShelfDialog mode="create" shelves={folders} onSubmit={submitCreate} onClose={() => (dialog = null)} />
{:else if dialog?.mode === 'move'}
  <ShelfDialog
    mode="move"
    shelves={folders}
    current={dialog.book.folder}
    bookName={dialog.book.name}
    onSubmit={submitMove}
    onClose={() => (dialog = null)}
  />
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
    font-weight: 400;
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
  .shelf-group {
    margin-bottom: 1.6rem;
  }
  .shelf-title {
    margin: 0 0 0.6rem;
    padding-bottom: 0.3rem;
    font-size: 0.95rem;
    border-bottom: 2px solid var(--border);
  }
  .shelf-toggle {
    display: flex;
    align-items: center;
    gap: 0.45rem;
    width: 100%;
    background: none;
    border: none;
    color: var(--text);
    font: inherit;
    font-weight: 700;
    text-align: left;
    padding: 0.1rem 0;
    cursor: pointer;
  }
  .shelf-toggle:hover {
    color: var(--accent);
  }
  .shelf-toggle .fa-folder {
    color: var(--text-muted);
  }
  .chev {
    width: 0.9rem;
    color: var(--text-muted);
    font-size: 0.8rem;
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
  .x {
    background: none;
    border: none;
    color: var(--text-muted);
    padding: 0 0.3rem;
    margin-left: 0.3rem;
    font-size: 0.75rem;
  }
  .x:hover {
    color: #c0392b;
  }
  .loc,
  .memo {
    color: var(--text-muted);
    margin-left: 0.3rem;
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
  .btn.mv {
    padding: 0.2rem 0.4rem;
    font-size: 0.8rem;
  }
  .card-actions {
    display: flex;
    gap: 0.2rem;
    margin-top: 0.2rem;
  }
  .btn.on {
    color: #d4a017;
  }
  .fav-ico {
    color: #d4a017;
  }
  .sort {
    font: inherit;
    font-size: 0.85rem;
    color: var(--text);
    background: var(--bg-alt);
    border: 1px solid var(--border);
    border-radius: 6px;
    padding: 0.25rem 0.4rem;
  }
</style>
