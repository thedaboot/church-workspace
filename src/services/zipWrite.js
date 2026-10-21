// ============================================================================
// zip 쓰기 — 압축 없이(stored) 항목을 묶는다 (v5 3묶음 · 보고서 양식 채우기 · 연말 보고 내보내기)
// ----------------------------------------------------------------------------
// xlsx는 zip 안에 XML 몇 장이다(services/ooxml.js 머리말). 읽기는 ooxml.zipEntries, 쓰기는 여기 한 벌.
// 압축하지 않는 까닭: 안에 드는 큰 것은 이미 압축된 사진(jpeg·png)이고, XML은 몇 KB다 — 엑셀·구글 시트·
// 넘버스 모두 stored 항목을 그대로 연다. 의존성을 늘리지 않는다. DOM을 쓰지 않는 순수 함수다(노드에서 검사 · §3-5).
//   zipStore([{ name, data: Uint8Array | string }]) → Uint8Array
// ============================================================================

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

// 1980-01-01 00:00 — 날짜 칸은 의미가 없어 고정한다(같은 입력이면 같은 바이트)
const DOS_TIME = 0;
const DOS_DATE = (1 << 5) | 1;

export function zipStore(items) {
  const enc = new TextEncoder();
  const files = items.map(it => {
    const name = enc.encode(it.name);
    const data = typeof it.data === 'string' ? enc.encode(it.data) : it.data;
    return { name, data, crc: crc32(data) };
  });
  const localSize = files.reduce((n, f) => n + 30 + f.name.length + f.data.length, 0);
  const centralSize = files.reduce((n, f) => n + 46 + f.name.length, 0);
  const out = new Uint8Array(localSize + centralSize + 22);
  const dv = new DataView(out.buffer);
  let p = 0;
  const offsets = [];
  for (const f of files) {
    offsets.push(p);
    dv.setUint32(p, 0x04034b50, true);
    dv.setUint16(p + 4, 20, true);
    dv.setUint16(p + 6, 0x0800, true);   // 이름은 UTF-8
    dv.setUint16(p + 8, 0, true);        // stored
    dv.setUint16(p + 10, DOS_TIME, true);
    dv.setUint16(p + 12, DOS_DATE, true);
    dv.setUint32(p + 14, f.crc, true);
    dv.setUint32(p + 18, f.data.length, true);
    dv.setUint32(p + 22, f.data.length, true);
    dv.setUint16(p + 26, f.name.length, true);
    dv.setUint16(p + 28, 0, true);
    out.set(f.name, p + 30);
    out.set(f.data, p + 30 + f.name.length);
    p += 30 + f.name.length + f.data.length;
  }
  const cdStart = p;
  files.forEach((f, i) => {
    dv.setUint32(p, 0x02014b50, true);
    dv.setUint16(p + 4, 20, true);
    dv.setUint16(p + 6, 20, true);
    dv.setUint16(p + 8, 0x0800, true);
    dv.setUint16(p + 10, 0, true);
    dv.setUint16(p + 12, DOS_TIME, true);
    dv.setUint16(p + 14, DOS_DATE, true);
    dv.setUint32(p + 16, f.crc, true);
    dv.setUint32(p + 20, f.data.length, true);
    dv.setUint32(p + 24, f.data.length, true);
    dv.setUint16(p + 28, f.name.length, true);
    dv.setUint16(p + 30, 0, true);
    dv.setUint16(p + 32, 0, true);
    dv.setUint16(p + 34, 0, true);
    dv.setUint16(p + 36, 0, true);
    dv.setUint32(p + 38, 0, true);
    dv.setUint32(p + 42, offsets[i], true);
    out.set(f.name, p + 46);
    p += 46 + f.name.length;
  });
  dv.setUint32(p, 0x06054b50, true);
  dv.setUint16(p + 4, 0, true);
  dv.setUint16(p + 6, 0, true);
  dv.setUint16(p + 8, files.length, true);
  dv.setUint16(p + 10, files.length, true);
  dv.setUint32(p + 12, p - cdStart, true);
  dv.setUint32(p + 16, cdStart, true);
  dv.setUint16(p + 20, 0, true);
  return out;
}
