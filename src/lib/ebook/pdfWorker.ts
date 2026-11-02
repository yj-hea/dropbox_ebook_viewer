/** pdf.js 워커 진입점. 지문 폴리필을 pdf.js 보다 먼저 불러온다. */
import './pdfPolyfills';
import 'pdfjs-dist/build/pdf.worker.mjs';
