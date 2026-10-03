// Іконка предмета одягу: конвенція одна — /assets/ui/<sprite_id>.webp (WebP-копія
// PNG, scripts/build-webp.mjs).
// Якщо іконки немає (предмет новіший за клієнт), замість
// битої картинки показуємо заглушку: порожня клітинка виглядала б як
// «нічого не вдягнено», а це неправда. Там, де назва вже підписана поруч
// (сітки каталога й складу), name не передають — інакше вона двоїться.
import { useState } from "react";

// Іконки всіх 75 предметів — design/sprites/pipeline/export_clothes_client.py
// (обрізані по вмісту спрайти, взуття — лівий черевик). ui/hat.png лишився
// значком розділу одягу в крамниці, а не іконкою предмета.

export function ItemIcon({ sprite, size = 64, alt = "", name, style }) {
  const [broken, setBroken] = useState(false);

  if (broken) {
    return (
      <div className="item-stub" style={{ height: size, ...style }} title={name || alt}>
        {name ? name.slice(0, 18) : "–"}
      </div>
    );
  }

  return (
    <img
      src={`/assets/ui/${sprite}.webp`}
      alt={alt}
      style={{ width: "100%", height: size, objectFit: "contain", ...style }}
      onError={() => setBroken(true)}
    />
  );
}
