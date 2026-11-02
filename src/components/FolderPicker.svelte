<script lang="ts">
  import { listFolder, type Entry } from '../lib/dropbox/api';
  import { logout } from '../lib/dropbox/auth';
  import { vaultRoot } from '../stores/vault';

  // 현재 탐색 중인 경로 ('' = Dropbox 루트)
  let current = $state('');
  let folders = $state<Entry[]>([]);
  let loading = $state(false);
  let error = $state('');

  async function load(path: string) {
    loading = true;
    error = '';
    try {
      const entries = await listFolder(path);
      folders = entries
        .filter((e) => e.type === 'folder')
        .sort((a, b) => a.name.localeCompare(b.name));
      current = path;
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    } finally {
      loading = false;
    }
  }

  function up() {
    const parent = current.replace(/\/[^/]+$/, '');
    load(parent);
  }

  function select() {
    vaultRoot.set(current || '/');
  }

  async function signOut() {
    await logout();
    location.reload();
  }

  $effect(() => {
    void load('');
  });
</script>

<div class="picker">
  <div class="card">
    <h2>볼트 폴더 선택</h2>
    <p class="sub">Obsidian 볼트로 사용할 Dropbox 폴더를 고르세요.</p>

    <div class="crumb">
      <button onclick={up} disabled={!current} title="상위 폴더" aria-label="상위 폴더"><i class="fa-solid fa-arrow-up"></i></button>
      <span class="path">{current || '/ (Dropbox 루트)'}</span>
    </div>

    <div class="list">
      {#if loading}
        <p class="muted">불러오는 중…</p>
      {:else if error}
        <p class="err">{error}</p>
      {:else if folders.length === 0}
        <p class="muted">하위 폴더 없음</p>
      {:else}
        {#each folders as f (f.path)}
          <button class="row" onclick={() => load(f.path)}><i class="fa-solid fa-folder"></i> {f.name}</button>
        {/each}
      {/if}
    </div>

    <div class="actions">
      <button class="primary" onclick={select} disabled={!current}>
        이 폴더를 볼트로 사용
      </button>
    </div>
    {#if !current}
      <p class="muted small">Dropbox 루트 전체를 볼트로 쓰려면 그대로 선택하세요.</p>
    {/if}

    <button class="signout" onclick={signOut}>다른 계정으로 로그인</button>
  </div>
</div>

<style>
  .picker {
    height: 100%;
    display: grid;
    place-items: center;
    padding: 1.5rem;
  }
  .card {
    background: var(--bg-alt);
    border: 1px solid var(--border);
    border-radius: 16px;
    padding: 1.8rem;
    width: 100%;
    max-width: 440px;
  }
  h2 {
    margin: 0 0 0.3rem;
  }
  .sub {
    color: var(--text-muted);
    margin: 0 0 1.2rem;
    font-size: 0.9rem;
  }
  .crumb {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    margin-bottom: 0.6rem;
  }
  .crumb button {
    background: var(--bg-elev);
    border: 1px solid var(--border);
    border-radius: 6px;
    color: var(--text);
    padding: 0.2rem 0.5rem;
  }
  .path {
    font-size: 0.85rem;
    color: var(--text-muted);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .list {
    border: 1px solid var(--border);
    border-radius: 8px;
    min-height: 160px;
    max-height: 320px;
    overflow-y: auto;
    padding: 0.3rem;
  }
  .row {
    display: block;
    width: 100%;
    text-align: left;
    background: none;
    border: none;
    color: var(--text);
    padding: 0.55rem 0.6rem;
    border-radius: 6px;
    font-size: 0.95rem;
  }
  .row:hover {
    background: var(--accent-soft);
  }
  .actions {
    margin-top: 1rem;
  }
  .primary {
    background: var(--accent);
    color: #fff;
    border: none;
    border-radius: 10px;
    padding: 0.7rem 1.2rem;
    width: 100%;
    font-weight: 600;
  }
  .primary:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
  .muted {
    color: var(--text-muted);
    text-align: center;
    padding: 1rem;
    margin: 0;
  }
  .small {
    font-size: 0.8rem;
    padding: 0.5rem 0 0;
  }
  .err {
    color: var(--danger);
    padding: 1rem;
  }
  .signout {
    display: block;
    margin: 1rem auto 0;
    background: none;
    border: none;
    color: var(--text-muted);
    font-size: 0.82rem;
  }
  .signout:hover {
    color: var(--text);
  }
</style>
