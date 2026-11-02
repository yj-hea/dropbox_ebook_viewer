import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import basicSsl from '@vitejs/plugin-basic-ssl';
import { resolve } from 'node:path';

export default defineConfig({
  plugins: [svelte(), basicSsl()],
  // 브라우저에 넣을 환경 변수 접두사. 앱 키는 OAuth 로그인에 필요해서 어차피 브라우저에 노출된다.
  envPrefix: 'DROPBOX_',
  server: { host: true, port: 5000, strictPort: true },
  resolve: {
    alias: {
      $lib: resolve(__dirname, 'src/lib'),
      $components: resolve(__dirname, 'src/components'),
      $stores: resolve(__dirname, 'src/stores'),
    },
  },
});
