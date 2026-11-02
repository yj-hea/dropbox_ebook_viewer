<script lang="ts">
  import { completeLoginIfPending, isConnected, logout } from './lib/dropbox/auth';
  import { vaultRoot } from './stores/vault';
  import Login from './components/Login.svelte';
  import FolderPicker from './components/FolderPicker.svelte';
  import Books from './components/Books.svelte';

  type Phase = 'loading' | 'login' | 'pick' | 'ready';
  let phase = $state<Phase>('loading');
  let fatal = $state('');

  $effect(() => {
    void init();
  });

  async function init() {
    const result = await completeLoginIfPending();
    if (result === 'error') fatal = 'Dropbox 로그인에 실패했습니다. 다시 시도하세요.';
    if (!isConnected()) {
      phase = 'login';
      return;
    }
    phase = $vaultRoot ? 'ready' : 'pick';
  }

  // 폴더가 정해지면 바로 책 목록을 보여 준다
  $effect(() => {
    if (phase === 'pick' && $vaultRoot) phase = 'ready';
  });

  // 볼트(폴더)를 바꾸고 다시 고른다
  function changeFolder() {
    vaultRoot.set('');
    phase = 'pick';
  }

  async function doLogout() {
    if (!confirm('로그아웃할까요?')) return;
    await logout();
    vaultRoot.set('');
    phase = 'login';
  }
</script>

{#if phase === 'loading'}
  <div class="center">불러오는 중…</div>
{:else if phase === 'login'}
  <Login />
{:else if phase === 'pick'}
  <FolderPicker />
{:else}
  <div class="app">
    <header class="topbar">
      <span class="title"><i class="fa-solid fa-book-open"></i> 전자책</span>
      <span class="path" title={$vaultRoot}>{$vaultRoot || '/'}</span>
      <div class="spacer"></div>
      <button class="btn" onclick={changeFolder} title="폴더 변경">
        <i class="fa-solid fa-folder-open"></i> 폴더 변경
      </button>
      <button class="btn" onclick={doLogout} title="로그아웃">
        <i class="fa-solid fa-right-from-bracket"></i>
      </button>
    </header>
    <main>
      <Books root={$vaultRoot} />
    </main>
  </div>
{/if}

{#if fatal}
  <p class="fatal">{fatal}</p>
{/if}

<style>
  .app {
    display: flex;
    flex-direction: column;
    height: 100%;
  }
  .topbar {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    padding: 0.5rem 0.8rem;
    border-bottom: 1px solid var(--border);
    background: var(--bg-alt);
    font-size: 0.9rem;
  }
  .title {
    font-weight: 700;
  }
  .path {
    color: var(--text-muted);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    min-width: 0;
  }
  .spacer {
    flex: 1;
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
  main {
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
  }
  .center {
    display: grid;
    place-items: center;
    height: 100%;
    color: var(--text-muted);
  }
  .fatal {
    position: fixed;
    bottom: 1rem;
    left: 1rem;
    color: #c0392b;
  }
</style>
