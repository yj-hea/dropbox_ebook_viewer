<script lang="ts">
  import { downloadBytes } from '../lib/dropbox/api';
  import { bookmarkAt, type Book, type Highlight, type ReadingState } from '../lib/ebook/state';
  import { documentParams, loadPdfJs } from '../lib/ebook/pdfjs';
  import { loadNote, scheduleNote } from '../stores/bookNotes';
  import 'pdfjs-dist/web/pdf_viewer.css';

  interface Props {
    root: string;
    book: Book;
    reading: ReadingState;
    /** 처음 열 위치 (없으면 마지막으로 읽던 곳) */
    startAt?: string;
    onMove: (position: string, label: string) => void;
    onHighlight: (h: Omit<Highlight, 'id' | 'memo' | 'created'>) => void;
    onMemo: (id: string, memo: string) => void;
    onRemoveHighlight: (id: string) => void;
    onToggleBookmark: () => void;
    onAddPageNote: (text: string) => void;
    onUpdatePageNote: (id: string, text: string) => void;
    onRemovePageNote: (id: string) => void;
    onClose: () => void;
  }
  let {
    root,
    book,
    reading,
    startAt = '',
    onMove,
    onHighlight,
    onMemo,
    onRemoveHighlight,
    onToggleBookmark,
    onAddPageNote,
    onUpdatePageNote,
    onRemovePageNote,
    onClose,
  }: Props = $props();

  let newPageNote = $state('');
  const bookmarked = $derived(!!bookmarkAt(reading, reading.position));

  type Pending = { text: string; position: string; label: string };
  type Toc = { label: string; href: string };

  let stage = $state<HTMLDivElement>();
  let status = $state('불러오는 중…');
  let failed = $state(false);
  let pending = $state<Pending | null>(null);
  let panelOpen = $state(false);
  let tocOpen = $state(false);
  let toc = $state<Toc[]>([]);

  // PDF 상태
  let pageNo = $state(1);
  let pageCount = $state(0);
  let pdfRow = $state<HTMLDivElement>();
  let readerEl = $state<HTMLDivElement>();
  let fullscreen = $state(false);
  // 집중 모드: 툴바를 숨기고 책 영역만 남긴다. 버튼을 누르면 툴바가 잠깐 위에 뜬다.
  let focus = $state(false);
  let peek = $state(false);
  // iOS 사파리는 화면 일부를 전체 화면으로 만들 수 없어서 버튼을 숨긴다
  const canFullscreen = typeof document !== 'undefined' && !!document.documentElement.requestFullscreen;
  // 두 쪽 보기 (기기에 기억)
  let spread = $state(readSpread());
  // 터치 기기는 탭 영역 넘김을 쓰지 않고 드래그로만 넘긴다
  const touchDevice = typeof window !== 'undefined' && window.matchMedia('(pointer: coarse)').matches;
  let pdfDoc: { numPages: number; getPage: (n: number) => Promise<any>; cleanup?: () => Promise<unknown> } | null = null;
  let renderSeq = 0;

  // EPUB 상태
  let rendition: any = null;
  let epubBook: any = null;
  let epubLabel = '';
  let resizeObserver: ResizeObserver | null = null;
  let pdfResizeObserver: ResizeObserver | null = null;

  const isEpub = $derived(book.kind === 'epub');

  // 독서 노트: 책을 열 때 읽고, 입력이 멈추면 자동으로 저장한다
  let noteText = $state<string | null>(null);
  let noteError = $state('');
  let panelTab = $state<'hl' | 'memo' | 'note'>('hl');

  $effect(() => {
    const rel = book.rel;
    noteText = null;
    noteError = '';
    let alive = true;
    void loadNote(root, rel)
      .then((t) => {
        if (alive) noteText = t;
      })
      .catch(() => {
        // 읽기에 실패하면 입력을 막아 기존 노트가 빈 내용으로 덮이지 않게 한다
        if (alive) noteError = '독서 노트를 불러오지 못했습니다. 책을 다시 열어 주세요.';
      });
    return () => {
      alive = false;
    };
  });

  function onNoteInput(text: string) {
    noteText = text;
    scheduleNote(root, book.rel, text);
  }

  // 하이라이트와 메모를 노트 끝에 인용으로 덧붙인다
  function appendToNote(h: Highlight) {
    const quote = `> ${h.text}`;
    const extra = h.memo ? `\n\n${h.memo}` : '';
    const add = `${quote}${extra}\n`;
    onNoteInput(noteText ? `${noteText.trimEnd()}\n\n${add}` : add);
    panelTab = 'note';
    panelOpen = true;
  }

  // 책이 바뀌면 해당 형식의 뷰어를 새로 만든다
  $effect(() => {
    const el = stage;
    const path = book.path;
    if (!el) return;
    let alive = true;
    void (async () => {
      status = '불러오는 중…';
      failed = false;
      try {
        const bytes = await downloadBytes(path);
        if (!alive) return;
        if (!bytes) throw new Error('파일을 찾을 수 없습니다.');
        if (book.kind === 'epub') await openEpub(el, bytes);
        else await openPdf(bytes);
        if (alive) status = '';
      } catch (e) {
        if (!alive) return;
        failed = true;
        status = '열지 못했습니다: ' + (e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      alive = false;
      closeViewer();
    };
  });

  function closeViewer() {
    resizeObserver?.disconnect();
    resizeObserver = null;
    pdfResizeObserver?.disconnect();
    pdfResizeObserver = null;
    rendition?.destroy?.();
    rendition = null;
    epubBook?.destroy?.();
    epubBook = null;
    // destroy()는 공용 워커까지 끝내서 다음 책이 열리지 않으므로, 쪽 데이터만 비운다
    void pdfDoc?.cleanup?.().catch(() => {});
    pdfDoc = null;
    for (const t of renderTasks) t.cancel();
    renderTasks = [];
    renderSeq++;
    pending = null;
    toc = [];
  }

  // ── EPUB ──
  async function openEpub(el: HTMLDivElement, bytes: ArrayBuffer) {
    const { default: ePub } = await import('epubjs');
    epubBook = ePub(bytes);
    rendition = epubBook.renderTo(el, {
      width: el.clientWidth,
      height: el.clientHeight,
      flow: 'paginated',
      spread: 'none',
      // 두 쪽 보기에서 양쪽 쪽 사이 여백을 없앤다 (기본값은 여백이 생긴다)
      gap: 0,
    });
    if (spread) rendition.spread('always');

    epubBook.loaded.navigation.then((nav: { toc: { label: string; href: string }[] }) => {
      toc = nav.toc.map((t: { label: string; href: string }) => ({ label: t.label.trim(), href: t.href }));
    });

    rendition.on('relocated', (loc: any) => {
      const href = String(loc.start.href ?? '').split('#')[0];
      const chapter = toc.find((t: Toc) => t.href.split('#')[0] === href)?.label ?? '';
      const page = loc.start.displayed?.page ?? 0;
      const total = loc.start.displayed?.total ?? 0;
      epubLabel = [chapter, total > 0 ? `${page}/${total}` : ''].filter(Boolean).join(' · ');
      onMove(loc.start.cfi, epubLabel);
    });

    rendition.on('selected', async (cfiRange: string) => {
      const range = await epubBook.getRange(cfiRange);
      const text = String(range?.toString() ?? '').trim();
      if (text) pending = { text, position: cfiRange, label: epubLabel };
    });

    // 본문은 iframe 안에 그려져서 바깥의 휠·클릭·키 이벤트가 닿지 않는다. 안쪽 문서에 직접 붙인다.
    rendition.hooks.content.register((contents: { document: Document }) => {
      const doc = contents.document;
      doc.addEventListener('wheel', (e: WheelEvent) => {
        e.preventDefault();
        turnByWheel(e.deltaY);
      }, { passive: false });
      doc.addEventListener('click', (e: MouseEvent) => {
        if (e.target instanceof Element && e.target.closest('a')) return;
        if (doc.getSelection()?.toString()) return;
        if (touchDevice) return;
        const x = e.clientX / Math.max(doc.defaultView?.innerWidth ?? doc.documentElement.clientWidth, 1);
        if (x < 0.3) prev();
        else if (x > 0.7) next();
      });
      doc.addEventListener('keydown', (e: KeyboardEvent) => onKey(e));
      doc.addEventListener('touchstart', (e: TouchEvent) => swipeStart(e.touches[0]), { passive: true });
      doc.addEventListener('touchend', (e: TouchEvent) => swipeEnd(e.changedTouches[0]), { passive: true });
    });

    for (const h of reading.highlights) paintEpub(h.position);

    await rendition.display(startAt || reading.position || undefined);

    resizeObserver = new ResizeObserver(() => rendition?.resize(el.clientWidth, el.clientHeight));
    resizeObserver.observe(el);
  }

  function paintEpub(cfi: string) {
    rendition?.annotations.highlight(cfi, {}, () => {}, 'hl', { fill: 'rgba(255, 213, 79, 0.5)' });
  }

  // 터치 좌우 스와이프로 쪽 넘기기. 세로로 스크롤하는 동작과는 구분한다.
  let swipeFrom: { x: number; y: number } | null = null;
  // 손가락이 화면에 있는 동안에는 쪽을 다시 그리지 않는다. 다시 그리면 터치 대상이 사라져서 넘김이 끊긴다.
  let touching = false;
  let deferredRender: number | null = null;

  function endTouch() {
    touching = false;
    if (deferredRender !== null) {
      const n = deferredRender;
      deferredRender = null;
      void renderPdf(n);
    }
  }

  function swipeStart(t: Touch | undefined) {
    touching = true;
    swipeFrom = t ? { x: t.clientX, y: t.clientY } : null;
  }
  function swipeEnd(t: Touch | undefined) {
    const from = swipeFrom;
    swipeFrom = null;
    endTouch();
    if (!from || !t) return;
    const dx = t.clientX - from.x;
    const dy = t.clientY - from.y;
    if (Math.abs(dx) < 50 || Math.abs(dx) < Math.abs(dy) * 1.5) return;
    if (dx < 0) next();
    else prev();
  }

  // 휠 한 번으로 여러 쪽이 넘어가지 않도록 잠시 쉰다
  let wheelLock = 0;
  let wheelSum = 0;
  function turnByWheel(deltaY: number) {
    const now = Date.now();
    if (now < wheelLock) return;
    wheelSum += deltaY;
    if (Math.abs(wheelSum) < 40) return;
    if (wheelSum > 0) next();
    else prev();
    wheelSum = 0;
    wheelLock = now + 350;
  }

  function epubGo(href: string) {
    void rendition?.display(href);
    tocOpen = false;
  }

  // ── PDF ──
  async function openPdf(bytes: ArrayBuffer) {
    const pdfjs = await loadPdfJs();
    const doc = await pdfjs.getDocument(documentParams(pdfjs, new Uint8Array(bytes))).promise;
    pdfDoc = doc as unknown as typeof pdfDoc;
    pageCount = doc.numPages;
    const start = Math.min(Math.max(Number(startAt || reading.position) || 1, 1), pageCount);
    await renderPdf(start, pdfjs);

    // 창 크기가 바뀌면 같은 쪽을 다시 맞춘다
    let timer: ReturnType<typeof setTimeout> | undefined;
    pdfResizeObserver = new ResizeObserver(() => {
      clearTimeout(timer);
      timer = setTimeout(() => void renderPdf(pageNo), 150);
    });
    if (stage) pdfResizeObserver.observe(stage);
  }

  // 진행 중인 쪽 그리기. 새로 그릴 때 취소해서 서로 겹치지 않게 한다.
  let renderTasks: { cancel: () => void; promise: Promise<void> }[] = [];
  // 모바일 브라우저가 감당하는 캔버스 픽셀 수 한계 (넘으면 쪽이 백지로 보인다)
  const MAX_CANVAS_PIXELS = 12_000_000;

  async function renderPdf(n: number, pdfjs?: typeof import('pdfjs-dist')) {
    if (!pdfDoc || !pdfRow || !stage) return;
    if (touching) {
      deferredRender = n;
      return;
    }
    const seq = ++renderSeq;
    for (const t of renderTasks) t.cancel();
    renderTasks = [];
    const lib = pdfjs ?? (await import('pdfjs-dist'));
    // 두 쪽 보기면 n과 n+1을 나란히 그린다 (마지막 쪽이면 한 쪽만)
    const nums = spread && n + 1 <= pageCount ? [n, n + 1] : [n];
    const pages = await Promise.all(nums.map((i) => pdfDoc!.getPage(i)));
    if (seq !== renderSeq) return;

    // 두 쪽 보기에서 양쪽 쪽이 맞닿도록 간격을 두지 않는다
    const availW = Math.max(stage.clientWidth - 32, 200);
    const availH = Math.max(stage.clientHeight - 32, 200);
    const boxW = availW / pages.length;
    const dpr = window.devicePixelRatio || 1;

    pdfRow.replaceChildren();
    for (const page of pages) {
      // 쪽 전체가 칸 안에 들어가도록 가로와 세로 중 더 빡빡한 쪽에 맞춘다
      const base = page.getViewport({ scale: 1 });
      const viewport = page.getViewport({ scale: Math.min(boxW / base.width, availH / base.height) });

      const wrap = document.createElement('div');
      wrap.className = 'pdf-page';
      wrap.style.width = `${viewport.width}px`;
      wrap.style.height = `${viewport.height}px`;
      const canvas = document.createElement('canvas');
      const scale = Math.min(dpr, Math.sqrt(MAX_CANVAS_PIXELS / (viewport.width * viewport.height)));
      canvas.width = Math.floor(viewport.width * scale);
      canvas.height = Math.floor(viewport.height * scale);
      canvas.style.width = `${viewport.width}px`;
      canvas.style.height = `${viewport.height}px`;
      const textDiv = document.createElement('div');
      textDiv.className = 'textLayer';
      textDiv.style.width = `${viewport.width}px`;
      textDiv.style.height = `${viewport.height}px`;
      wrap.append(canvas, textDiv);
      pdfRow.appendChild(wrap);

      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('캔버스를 만들 수 없습니다.');
      const task = page.render({ canvasContext: ctx, viewport, transform: [scale, 0, 0, scale, 0, 0] });
      renderTasks.push(task);
      try {
        await task.promise;
      } catch (err) {
        // 더 새로운 그리기가 시작되어 취소된 것이면 조용히 끝낸다
        if (seq !== renderSeq) return;
        throw err;
      }
      if (seq !== renderSeq) return;

      // 글자 층: 드래그로 고를 수 있게 캔버스 위에 올린다
      const layer = new lib.TextLayer({
        textContentSource: page.streamTextContent(),
        container: textDiv,
        viewport,
      });
      await layer.render();
      if (seq !== renderSeq) return;
    }

    pageNo = n;
    const label = nums.length > 1 ? `${nums[0]}–${nums[1]}쪽 / ${pageCount}` : `${n}쪽 / ${pageCount}`;
    onMove(String(n), label);
  }

  function readSpread(): boolean {
    try {
      return localStorage.getItem('ebook.spread') === '1';
    } catch {
      return false;
    }
  }

  function toggleFullscreen() {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void readerEl?.requestFullscreen?.();
  }

  function onFullscreenChange() {
    fullscreen = !!document.fullscreenElement;
  }

  function toggleSpread() {
    spread = !spread;
    try {
      localStorage.setItem('ebook.spread', spread ? '1' : '0');
    } catch {
      /* ignore */
    }
    if (isEpub) rendition?.spread(spread ? 'always' : 'none');
    else void renderPdf(pageNo);
  }

  function pdfGo(n: number) {
    if (!pdfDoc) return;
    const target = Math.min(Math.max(n, 1), pageCount);
    pageNo = target;
    void renderPdf(target);
  }

  // 쪽을 클릭하면 왼쪽 3분의 1은 이전, 오른쪽 3분의 1은 다음 쪽 (드래그로 고른 글은 제외, 터치 기기는 드래그만 쓴다)
  function onPdfClick(e: MouseEvent) {
    if (touchDevice || window.getSelection()?.toString()) return;
    const box = (e.target as HTMLElement).closest?.('.pdf-page') as HTMLElement | null;
    if (!box) return;
    const r = box.getBoundingClientRect();
    const x = (e.clientX - r.left) / Math.max(r.width, 1);
    if (x < 0.33) prev();
    else if (x > 0.67) next();
  }

  function onPdfMouseUp() {
    const sel = window.getSelection();
    const text = sel?.toString().trim() ?? '';
    if (!text || !pdfRow || !sel?.anchorNode || !pdfRow.contains(sel.anchorNode)) return;
    pending = { text, position: String(pageNo), label: `${pageNo}쪽 / ${pageCount}` };
  }

  // ── 공통 조작 ──
  function prev() {
    if (isEpub) void rendition?.prev();
    else pdfGo(pageNo - (spread ? 2 : 1));
  }
  function next() {
    if (isEpub) void rendition?.next();
    else pdfGo(pageNo + (spread ? 2 : 1));
  }

  function saveHighlight() {
    if (!pending) return;
    onHighlight({ text: pending.text, position: pending.position, label: pending.label });
    if (isEpub) paintEpub(pending.position);
    pending = null;
    window.getSelection()?.removeAllRanges();
  }

  function removeHighlight(h: Highlight) {
    if (isEpub) rendition?.annotations.remove(h.position, 'highlight');
    onRemoveHighlight(h.id);
  }

  // 위치(EPUB: CFI, PDF: 쪽 번호)로 이동한다
  function jumpTo(position: string) {
    if (isEpub) void rendition?.display(position);
    else pdfGo(Number(position));
  }

  function jump(h: Highlight) {
    jumpTo(h.position);
  }

  function addPageNote() {
    const text = newPageNote.trim();
    if (!text) return;
    onAddPageNote(text);
    newPageNote = '';
  }

  function toggleFocus() {
    focus = !focus;
    peek = false;
  }

  function onKey(e: KeyboardEvent) {
    const t = e.target as HTMLElement;
    if (e.key === 'Escape' && focus) {
      toggleFocus();
      return;
    }
    if (t.closest?.('textarea, input')) return;
    if (e.key === 'ArrowRight' || e.key === 'PageDown') next();
    if (e.key === 'ArrowLeft' || e.key === 'PageUp') prev();
  }
</script>

<svelte:window onkeydown={onKey} />
<svelte:document onfullscreenchange={onFullscreenChange} />

<div class="reader" bind:this={readerEl}>
  {#if focus && !peek}
    <button class="float-btn" onclick={() => (peek = true)} title="도구 보이기" aria-label="도구 보이기">
      <i class="fa-solid fa-sliders"></i>
    </button>
  {/if}

  <div class="toolbar" class:overlay={focus} class:is-hidden={focus && !peek}>
    <button class="btn" onclick={onClose}><i class="fa-solid fa-arrow-left"></i> 책 목록</button>
    <span class="title" title={book.name}>{book.name}</span>
    <div class="spacer"></div>
    {#if isEpub && toc.length}
      <button class="btn" class:on={tocOpen} onclick={() => (tocOpen = !tocOpen)} title="목차">
        <i class="fa-solid fa-list-ul"></i>
      </button>
    {/if}
    <button class="btn" onclick={prev} title="이전 (←)" aria-label="이전"><i class="fa-solid fa-chevron-left"></i></button>
    {#if !isEpub}
      <span class="page">{pageNo} / {pageCount}</span>
    {/if}
    <button class="btn" onclick={next} title="다음 (→)" aria-label="다음"><i class="fa-solid fa-chevron-right"></i></button>
    <div class="break"></div>
    <button class="btn" class:on={focus} onclick={toggleFocus} title="집중 모드 (Esc로 끝내기)" aria-label="집중 모드">
      <i class="fa-solid fa-eye"></i>
    </button>
    {#if canFullscreen}
      <button class="btn" class:on={fullscreen} onclick={toggleFullscreen} title={fullscreen ? '전체 화면 끝내기' : '전체 화면'} aria-label="전체 화면">
        <i class="fa-solid {fullscreen ? 'fa-compress' : 'fa-expand'}"></i>
      </button>
    {/if}
    <button class="btn" class:on={spread} onclick={toggleSpread} title="두 쪽 보기" aria-label="두 쪽 보기">
      <i class="fa-solid fa-table-columns"></i>
    </button>
    <button class="btn" disabled={!pending} onclick={saveHighlight} title="선택한 글 하이라이트">
      <i class="fa-solid fa-highlighter"></i> 하이라이트
    </button>
    <button class="btn" class:on={bookmarked} onclick={onToggleBookmark} title={bookmarked ? '이 위치 북마크 해제' : '이 위치 북마크'} aria-label="북마크">
      <i class="fa-{bookmarked ? 'solid' : 'regular'} fa-bookmark"></i>
    </button>
    <button class="btn" class:on={panelOpen && panelTab === 'memo'} onclick={() => { panelTab = 'memo'; panelOpen = true; }} title="이 위치에 메모" aria-label="페이지 메모">
      <i class="fa-solid fa-pen"></i>
    </button>
    <button class="btn" class:on={panelOpen} onclick={() => (panelOpen = !panelOpen)} title="하이라이트와 독서 노트">
      <i class="fa-solid fa-note-sticky"></i> {reading.highlights.length}
    </button>
  </div>

  <div class="body">
    {#if status}
      <p class="status" class:err={failed}>{status}</p>
    {/if}

    {#if isEpub}
      <div class="epub-frame">
        <div class="epub-stage" bind:this={stage}></div>
      </div>
      {#if tocOpen}
        <ul class="toc">
          {#each toc as t (t.href + t.label)}
            <li><button onclick={() => epubGo(t.href)}>{t.label}</button></li>
          {/each}
        </ul>
      {/if}
    {:else}
      <div
        class="pdf-stage"
        bind:this={stage}
        onmouseup={onPdfMouseUp}
        onclick={onPdfClick}
        ontouchstart={(e) => swipeStart(e.touches[0])}
        ontouchend={(e) => swipeEnd(e.changedTouches[0])}
        ontouchcancel={() => {
          swipeFrom = null;
          endTouch();
        }}
        role="presentation"
      >
        <div class="pdf-row" bind:this={pdfRow}></div>
      </div>
    {/if}

    {#if panelOpen}
      <aside class="panel">
        <header>
          <div class="tabs2">
            <button class:on={panelTab === 'hl'} onclick={() => (panelTab = 'hl')}>하이라이트 {reading.highlights.length}</button>
            <button class:on={panelTab === 'memo'} onclick={() => (panelTab = 'memo')}>메모·북마크</button>
            <button class:on={panelTab === 'note'} onclick={() => (panelTab = 'note')}>독서 노트</button>
          </div>
          <button class="btn" onclick={() => (panelOpen = false)} aria-label="닫기"><i class="fa-solid fa-xmark"></i></button>
        </header>
        {#if panelTab === 'memo'}
          <div class="memo-tab">
            <div class="add-memo">
              <span class="loc">현재 위치: {reading.label || '-'}</span>
              <textarea rows="3" bind:value={newPageNote} placeholder="이 위치에 남길 메모"></textarea>
              <button class="btn primary" onclick={addPageNote} disabled={!newPageNote.trim()}>메모 추가</button>
            </div>
            {#each reading.pageNotes ?? [] as n (n.id)}
              <div class="hl">
                <button class="quote" onclick={() => jumpTo(n.position)}>{n.label}</button>
                <textarea rows="2" value={n.text} onchange={(e) => onUpdatePageNote(n.id, (e.currentTarget as HTMLTextAreaElement).value)}></textarea>
                <div class="hl-actions">
                  <button class="btn danger" onclick={() => onRemovePageNote(n.id)}>삭제</button>
                </div>
              </div>
            {/each}
            <h4>북마크</h4>
            {#if (reading.bookmarks ?? []).length === 0}
              <p class="empty">북마크가 없습니다. 상단의 북마크 버튼으로 현재 위치를 표시하세요.</p>
            {/if}
            {#each reading.bookmarks ?? [] as b (b.id)}
              <div class="hl">
                <button class="quote" onclick={() => jumpTo(b.position)}><i class="fa-solid fa-bookmark"></i> {b.label}</button>
              </div>
            {/each}
          </div>
        {:else if panelTab === 'note'}
          <div class="note">
            <textarea
              class="note-area"
              value={noteText ?? ''}
              disabled={noteText === null}
              placeholder="이 책을 읽으며 남길 생각을 적으세요. 마크다운을 쓸 수 있습니다."
              oninput={(e) => onNoteInput((e.currentTarget as HTMLTextAreaElement).value)}
            ></textarea>
            <p class="hint">
              {noteError || (noteText === null ? '불러오는 중…' : '입력이 멈추면 자동으로 저장됩니다. 내용을 모두 지우는 변경은 저장되지 않습니다.')}
            </p>
          </div>
        {:else}
          {#if reading.highlights.length === 0}
            <p class="empty">아직 하이라이트가 없습니다. 글을 드래그해서 고른 뒤 "하이라이트"를 누르세요.</p>
          {/if}
          {#each reading.highlights as h (h.id)}
            <div class="hl">
              <button class="quote" onclick={() => jump(h)}>“{h.text}”</button>
              <span class="loc">{h.label}</span>
              <textarea
                rows="2"
                placeholder="메모"
                value={h.memo}
                onchange={(e) => onMemo(h.id, (e.currentTarget as HTMLTextAreaElement).value)}
              ></textarea>
              <div class="hl-actions">
                <button class="btn" onclick={() => appendToNote(h)}>노트에 추가</button>
                <button class="btn danger" onclick={() => removeHighlight(h)}>삭제</button>
              </div>
            </div>
          {/each}
        {/if}
      </aside>
    {/if}
  </div>
</div>

<style>
  .reader {
    display: flex;
    flex-direction: column;
    height: 100%;
    min-height: 0;
    background: var(--bg);
  }
  .reader {
    position: relative;
  }
  .toolbar {
    flex-wrap: wrap;
    row-gap: 0.2rem;
    display: flex;
    align-items: center;
    gap: 0.4rem;
    padding: 0.4rem 0.6rem;
    border-bottom: 1px solid var(--border);
    background: var(--bg-alt);
    font-size: 0.88rem;
  }
  .toolbar.overlay {
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    z-index: 4;
    box-shadow: 0 4px 14px rgba(0, 0, 0, 0.15);
  }
  .toolbar.is-hidden {
    display: none;
  }
  .break {
    flex-basis: 100%;
    height: 0;
  }
  .float-btn {
    position: absolute;
    bottom: 0.6rem;
    right: 0.6rem;
    z-index: 5;
    background: var(--bg-alt);
    border: 1px solid var(--border);
    border-radius: 6px;
    color: var(--text-muted);
    padding: 0.3rem 0.5rem;
    opacity: 0.75;
  }
  .float-btn:hover {
    opacity: 1;
  }
  .title {
    font-weight: 600;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    max-width: 40%;
  }
  .spacer {
    flex: 1;
  }
  .page {
    color: var(--text-muted);
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
  .btn:hover:not(:disabled) {
    background: var(--bg-elev);
  }
  .btn.on {
    color: var(--accent);
    background: var(--accent-soft);
  }
  .btn:disabled {
    opacity: 0.4;
  }
  .btn.danger {
    color: #c0392b;
  }
  .body {
    position: relative;
    flex: 1;
    min-height: 0;
    display: flex;
  }
  .status {
    position: absolute;
    top: 0.8rem;
    left: 1rem;
    color: var(--text-muted);
    z-index: 2;
  }
  .status.err {
    color: #c0392b;
  }
  /* PDF처럼 바깥 배경 위에 흰 쪽이 놓인 모양. 쪽 가장자리에 여백을 둔다. */
  .epub-frame {
    flex: 1;
    min-width: 0;
    height: 100%;
    box-sizing: border-box;
    padding: 1rem clamp(0.75rem, 4vw, 3rem);
    background: var(--bg-elev);
  }
  .epub-stage {
    height: 100%;
    width: 100%;
    background: #fff;
    border-radius: 2px;
    box-shadow: 0 2px 10px rgba(0, 0, 0, 0.15);
    overflow: hidden;
  }
  .pdf-stage {
    flex: 1;
    min-width: 0;
    overflow: auto;
    display: flex;
    justify-content: center;
    padding: 1rem;
    background: var(--bg-elev);
    /* 세로 스크롤만 브라우저가 처리하고, 가로 드래그는 쪽 넘김에 넘긴다 (브라우저가 가로 드래그를 가져가면 쪽이 안 넘어간다) */
    touch-action: pan-y;
  }
  .pdf-row {
    display: flex;
    gap: 0;
    align-items: flex-start;
    margin: auto;
  }
  :global(.pdf-page) {
    position: relative;
    height: fit-content;
    box-shadow: 0 2px 10px rgba(0, 0, 0, 0.15);
    background: #fff;
  }
  :global(.pdf-page .textLayer) {
    position: absolute;
    left: 0;
    top: 0;
  }
  .toc {
    position: absolute;
    top: 0;
    left: 0;
    bottom: 0;
    width: min(300px, 80%);
    overflow-y: auto;
    margin: 0;
    padding: 0.5rem;
    list-style: none;
    background: var(--bg-alt);
    border-right: 1px solid var(--border);
    z-index: 3;
  }
  .toc button {
    display: block;
    width: 100%;
    text-align: left;
    background: none;
    border: none;
    color: var(--text);
    padding: 0.4rem 0.5rem;
    border-radius: 6px;
  }
  .toc button:hover {
    background: var(--accent-soft);
  }
  .panel {
    width: min(300px, 85vw);
    border-left: 1px solid var(--border);
    background: var(--bg-alt);
    overflow-y: auto;
    padding: 0.5rem;
  }
  .panel header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    font-weight: 700;
    margin-bottom: 0.4rem;
  }
  .hl {
    border-bottom: 1px solid var(--border);
    padding: 0.5rem 0;
    font-size: 0.85rem;
  }
  .quote {
    display: block;
    width: 100%;
    text-align: left;
    background: none;
    border: none;
    color: var(--text);
    font-style: italic;
    padding: 0;
  }
  .loc {
    color: var(--text-muted);
    font-size: 0.78rem;
  }
  .hl textarea {
    width: 100%;
    margin-top: 0.3rem;
    font: inherit;
    color: var(--text);
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: 6px;
    padding: 0.3rem;
    resize: vertical;
  }
  .empty {
    color: var(--text-muted);
    font-size: 0.85rem;
  }
  .tabs2 {
    display: flex;
    gap: 0.2rem;
    font-size: 0.85rem;
  }
  .tabs2 button {
    background: none;
    border: none;
    color: var(--text-muted);
    padding: 0.25rem 0.4rem;
    border-radius: 6px;
  }
  .tabs2 button.on {
    color: var(--accent);
    background: var(--accent-soft);
    font-weight: 600;
  }
  .note {
    display: flex;
    flex-direction: column;
    gap: 0.3rem;
    height: calc(100% - 2.5rem);
  }
  .note-area {
    flex: 1;
    min-height: 200px;
    font: inherit;
    font-size: 0.9rem;
    line-height: 1.6;
    color: var(--text);
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: 6px;
    padding: 0.5rem;
    resize: vertical;
  }
  .hint {
    margin: 0;
    color: var(--text-muted);
    font-size: 0.78rem;
  }
  .hl-actions {
    display: flex;
    gap: 0.3rem;
    margin-top: 0.3rem;
  }
  .memo-tab {
    display: flex;
    flex-direction: column;
    gap: 0.3rem;
    font-size: 0.85rem;
  }
  .memo-tab h4 {
    margin: 0.6rem 0 0.2rem;
    font-size: 0.9rem;
  }
  .add-memo {
    display: flex;
    flex-direction: column;
    gap: 0.3rem;
    padding-bottom: 0.5rem;
    border-bottom: 1px solid var(--border);
  }
  .add-memo textarea {
    font: inherit;
    color: var(--text);
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: 6px;
    padding: 0.3rem;
    resize: vertical;
  }
  .btn.primary {
    background: var(--accent);
    color: #fff;
    align-self: flex-end;
  }
  .btn.primary:disabled {
    opacity: 0.5;
  }
</style>
