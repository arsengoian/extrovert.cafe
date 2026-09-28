// Обране кавенятко: те, що на головному екрані зараз. Переживає зміну
// екранів і перезавантаження, і його ж бере за замовчуванням кожен вибір
// кавенятка («Кому вдягнути» тощо) — людина щойно дивилась саме на нього
// (власник, 28.09.2026). localStorage, а не sessionStorage: після нового
// входу теж логічно відкрити того, з ким говорив учора.
const KEY = "extrovert.plant";

export function selectedPlantId() {
  try { return localStorage.getItem(KEY); } catch { return null; }
}

export function rememberPlant(id) {
  try { if (id) localStorage.setItem(KEY, id); } catch { /* приватний режим — просто не памʼятаємо */ }
}

// Номер обраного в списку, а якщо його там немає (скошений, подарований) — 0.
export function selectedIndex(plants) {
  const at = (plants ?? []).findIndex((p) => p.id === selectedPlantId());
  return at >= 0 ? at : 0;
}

export const preferSelected = (plants) => (plants?.length ? plants[selectedIndex(plants)] : null);
