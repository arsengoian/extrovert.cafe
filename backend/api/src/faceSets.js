// Набір обличчя нового кавенятка (bush_graphics_customization.md §10.2).
//
// Наборів п'ять (A–E, face_set_id 1–5; клієнт: plant/scene.js, faceSetLetter).
// Обирається випадково, але спершу з тих, яких у гравця ще немає: п'ять
// кавенят — п'ять різних облич. Коли всі вже є — з усіх п'яти. Номер
// фіксується назавжди (plants.face_set_id), гравець його не змінює.
//
// До 02.10.2026 тут було 1 + random(3) у трьох місцях, а клієнт малював усім
// обличчя A — тому в старих кавенят трапляються лише 1–3 і повтори.
export const FACE_SET_COUNT = 5;

export async function pickFaceSet(client, ownerId) {
  const { rows } = await client.query("select distinct face_set_id from plants where owner_id = $1", [ownerId]);
  const have = new Set(rows.map((r) => r.face_set_id));
  const all = Array.from({ length: FACE_SET_COUNT }, (_, i) => i + 1);
  const fresh = all.filter((id) => !have.has(id));
  const pool = fresh.length ? fresh : all;
  return pool[Math.floor(Math.random() * pool.length)];
}
