<script lang="ts">
  /**
   * 책 하나의 독서 노트를 게시글처럼 모아 보는 화면.
   * 독서 노트 전문을 위에 두고, 북마크·페이지 메모·하이라이트를 최근순 카드로 이어 보여 준다.
   */
  import { marked } from 'marked';
  import { loadNote } from '../stores/bookNotes';
  import type { Book, ReadingState } from '../lib/ebook/state';

  interface Props {
    root: string;
    book: Book;
    reading: ReadingState;
    onBack: () => void;
    onOpen: (position: string) => void;
  }
  let { root, book, reading, onBack, onOpen }: Props = $props();

  type Entry = {
    key: string;
    kind: 'hl' | 'memo' | 'bm';
    created: string;
    label: string;
    position: string;
    title: string;
    body: string;
  };

  const KIND_LABEL = { hl: '하이라이트', memo: '메모', bm: '북마크' } as const;

  let noteHtml = $state<string | null>(null);

  $effect(() => {
    const rel = book.rel;
    noteHtml = null;
    let alive = true;
    void loadNote(root, rel).then((text) => {
      if (!alive) return;
      noteHtml = text.trim() ? (marked.parse(text, { async: false }) as string) : '';
    });
    return () => {
      alive = false;
    };
  });

  // 최근에 남긴 것이 위로 오도록 한 줄의 흐름으로 합친다
  const entries = $derived.by<Entry[]>(() => {
    const list: Entry[] = [];
    for (const h of reading.highlights) {
      list.push({ key: 'h' + h.id, kind: 'hl', created: h.created, label: h.label, position: h.position, title: h.text, body: h.memo });
    }
    for (const n of reading.pageNotes ?? []) {
      list.push({ key: 'm' + n.id, kind: 'memo', created: n.created, label: n.label, position: n.position, title: '', body: n.text });
    }
    for (const b of reading.bookmarks ?? []) {
      list.push({ key: 'b' + b.id, kind: 'bm', created: b.created, label: b.label, position: b.position, title: '', body: '' });
    }
    return list.sort((a, b) => b.created.localeCompare(a.created));
  });

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

  const lastRead = $derived(reading.sessions.length ? (reading.sessions[reading.sessions.length - 1].closed ?? reading.sessions[reading.sessions.length - 1].opened) : null);
</script>

<div class="notebook">
  <header class="top">
    <button class="btn" onclick={onBack}><i class="fa-solid fa-arrow-left"></i> 책 목록</button>
    <span class="title" title={book.name}>{book.name.replace(/\.(epub|pdf)$/i, '')}</span>
  </header>

  <article class="post">
    <div class="meta">
      추가 {fmt(reading.firstSeen)} · 마지막 {fmt(lastRead)}
      {#if reading.label}· {reading.label}{/if}
      · 북마크 {(reading.bookmarks ?? []).length} · 메모 {(reading.pageNotes ?? []).length} · 하이라이트 {reading.highlights.length}
    </div>

    <section class="note-body">
      <h2>독서 노트</h2>
      {#if noteHtml === null}
        <p class="empty">불러오는 중…</p>
      {:else if noteHtml === ''}
        <p class="empty">아직 독서 노트가 없습니다. 책을 읽으면서 독서 노트 탭에 적어 보세요.</p>
      {:else}
        <div class="markdown">{@html noteHtml}</div>
      {/if}
    </section>

    <section class="feed">
      <h2>기록</h2>
      {#if entries.length === 0}
        <p class="empty">북마크, 메모, 하이라이트가 없습니다.</p>
      {/if}
      {#each entries as e (e.key)}
        <div class="card kind-{e.kind}">
          <div class="card-head">
            <span class="badge">{KIND_LABEL[e.kind]}</span>
            <span class="loc">{e.label || '-'}</span>
            <span class="date">{fmt(e.created)}</span>
          </div>
          {#if e.title}<blockquote>{e.title}</blockquote>{/if}
          {#if e.body}<p class="body">{e.body}</p>{/if}
          <button class="btn go" onclick={() => onOpen(e.position)}><i class="fa-solid fa-arrow-up-right-from-square"></i> 이 위치로 가기</button>
        </div>
      {/each}
    </section>
  </article>
</div>

<style>
  .notebook {
    display: flex;
    flex-direction: column;
    flex: 1;
    min-height: 0;
    background: var(--bg);
    color: var(--text);
  }
  .top {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    padding: 0.4rem 0.6rem;
    border-bottom: 1px solid var(--border);
    background: var(--bg-alt);
  }
  .title {
    font-weight: 700;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .btn {
    background: none;
    border: 1px solid transparent;
    border-radius: 6px;
    color: var(--text);
    padding: 0.3rem 0.5rem;
    white-space: nowrap;
  }
  .btn:hover {
    background: var(--bg-elev);
  }
  .post {
    flex: 1;
    overflow-y: auto;
    max-width: 760px;
    width: 100%;
    margin: 0 auto;
    padding: 1.2rem clamp(0.8rem, 3vw, 2rem) 3rem;
  }
  .meta {
    color: var(--text-muted);
    font-size: 0.85rem;
    margin-bottom: 1rem;
  }
  h2 {
    font-size: 1.05rem;
    margin: 1.4rem 0 0.6rem;
    padding-bottom: 0.3rem;
    border-bottom: 2px solid var(--border);
  }
  .empty {
    color: var(--text-muted);
    font-size: 0.9rem;
  }
  .markdown {
    line-height: 1.7;
    font-size: 0.95rem;
  }
  .markdown :global(h1),
  .markdown :global(h2),
  .markdown :global(h3) {
    font-size: 1rem;
  }
  .markdown :global(blockquote) {
    margin: 0.5rem 0;
    padding-left: 0.8rem;
    border-left: 3px solid var(--accent);
    color: var(--text-muted);
  }
  .card {
    border: 1px solid var(--border);
    border-radius: 10px;
    padding: 0.7rem 0.9rem;
    margin-bottom: 0.7rem;
    background: var(--bg-alt);
  }
  .card-head {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.5rem;
    font-size: 0.8rem;
    color: var(--text-muted);
    margin-bottom: 0.4rem;
  }
  .badge {
    font-weight: 700;
    color: var(--accent);
    background: var(--accent-soft);
    border-radius: 4px;
    padding: 0.05rem 0.4rem;
  }
  .kind-hl .badge {
    color: #b7791f;
    background: rgba(255, 213, 79, 0.35);
  }
  .kind-bm .badge {
    color: #2b7a4b;
    background: rgba(43, 122, 75, 0.14);
  }
  .date {
    margin-left: auto;
  }
  blockquote {
    margin: 0.3rem 0;
    padding: 0.2rem 0.7rem;
    border-left: 3px solid var(--border);
    font-style: italic;
    color: var(--text);
  }
  .body {
    margin: 0.3rem 0;
    white-space: pre-wrap;
    line-height: 1.6;
  }
  .go {
    font-size: 0.8rem;
    padding: 0.15rem 0.4rem;
    color: var(--accent);
  }
</style>
