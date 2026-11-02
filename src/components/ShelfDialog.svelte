<script lang="ts">
  /**
   * 서가 만들기와 책 옮기기에 쓰는 작은 대화상자.
   * - create: 이름과 어느 서가 아래에 만들지 고른다
   * - move: 책을 옮길 서가를 고른다
   */
  interface Props {
    mode: 'create' | 'move';
    /** 고를 수 있는 서가 (상대 경로). 최상위는 빈 문자열로 따로 붙인다. */
    shelves: string[];
    /** 옮기는 책 이름 (move 모드) */
    bookName?: string;
    /** 현재 서가 (move 모드에서 기본 선택) */
    current?: string;
    onSubmit: (input: { name: string; folder: string }) => Promise<void>;
    onClose: () => void;
  }
  import { untrack } from 'svelte';

  let { mode, shelves, bookName = '', current = '', onSubmit, onClose }: Props = $props();

  let name = $state('');
  // 대화상자는 열 때마다 새로 만들어지므로 처음 값만 쓴다
  let folder = $state(untrack(() => (mode === 'move' ? current : '')));
  let busy = $state(false);
  let error = $state('');

  const title = $derived(mode === 'create' ? '서가 만들기' : '서가로 옮기기');
  const valid = $derived(mode === 'move' || (name.trim().length > 0 && !/[\\/]/.test(name) && !name.trim().startsWith('.')));

  async function submit(e: SubmitEvent) {
    e.preventDefault();
    if (!valid || busy) return;
    busy = true;
    error = '';
    try {
      await onSubmit({ name: name.trim(), folder });
      onClose();
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    } finally {
      busy = false;
    }
  }

  function label(path: string): string {
    return path || '최상위 폴더';
  }
</script>

<svelte:window onkeydown={(e) => e.key === 'Escape' && onClose()} />

<div class="scrim" role="presentation" onclick={onClose}></div>
<div class="dialog" role="dialog" aria-modal="true" aria-label={title}>
  <form onsubmit={submit}>
    <h3>{title}</h3>

    {#if mode === 'move'}
      <p class="what"><i class="fa-solid fa-book"></i> {bookName}</p>
    {:else}
      <label>
        이름
        <input bind:value={name} placeholder="예: 소설" />
      </label>
      {#if name && !valid}
        <p class="err">이름에 / 를 쓸 수 없고 . 으로 시작할 수 없습니다.</p>
      {/if}
    {/if}

    <label>
      {mode === 'create' ? '어느 서가 아래에 만들까요' : '어느 서가로 옮길까요'}
      <select bind:value={folder}>
        <option value="">{label('')}</option>
        {#each shelves as s (s)}
          <option value={s}>{s}</option>
        {/each}
      </select>
    </label>

    {#if error}
      <p class="err">{error}</p>
    {/if}

    <div class="actions">
      <button type="button" class="btn" onclick={onClose} disabled={busy}>취소</button>
      <button type="submit" class="btn primary" disabled={!valid || busy}>
        {busy ? '처리 중…' : mode === 'create' ? '만들기' : '옮기기'}
      </button>
    </div>
  </form>
</div>

<style>
  .scrim {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.35);
    z-index: 50;
  }
  .dialog {
    position: fixed;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    width: min(360px, 90vw);
    background: var(--bg);
    color: var(--text);
    border: 1px solid var(--border);
    border-radius: 10px;
    box-shadow: 0 10px 30px rgba(0, 0, 0, 0.25);
    z-index: 51;
  }
  form {
    padding: 1rem 1.1rem;
    display: flex;
    flex-direction: column;
    gap: 0.7rem;
  }
  h3 {
    margin: 0;
    font-size: 1.05rem;
  }
  .what {
    margin: 0;
    color: var(--text-muted);
    font-size: 0.9rem;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  label {
    display: flex;
    flex-direction: column;
    gap: 0.3rem;
    font-size: 0.88rem;
    color: var(--text-muted);
  }
  input,
  select {
    font: inherit;
    color: var(--text);
    background: var(--bg-alt);
    border: 1px solid var(--border);
    border-radius: 6px;
    padding: 0.4rem 0.5rem;
  }
  .err {
    margin: 0;
    color: #c0392b;
    font-size: 0.85rem;
  }
  .actions {
    display: flex;
    justify-content: flex-end;
    gap: 0.5rem;
    margin-top: 0.2rem;
  }
  .btn {
    background: none;
    border: 1px solid var(--border);
    border-radius: 6px;
    color: var(--text);
    padding: 0.35rem 0.8rem;
  }
  .btn.primary {
    background: var(--accent);
    border-color: var(--accent);
    color: #fff;
  }
  .btn:disabled {
    opacity: 0.5;
  }
</style>
