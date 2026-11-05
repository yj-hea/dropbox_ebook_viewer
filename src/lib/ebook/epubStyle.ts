/**
 * EPUB 읽기 설정: 글자 크기, 줄간격, 문단 간격, 쪽 상하·좌우 여백.
 * 기기에 기억한다. 값은 모두 CSS에 그대로 들어가는 단위로 둔다.
 */
export interface EpubStyle {
  /** 글자 크기 (%) */
  font: number;
  /** 줄간격 (배) */
  lineHeight: number;
  /** 문단 사이 간격 (em) */
  paraGap: number;
  /** 쪽 위·아래 여백 (px) */
  padY: number;
  /** 쪽 좌·우 여백 (px) */
  padX: number;
}

export const DEFAULT_EPUB_STYLE: EpubStyle = {
  font: 100,
  lineHeight: 1.6,
  paraGap: 0.6,
  padY: 36,
  padX: 56,
};

const KEY = 'ebook.epubStyle';

function num(v: unknown, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : fallback;
}

export function readEpubStyle(): EpubStyle {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Partial<EpubStyle> | null;
    if (!raw) return { ...DEFAULT_EPUB_STYLE };
    return {
      font: num(raw.font, DEFAULT_EPUB_STYLE.font) || DEFAULT_EPUB_STYLE.font,
      lineHeight: num(raw.lineHeight, DEFAULT_EPUB_STYLE.lineHeight) || DEFAULT_EPUB_STYLE.lineHeight,
      paraGap: num(raw.paraGap, DEFAULT_EPUB_STYLE.paraGap),
      padY: num(raw.padY, DEFAULT_EPUB_STYLE.padY),
      padX: num(raw.padX, DEFAULT_EPUB_STYLE.padX),
    };
  } catch {
    return { ...DEFAULT_EPUB_STYLE };
  }
}

export function saveEpubStyle(style: EpubStyle): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(style));
  } catch {
    /* ignore */
  }
}

/** 본문 글에 적용할 CSS 규칙 (글자 크기는 별도로 적용한다). */
export function bodyRules(style: EpubStyle) {
  return {
    body: { 'line-height': `${style.lineHeight} !important` },
    p: { 'margin-top': '0 !important', 'margin-bottom': `${style.paraGap}em !important` },
  };
}
