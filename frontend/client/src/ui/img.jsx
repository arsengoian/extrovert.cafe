// Картинки — WebP і в кількох роздільностях (scripts/build-webp.mjs,
// власник 02.10.2026). PNG лишаються в public/ для друку, листів і кіоска, а
// застосунок бере WebP: у 6–8 разів легший при тій самій картинці.
//
// srcSet — усі ширини, що є в картинки (images.gen.json), sizes — розмір
// на екрані в CSS-пікселях. Решту робить браузер: множить sizes на щільність
// екрана (×3 на найщільніших телефонах) і бере найменшу копію, якої
// вистачає. Тому менша роздільність не потрапляє туди, де її бракує.
import variants from "../images.gen.json";

const keyOf = (src) => String(src).replace(/^\/?assets\//, "").replace(/\.webp$/, ".png");

export const webp = (src) => String(src).replace(/\.png$/, ".webp");

export function srcSetOf(src) {
  const key = keyOf(src);
  const widths = variants[key];
  if (!widths || widths.length < 2) return undefined;
  const native = widths.at(-1);
  const base = `/assets/${key.replace(/\.png$/, "")}`;
  return widths.map((w) => `${base}${w === native ? "" : `-${w}w`}.webp ${w}w`).join(", ");
}

// <img> для великих картинок, показаних дрібно (напої, кущ на старті,
// платформа): sizes — ширина на екрані.
export function Img({ src, sizes, ...rest }) {
  const set = srcSetOf(src);
  return <img src={webp(src)} srcSet={set} sizes={set ? sizes : undefined} {...rest} />;
}
