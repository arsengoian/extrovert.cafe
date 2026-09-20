// Іконка предмета одягу: конвенція одна — /assets/ui/<sprite_id>.png.
// Частина спрайтів ще не намальована (питання в questions.md), тому замість
// битої картинки показуємо заглушку: порожня клітинка виглядала б як
// «нічого не вдягнено», а це неправда. Там, де назва вже підписана поруч
// (сітки каталога й складу), name не передають — інакше вона двоїться.
import { useState } from "react";

export function ItemIcon({ sprite, size = 64, alt = "", name, style }) {
  const [broken, setBroken] = useState(false);

  if (broken) {
    return (
      <div className="item-stub" style={{ height: size, ...style }} title={name || alt}>
        {name ? name.slice(0, 18) : "—"}
      </div>
    );
  }

  return (
    <img
      src={`/assets/ui/${sprite}.png`}
      alt={alt}
      style={{ width: "100%", height: size, objectFit: "contain", ...style }}
      onError={() => setBroken(true)}
    />
  );
}
