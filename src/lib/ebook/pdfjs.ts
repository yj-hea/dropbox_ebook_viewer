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

/**
 * 문서를 여는 옵션. 한글 등 PDF에 글꼴이 내장되지 않은 글자를 그리려면 글자 대응표(cMap)와
 * 기본 글꼴이 필요하다. 없으면 그 글자가 빠진 채로 그려진다.
 */
export function documentParams(pdfjs: typeof PdfJs, data: Uint8Array) {
  const base = `https://cdn.jsdelivr.net/npm/pdfjs-dist@${pdfjs.version}`;
  return {
    data,
    cMapUrl: `${base}/cmaps/`,
    cMapPacked: true,
    standardFontDataUrl: `${base}/standard_fonts/`,
  };
}
