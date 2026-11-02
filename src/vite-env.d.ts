/// <reference types="svelte" />
/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly DROPBOX_APP_KEY?: string;
}
interface ImportMeta {
  readonly env: ImportMetaEnv;
}
