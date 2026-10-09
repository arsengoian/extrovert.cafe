// Мінімальний ZIP (читання й запис) для recipe-пакета Jetinno. Вбудованого
// зиппера в bun немає, а тягти залежність заради двох файлів не варто:
// пакет машини — два deflate-записи в теці JetinnoZip/, без маніфесту й
// підпису (перевірено на бекапі 08.10.2026). Запис — тим самим методом
// (deflate), щоб вийшов байт-сумісний за форматом архів.
import { inflateRawSync, deflateRawSync } from "node:zlib";

// CRC-32 (ZIP) — таблиця й підрахунок.
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

// Читання через центральний каталог: машина пише розміри в data descriptor,
// а локальний заголовок лишає нульовим, тож правдиві розмір/метод беремо з
// центрального каталогу (EOCD → записи CD → дані за offset локального
// заголовка). Повертає [{name, data}] розпакованими; stored (0) і deflate (8).
export function readZip(buf) {
  // EOCD — шукаємо з кінця (може бути коментар, але в пакеті Jetinno його немає).
  let eocd = -1;
  for (let i = buf.length - 22; i >= 0; i--) { if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; } }
  if (eocd < 0) throw new Error("не схоже на ZIP: немає EOCD");
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);        // offset центрального каталогу
  const out = [];
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error("битий центральний каталог");
    const method = buf.readUInt16LE(p + 10);
    const compSize = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const lho = buf.readUInt32LE(p + 42);
    const name = buf.toString("utf8", p + 46, p + 46 + nameLen);
    // Локальний заголовок: його name/extra можуть мати іншу довжину за CD.
    const lNameLen = buf.readUInt16LE(lho + 26);
    const lExtraLen = buf.readUInt16LE(lho + 28);
    const dataStart = lho + 30 + lNameLen + lExtraLen;
    const comp = buf.subarray(dataStart, dataStart + compSize);
    if (!name.endsWith("/")) out.push({ name, data: method === 8 ? inflateRawSync(comp) : Buffer.from(comp) });
    p += 46 + nameLen + extraLen + commentLen;
  }
  if (!out.length) throw new Error("ZIP порожній");
  return out;
}

// Запис: кожен запис deflate-методом, локальні заголовки + центральний
// каталог + EOCD. DOS-час фіксований (архів однаковий при однакових даних).
export function writeZip(entries) {
  const DOS_TIME = 0, DOS_DATE = 0x21; // 1980-01-01, байт-стабільно
  const locals = [];
  const central = [];
  let offset = 0;
  for (const { name, data } of entries) {
    const nameBuf = Buffer.from(name, "utf8");
    const comp = deflateRawSync(data, { level: 9 });
    const crc = crc32(data);
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0);
    lh.writeUInt16LE(20, 4);            // version needed
    lh.writeUInt16LE(0, 6);             // flags
    lh.writeUInt16LE(8, 8);             // method = deflate
    lh.writeUInt16LE(DOS_TIME, 10);
    lh.writeUInt16LE(DOS_DATE, 12);
    lh.writeUInt32LE(crc, 14);
    lh.writeUInt32LE(comp.length, 18);
    lh.writeUInt32LE(data.length, 22);
    lh.writeUInt16LE(nameBuf.length, 26);
    lh.writeUInt16LE(0, 28);           // extra len
    locals.push(lh, nameBuf, comp);

    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0);
    ch.writeUInt16LE(20, 4);           // version made by
    ch.writeUInt16LE(20, 6);           // version needed
    ch.writeUInt16LE(0, 8);            // flags
    ch.writeUInt16LE(8, 10);           // method
    ch.writeUInt16LE(DOS_TIME, 12);
    ch.writeUInt16LE(DOS_DATE, 14);
    ch.writeUInt32LE(crc, 16);
    ch.writeUInt32LE(comp.length, 20);
    ch.writeUInt32LE(data.length, 24);
    ch.writeUInt16LE(nameBuf.length, 28);
    ch.writeUInt32LE(offset, 42);      // offset of local header
    central.push(ch, nameBuf);
    offset += 30 + nameBuf.length + comp.length;
  }
  const localBuf = Buffer.concat(locals);
  const centralBuf = Buffer.concat(central);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralBuf.length, 12);
  eocd.writeUInt32LE(localBuf.length, 16);  // offset of central dir
  return Buffer.concat([localBuf, centralBuf, eocd]);
}
