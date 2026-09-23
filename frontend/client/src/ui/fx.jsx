// Спільні ефекти з дошки «Анімації» макета: іскорки, кільце тапу, політ
// монет у шапку й лічильник, що перебігає до нового значення. Усе — лише
// transform і opacity, і все мовчить, коли в системі ввімкнено «менше руху»
// (там і CSS гасить анімації — theme.css, prefers-reduced-motion).
import { useEffect, useRef, useState } from "react";

export const calm = () => typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

const fmt = (n) => new Intl.NumberFormat("uk-UA").format(n ?? 0);

// ── іскорки ─────────────────────────────────────────────────────────────
// Частки розлітаються по колу з легким зсувом угору — так розкладені вони
// на дошці. Кількість і розмір — за подією: листок, гілка, бутон, перехід
// стадії, скринька; для дропу — за рідкістю (Common мало, Epic багато).
export const SPARKS = {
  leaf: { n: 8, r: 54, size: 6, color: "#FFD37A" },
  branch: { n: 10, r: 62, size: 7, color: "#FFD37A" },
  bud: { n: 6, r: 38, size: 5, color: "#FFD37A" },
  fruit: { n: 7, r: 42, size: 5, color: "#FFD37A" },
  stage: { n: 12, r: 84, size: 7, color: "#FFB84D" },
  crate: { n: 10, r: 62, size: 6, color: "#FFD37A" },
  barrel: { n: 8, r: 46, size: 5, color: "#FFD37A" },
  // Кольори рідкості — ті самі змінні, що й у рамках, плашках і тексті
  // (theme.css): інакше іскорки навколо речі жили своїм життям і
  // «рідкісне» світилось не тим синім, що підпис під ним.
  common: { n: 4, r: 34, size: 4, color: "rgb(var(--tier-common))" },
  uncommon: { n: 6, r: 42, size: 5, color: "rgb(var(--tier-uncommon))" },
  rare: { n: 9, r: 52, size: 6, color: "rgb(var(--tier-rare))" },
  epic: { n: 12, r: 62, size: 7, color: "rgb(var(--tier-epic))" },
};

const points = (n, r) => Array.from({ length: n }, (_, k) => {
  const a = ((k + 0.5) / n) * Math.PI * 2;
  return [Math.round(r * Math.cos(a)), Math.round(r * Math.sin(a) - r * 0.11)];
});

const sparkStyle = (s, dx, dy, duration, delay) => ({
  width: s.size, height: s.size, background: s.color,
  "--dx": `${dx}px`, "--dy": `${dy}px`,
  animationDuration: `${duration}ms`, animationDelay: `${delay}ms`,
});

// Один спалах у точці (x, y) батька. Разовий: частки лишаються невидимими
// після кінця, тож прибирати його не обов'язково — досить змінити key.
export function Sparks({ kind = "leaf", x = 0, y = 0, delay = 0, duration = 700 }) {
  if (calm()) return null;
  const s = SPARKS[kind] ?? SPARKS.leaf;
  return (
    <div className="fx-sparks" style={{ left: x, top: y }}>
      {points(s.n, s.r).map(([dx, dy], i) => <i key={i} style={sparkStyle(s, dx, dy, duration, delay)} />)}
    </div>
  );
}

// Те саме без React — для місць, де стан заради спалаху заводити не варто.
export function burst(host, x, y, kind = "leaf", { delay = 0, duration = 700 } = {}) {
  if (!host || calm()) return;
  const s = SPARKS[kind] ?? SPARKS.leaf;
  const el = document.createElement("div");
  el.className = "fx-sparks";
  el.style.left = `${x}px`;
  el.style.top = `${y}px`;
  for (const [dx, dy] of points(s.n, s.r)) {
    const i = document.createElement("i");
    Object.assign(i.style, { width: `${s.size}px`, height: `${s.size}px`, background: s.color,
      animationDuration: `${duration}ms`, animationDelay: `${delay}ms` });
    i.style.setProperty("--dx", `${dx}px`);
    i.style.setProperty("--dy", `${dy}px`);
    el.appendChild(i);
  }
  host.appendChild(el);
  setTimeout(() => el.remove(), delay + duration + 100);
}

// ── тап ─────────────────────────────────────────────────────────────────
// «Натискання кнопки»: кільце розходиться від точки дотику (як в Android) і
// легке стиснення до 95.5 %. Механіка одна для всіх темних і градієнтних
// інтерактивних елементів; на градієнтних і кольорових кільце густіше.
// Прозорі кнопки-іконки й пункти меню не блимають — там нема чого заливати.
let tapInstalled = false;

