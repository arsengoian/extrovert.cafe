// Мінімальне читання zip у браузері — для резервної копії рецептів машини
// (Recipe_Product_Zip, docs/jetinno.md, «Резервна копія з машини»). Без
// бібліотеки: центральний каталог архіву плюс DecompressionStream
// ("deflate-raw"), який уміють усі сучасні браузери. Шифрування й zip64 не
// підтримуємо — машина таких не пише.
export async function readZip(file) {
  const buf = new Uint8Array(await file.arrayBuffer());
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  // Кінець центрального каталогу шукаємо з кінця: за ним може йти коментар.
  let end = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) {
    if (view.getUint32(i, true) === 0x06054b50) { end = i; break; }
  }
  if (end < 0) throw new Error("це не zip-архів");
  const count = view.getUint16(end + 10, true);
  let p = view.getUint32(end + 16, true);
  const entries = [];
  for (let n = 0; n < count; n++) {
    if (view.getUint32(p, true) !== 0x02014b50) throw new Error("пошкоджений zip");
    const method = view.getUint16(p + 10, true);
    const size = view.getUint32(p + 20, true);
    const nameLen = view.getUint16(p + 28, true);
    const extraLen = view.getUint16(p + 30, true);
    const commentLen = view.getUint16(p + 32, true);
    const local = view.getUint32(p + 42, true);
    const name = new TextDecoder().decode(buf.subarray(p + 46, p + 46 + nameLen));
    p += 46 + nameLen + extraLen + commentLen;
    // Дані — за локальним заголовком, у якого свої довжини імені й extra.
    const start = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true);
    const data = buf.subarray(start, start + size);
    entries.push({
      name,
      text: async () => {
        if (method === 0) return new TextDecoder().decode(data);
        if (method !== 8) throw new Error(`стиснення ${method} не підтримується`);
        const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
        return new TextDecoder().decode(await new Response(stream).arrayBuffer());
      },
    });
  }
  return entries;
}
