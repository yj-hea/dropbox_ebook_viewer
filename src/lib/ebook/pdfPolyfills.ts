/**
 * pdf.js 6 는 아직 모든 브라우저에 없는 최신 내장 함수를 쓴다.
 * 빠진 것만 채운다. pdf.js 를 불러오기 전(메인 화면, 워커 양쪽)에 한 번 불러온다.
 */
type AnyProto = Record<string, unknown>;

function define(target: AnyProto, name: string, value: unknown) {
  if (typeof target[name] === 'function') return;
  Object.defineProperty(target, name, { configurable: true, writable: true, value });
}

const mapLike = (proto: AnyProto) => {
  define(proto, 'getOrInsertComputed', function (this: Map<unknown, unknown>, key: unknown, make: (k: unknown) => unknown) {
    if (this.has(key)) return this.get(key);
    const value = make(key);
    this.set(key, value);
    return value;
  });
  define(proto, 'getOrInsert', function (this: Map<unknown, unknown>, key: unknown, value: unknown) {
    if (this.has(key)) return this.get(key);
    this.set(key, value);
    return value;
  });
};
mapLike(Map.prototype as unknown as AnyProto);
mapLike(WeakMap.prototype as unknown as AnyProto);

define(Set.prototype as unknown as AnyProto, 'intersection', function (this: Set<unknown>, other: Set<unknown>) {
  return new Set([...this].filter((v) => other.has(v)));
});

const bytesToBinary = (bytes: Uint8Array) => Array.from(bytes, (b) => String.fromCharCode(b)).join('');
const binaryToBytes = (text: string) => Uint8Array.from(text, (c) => c.charCodeAt(0));

define(Uint8Array.prototype as unknown as AnyProto, 'toHex', function (this: Uint8Array) {
  return Array.from(this, (b) => b.toString(16).padStart(2, '0')).join('');
});
define(Uint8Array.prototype as unknown as AnyProto, 'toBase64', function (this: Uint8Array) {
  return btoa(bytesToBinary(this));
});
define(Uint8Array as unknown as AnyProto, 'fromBase64', (text: string) => binaryToBytes(atob(text)));
define(Uint8Array as unknown as AnyProto, 'fromHex', (text: string) => {
  const out = new Uint8Array(text.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(text.slice(i * 2, i * 2 + 2), 16);
  return out;
});
