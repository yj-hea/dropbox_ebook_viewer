<script lang="ts">
  import { DEFAULT_EPUB_STYLE, type EpubStyle } from '../lib/ebook/epubStyle';

  interface Props {
    style: EpubStyle;
    onChange: (next: EpubStyle) => void;
    onClose: () => void;
  }
  let { style, onChange, onClose }: Props = $props();

  // 입력한 값은 바로 적용한다. 0 이하나 빈 값은 무시한다.
  function set(key: keyof EpubStyle, raw: string) {
    const v = Number(raw);
    if (!Number.isFinite(v) || v < 0) return;
    if ((key === 'font' || key === 'lineHeight') && v === 0) return;
    onChange({ ...style, [key]: v });
  }

  const rows: { key: keyof EpubStyle; label: string; unit: string; step: number }[] = [
    { key: 'font', label: '글자 크기', unit: '%', step: 10 },
    { key: 'lineHeight', label: '줄간격', unit: '배', step: 0.1 },
    { key: 'paraGap', label: '문단 간격', unit: 'em', step: 0.1 },
    { key: 'padY', label: '위·아래 여백', unit: 'px', step: 4 },
    { key: 'padX', label: '좌·우 여백', unit: 'px', step: 4 },
  ];
</script>

<svelte:window onkeydown={(e) => e.key === 'Escape' && onClose()} />

<div class="scrim" role="presentation" onclick={onClose}></div>
<div class="panel" role="dialog" aria-modal="true" aria-label="읽기 설정">
  <header>
    <span>읽기 설정</span>
    <button class="btn" onclick={onClose} aria-label="닫기"><i class="fa-solid fa-xmark"></i></button>
  </header>

  {#each rows as r (r.key)}
    <label class="row">
      <span class="label">{r.label}</span>
      <span class="input">
        <input
          type="number"
          value={style[r.key]}
          step={r.step}
          min="0"
          oninput={(e) => set(r.key, (e.currentTarget as HTMLInputElement).value)}
        />
        <span class="unit">{r.unit}</span>
      </span>
    </label>
  {/each}

  <div class="actions">
    <button class="btn" onclick={() => onChange({ ...DEFAULT_EPUB_STYLE })}>기본값으로</button>
  </div>
</div>

<style>
  .scrim {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.3);
    z-index: 50;
  }
  .panel {
    position: fixed;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    width: min(360px, 92vw);
    background: var(--bg);
    color: var(--text);
    border: 1px solid var(--border);
    border-radius: 10px;
    box-shadow: 0 10px 30px rgba(0, 0, 0, 0.25);
    padding: 0.8rem 1rem 1rem;
    z-index: 51;
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
  }
  header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    font-weight: 700;
  }
  .btn {
    background: none;
    border: 1px solid transparent;
    border-radius: 6px;
    color: var(--text-muted);
    padding: 0.25rem 0.5rem;
  }
  .btn:hover {
    color: var(--text);
    background: var(--bg-elev);
  }
  .row {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 0.6rem;
    font-size: 0.9rem;
  }
  .input {
    display: flex;
    align-items: center;
    gap: 0.3rem;
  }
  input {
    width: 80px;
    font: inherit;
    color: var(--text);
    background: var(--bg-alt);
    border: 1px solid var(--border);
    border-radius: 6px;
    padding: 0.3rem 0.4rem;
    text-align: right;
  }
  .unit {
    color: var(--text-muted);
    font-size: 0.82rem;
    width: 1.6rem;
  }
  .actions {
    display: flex;
    justify-content: flex-end;
    margin-top: 0.3rem;
  }
  .actions .btn {
    border-color: var(--border);
    color: var(--text);
  }
</style>
