// @ts-check
import { defineConfig } from 'astro/config';

// 순수 정적 빌드 → dist/ 를 Cloudflare Workers 의 Assets 바인딩이 그대로 서빙한다.
export default defineConfig({
  site: 'https://audio.vialinks.xyz',
  output: 'static',
  build: {
    // /spatial/ 형태의 디렉터리 URL. wrangler 의 html_handling: auto-trailing-slash 와 짝을 이룬다.
    format: 'directory',
  },
  vite: {
    build: {
      // three.js 청크가 500KB 경고를 넘기므로 상향.
      chunkSizeWarningLimit: 1200,
    },
  },
});
