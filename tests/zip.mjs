// 검사용 zip 만들기 — sheet(엑셀)와 office(워드·PPT) 둘이 같이 쓴다.
// 실제 파일을 레포에 두지 않으려는 것이고(§1.3 스크린샷 함정과 같은 이유),
// 압축 없이(stored) 담아서 zip 라이브러리도 안 들인다 — 파서의 stored 경로도
// 같이 지난다.
// 파일 목록 → 압축 없이(stored) 담은 zip. 검사에 zip 라이브러리를 들이지 않으려는
// 것이고, 파서의 stored 경로도 같이 지난다.
export function zipOf(files) {
  const enc = new TextEncoder();
  const chunks = [], central = [];
  let offset = 0;
  const put = (arr, ...vals) => vals.forEach(v => arr.push(v));
  const w16 = (n) => [n & 255, (n >> 8) & 255];
  const w32 = (n) => [n & 255, (n >> 8) & 255, (n >> 16) & 255, (n >> 24) & 255];
  for (const [name, body] of files) {
    const nb = enc.encode(name), db = enc.encode(body);
    const local = [];
    put(local, ...w32(0x04034b50), ...w16(20), ...w16(0), ...w16(0), ...w16(0), ...w16(0),
      ...w32(0), ...w32(db.length), ...w32(db.length), ...w16(nb.length), ...w16(0));
    const head = new Uint8Array([...local, ...nb, ...db]);
    chunks.push(head);
    const cen = [];
    put(cen, ...w32(0x02014b50), ...w16(20), ...w16(20), ...w16(0), ...w16(0), ...w16(0), ...w16(0),
      ...w32(0), ...w32(db.length), ...w32(db.length), ...w16(nb.length), ...w16(0), ...w16(0),
      ...w16(0), ...w16(0), ...w32(0), ...w32(offset));
    central.push(new Uint8Array([...cen, ...nb]));
    offset += head.length;
  }
  const cenBytes = central.reduce((a, b) => a + b.length, 0);
  const eocd = new Uint8Array([...w32(0x06054b50), ...w16(0), ...w16(0),
    ...w16(files.length), ...w16(files.length), ...w32(cenBytes), ...w32(offset), ...w16(0)]);
  const all = [...chunks, ...central, eocd];
  const total = all.reduce((a, b) => a + b.length, 0);
  const out = new Uint8Array(total);
  let p = 0;
  for (const c of all) { out.set(c, p); p += c.length; }
  return out.buffer;
}
