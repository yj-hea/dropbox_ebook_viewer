<script lang="ts">
  import { startLogin } from '../lib/dropbox/auth';
  import { isDropboxEnabled } from '../lib/dropbox/config';

  let error = $state('');
  const enabled = isDropboxEnabled();

  async function connect() {
    try {
      await startLogin();
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    }
  }
</script>

<div class="login">
  <div class="card">
    <h1>전자책 뷰어</h1>
    <p class="sub">Dropbox 폴더의 EPUB·PDF를 브라우저에서 읽습니다.</p>

    {#if !enabled}
      <p class="warn">
        Dropbox App key 가 설정되지 않았습니다. <code>DROPBOX_APP_KEY</code>
        환경변수를 설정하세요.
      </p>
    {:else}
      <button class="primary" onclick={connect}>Dropbox 로 로그인</button>
      <p class="hint">로그인하면 본인 Dropbox 계정의 파일에만 접근합니다.</p>
    {/if}

    {#if error}
      <p class="warn">{error}</p>
    {/if}
  </div>
</div>

<style>
  .login {
    height: 100%;
    display: grid;
    place-items: center;
    padding: 1.5rem;
  }
  .card {
    background: var(--bg-alt);
    border: 1px solid var(--border);
    border-radius: 16px;
    padding: 2.5rem;
    max-width: 380px;
    width: 100%;
    text-align: center;
  }
  h1 {
    margin: 0 0 0.5rem;
    font-size: 1.6rem;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0.5rem;
  }
  .sub {
    color: var(--text-muted);
    margin: 0 0 1.8rem;
  }
  .primary {
    background: var(--accent);
    color: #fff;
    border: none;
    border-radius: 10px;
    padding: 0.8rem 1.4rem;
    font-size: 1rem;
    font-weight: 600;
    width: 100%;
  }
  .primary:hover {
    filter: brightness(1.1);
  }
  .hint {
    color: var(--text-muted);
    font-size: 0.85rem;
    margin: 1rem 0 0;
  }
  .warn {
    color: var(--danger);
    font-size: 0.9rem;
    margin-top: 1rem;
  }
  code {
    background: var(--bg-elev);
    padding: 0.1em 0.35em;
    border-radius: 4px;
  }
</style>