export function installTapFx() {
  if (tapInstalled || typeof document === "undefined") return;
  tapInstalled = true;
  document.addEventListener("pointerdown", (e) => {
    if (e.button !== 0 || calm()) return;
    const el = e.target.closest?.("button, [role='button'], a[href]");
    if (!el || el.disabled || el.getAttribute("aria-disabled") === "true") return;
    const cs = getComputedStyle(el);
    const gradient = cs.backgroundImage.includes("gradient");
    const rgba = (cs.backgroundColor.match(/[\d.]+/g) ?? ["0", "0", "0", "0"]).map(Number);
    const alpha = rgba.length > 3 ? rgba[3] : 1;
    if (!gradient && alpha < 0.05) return;
    const strong = gradient || Math.max(rgba[0], rgba[1], rgba[2]) - Math.min(rgba[0], rgba[1], rgba[2]) > 80;

    const box = el.getBoundingClientRect();
    const x = e.clientX - box.left;
    const y = e.clientY - box.top;
    const size = 2 * Math.hypot(Math.max(x, box.width - x), Math.max(y, box.height - y));
    const ink = document.createElement("span");
    ink.className = "fx-ink";
    const dot = document.createElement("span");
    Object.assign(dot.style, { left: `${x}px`, top: `${y}px`, width: `${size}px`, height: `${size}px`,
      background: `var(${strong ? "--ripple-strong" : "--ripple"})` });
    ink.appendChild(dot);
    // Кільцю потрібен власний контейнер; статичну кнопку на мить робимо
    // relative — зсуву це не дає.
    const restore = cs.position === "static" ? el.style.position : null;
    if (restore !== null) el.style.position = "relative";
    el.appendChild(ink);
    // Стискаємо лише те, що не рухається саме: хмаринку чи репліку зі своєю
    // анімацією transform перебивати не можна.
    if (cs.transform === "none" && cs.animationName === "none" && el.animate) {
      el.animate([{ transform: "scale(1)" }, { transform: "scale(.955)", offset: 0.18 }, { transform: "scale(1)", offset: 0.42 }, { transform: "scale(1)" }],
        { duration: 550, easing: "ease-out" });
    }
    setTimeout(() => {
      ink.remove();
      if (restore !== null) el.style.position = restore;
    }, 650);
  }, { passive: true });
}

// ── монети в шапку ──────────────────────────────────────────────────────
// «Нарахування монет»: після оплати монети летять у шапку. Звідки — з
// іконки нагороди в попапі, якщо вона щойно з'явилась (markCoinSource),
// інакше знизу по центру екрана.
let source = null;

export function markCoinSource(el) {
  if (!el) return;
  source = { rect: el.getBoundingClientRect(), at: Date.now() };
}

export function flyCoins(target, src = "/assets/ui/coin_gold.png", count = 6) {
  if (!target || calm()) return;
  const host = document.querySelector(".app") ?? document.body;
  const hb = host.getBoundingClientRect();
  const to = target.getBoundingClientRect();
  const fresh = source && Date.now() - source.at < 2500 ? source.rect : null;
  const from = fresh
    ? { x: fresh.left + fresh.width / 2, y: fresh.top + fresh.height / 2 }
    : { x: hb.left + hb.width / 2, y: hb.top + hb.height * 0.7 };
  source = null;
  const layer = document.createElement("div");
  layer.className = "fx-layer";
  for (let i = 0; i < count; i++) {
    const img = document.createElement("img");
    img.src = src;
    img.alt = "";
    img.className = "fx-coin";
    const sx = from.x - hb.left - 10 + i * 6;
    const sy = from.y - hb.top - 10 - i * 4;
    Object.assign(img.style, { left: `${sx}px`, top: `${sy}px`, animationDelay: `${i * 70}ms` });
    img.style.setProperty("--cx", `${to.left - hb.left + to.width / 2 - 10 - sx}px`);
    img.style.setProperty("--cy", `${to.top - hb.top + to.height / 2 - 10 - sy}px`);
    layer.appendChild(img);
  }
  host.appendChild(layer);
  setTimeout(() => layer.remove(), 1100 + count * 70 + 150);
}

// ── лічильник, що перебігає ─────────────────────────────────────────────
// Кожна цифра — стрічка, що прокручується до нової, ліві зупиняються
// раніше за праві, як на дошці (кільця aRollA…D). Лише на зростанні:
// витрати просто міняють число.
export function RollingNumber({ value, format = fmt }) {
  const last = useRef(value);
  const [roll, setRoll] = useState(null);

  useEffect(() => {
    const from = last.current;
    last.current = value;
    if (from == null || value == null || value <= from || calm()) { setRoll(null); return undefined; }
    setRoll({ from, to: value, id: Date.now() });
    const t = setTimeout(() => setRoll(null), 2100);
    return () => clearTimeout(t);
  }, [value]);

  if (!roll) return format(value);
  const to = format(roll.to);
  const from = format(roll.from).padStart(to.length, " ");
  let col = 0;
  return (
    <span className="fx-roll" key={roll.id} aria-label={to}>
      {[...to].map((ch, i) => {
        if (!/\d/.test(ch)) return <span key={i} className="fx-roll-gap">{ch}</span>;
        const d1 = Number(ch);
        const d0 = /\d/.test(from[i]) ? Number(from[i]) : 0;
        const steps = d1 >= d0 ? d1 - d0 : d1 + 10 - d0;
        const share = Math.min(0.72 + 0.06 * col, 0.96);
        col += 1;
        return (
          <span key={i} className="fx-roll-col" aria-hidden="true">
            <span style={{ "--steps": steps, animationDuration: `${Math.round(2000 * share)}ms` }}>
              {Array.from({ length: steps + 1 }, (_, k) => <i key={k}>{(d0 + k) % 10}</i>)}
            </span>
          </span>
        );
      })}
    </span>
  );
}
