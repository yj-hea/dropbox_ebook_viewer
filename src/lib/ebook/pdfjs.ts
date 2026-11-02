/**
 * pdf.js 를 불러와 워커를 연결한다. 워커는 한 번만 만든다.
 */
import './pdfPolyfills';
import type * as PdfJs from 'pdfjs-dist';

let loading: Promise<typeof PdfJs> | null = null;

export function loadPdfJs(): Promise<typeof PdfJs> {
  loading ??= (async () => {
    const pdfjs = await import('pdfjs-dist');
    pdfjs.GlobalWorkerOptions.workerPort = new Worker(new URL('./pdfWorker.ts', import.meta.url), {
      type: 'module',
    });
    return pdfjs;
  })();
  return loading;
}
