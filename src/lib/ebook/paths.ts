/**
 * 책마다 기록·노트·표지 파일 이름을 정한다.
 *
 * 예전에는 책 경로를 URL 인코딩한 이름을 썼다. 한글은 한 글자가 9자로 늘어나서
 * 이름이 Dropbox의 255자 제한을 넘으면 저장이 실패하고, 기록이 매번 없는 것처럼 보였다.
 * 그래서 이름은 짧은 읽을 수 있는 부분 + 경로 해시로 만든다. 원래 경로는 기록 파일 안에 남는다.
 */

/** 해시 값 (FNV-1a 32비트 두 개를 이어 붙여 16자리) */
function hash(text: string): string {
  const fnv = (seed: number) => {
    let h = seed >>> 0;
    for (const ch of text) {
      h ^= ch.codePointAt(0) ?? 0;
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    return h.toString(16).padStart(8, '0');
  };
  return fnv(0x811c9dc5) + fnv(0x2b5e8d1f);
}

/** 책 경로에서 파일 이름 앞부분으로 쓸 글자 (최대 60글자) */
function readablePart(rel: string): string {
  return Array.from(rel.replace(/\//g, '__')).slice(0, 60).join('');
}

/** 새 방식의 이름 (확장자 없음). 예: `소설__책 제목~3f2a…` */
export function recordName(rel: string): string {
  return `${readablePart(rel)}~${hash(rel)}`;
}

/** 예전 방식의 이름 (확장자 없음). 읽기 전용으로만 확인한다. */
export function legacyRecordName(rel: string): string {
  return encodeURIComponent(rel);
}
