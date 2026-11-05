/**
 * 책 표지 이미지를 만든다. EPUB 은 내장 표지, PDF 는 첫 쪽을 그린다.
 */
import type { BookKind } from './state';
import { documentParams, loadPdfJs } from './pdfjs';

const COVER_WIDTH = 320;

export async function makeCover(bytes: ArrayBuffer, kind: BookKind): Promise<Blob | null> {
  return kind === 'pdf' ? pdfCover(bytes) : epubCover(bytes);
}

async function pdfCover(bytes: ArrayBuffer): Promise<Blob | null> {
  const pdfjs = await loadPdfJs();
  const task = pdfjs.getDocument(documentParams(pdfjs, new Uint8Array(bytes)));
  const doc = await task.promise;
  try {
    const page = await doc.getPage(1);
    const base = page.getViewport({ scale: 1 });
    const viewport = page.getViewport({ scale: COVER_WIDTH / base.width });
    const canvas = document.createElement('canvas');
    canvas.width = Math.floor(viewport.width);
    canvas.height = Math.floor(viewport.height);
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    await page.render({ canvas, canvasContext: ctx, viewport }).promise;
    return await new Promise<Blob | null>((resolve) => canvas.toBlob((b) => resolve(b), 'image/jpeg', 0.85));
  } finally {
    await task.destroy();
  }
}

async function epubCover(bytes: ArrayBuffer): Promise<Blob | null> {
  const { default: ePub } = await import('epubjs');
  const book = ePub(bytes);
  try {
    const url = await book.coverUrl();
    if (!url) return null;
    const blob = await fetch(url).then((r) => r.blob());
    URL.revokeObjectURL(url);
    return blob;
  } finally {
    book.destroy();
  }
}
