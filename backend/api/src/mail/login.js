// Лист із посиланням для входу. Токени бренду — ті самі, що в застосунку
// (frontend/client/src/theme.css, темна тема): лист — продовження гри, а не
// сповіщення від «системи».
//
// Верстка під пошту, а не під браузер: таблиці, стилі в атрибутах, картинки
// PNG з абсолютних адрес (SVG Gmail не показує). Градієнт кнопки має
// суцільний запасний колір — Outlook градієнтів не малює. Шрифт Extro
// підтягують лише Apple Mail та iOS, решта бере системний — тому розміри
// підібрані так, щоб лист тримався й без нього. Картинки лежать у статиці
// клієнта (frontend/client/public/assets/email), бо тільки вона має
// публічну адресу.

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

const C = {
  bg: "#0C0E11", panel: "#15181C", panel2: "#1B1F24", line: "#2A2D31",
  ink: "#F2EFE6", muted: "#8B94A3", accent: "#FE810B", accentInk: "#1A1206",
  grad: "linear-gradient(96deg,#FE810B 8%,#FF2D6F 92%)",
};
const FONT = "'Extro',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";

export function loginEmail({ link, minutes, origin }) {
  const subject = "Посилання для входу в extrovert.cafe";
  const note = `Посилання діє ${minutes} хвилин і спрацює один раз — на тому пристрої, де ти його відкриєш.`;
  const ignore = "Якщо лист прийшов без твого запиту, просто проігноруй його: без посилання в акаунт ніхто не увійде.";

  const text = [
    "Кавенятко вже чекає!",
    "",
    "Щоб увійти в extrovert.cafe, відкрий посилання:",
    link,
    "",
    note,
    "",
    "Пароля в нас немає: щоразу, коли входиш поштою, приходить такий лист.",
    ignore,
  ].join("\n");

  const a = esc(link);
  const o = esc(origin);
  const html = `<!doctype html>
<html lang="uk">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="dark">
<meta name="supported-color-schemes" content="dark">
<title>${esc(subject)}</title>
<style>
@font-face{font-family:'Extro';src:url('${o}/assets/fonts/Extro400.ttf') format('truetype');font-weight:400}
@font-face{font-family:'Extro';src:url('${o}/assets/fonts/Extro700.ttf') format('truetype');font-weight:700}
@font-face{font-family:'Extro';src:url('${o}/assets/fonts/Extro900.ttf') format('truetype');font-weight:900}
body{margin:0;padding:0;background:${C.bg}}
a{color:${C.accent}}
@media (max-width:520px){.card{padding:28px 20px!important}.h1{font-size:24px!important}}
</style>
</head>
<body style="margin:0;padding:0;background:${C.bg}">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent">${esc(note)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${C.bg}" style="background:${C.bg}">
<tr><td align="center" style="padding:32px 16px 40px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:480px">

<tr><td align="center" style="padding:0 0 24px">
<a href="${o}" style="text-decoration:none"><img src="${o}/assets/email/logo.png" width="170" height="34" alt="extrovert.cafe" style="display:block;border:0;width:170px;height:34px"></a>
</td></tr>

<tr><td class="card" bgcolor="${C.panel}" style="background:${C.panel};border:1px solid ${C.line};border-radius:24px;padding:32px 28px;font-family:${FONT};color:${C.ink}">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
<tr><td align="center" style="padding:0 0 18px">
<img src="${o}/assets/email/kavenyatko.png" width="132" height="132" alt="Кавенятко" style="display:block;border:0;width:132px;height:132px">
</td></tr>
<tr><td align="center" class="h1" style="font-family:${FONT};font-size:26px;line-height:1.2;font-weight:900;color:${C.ink};padding:0 0 12px">Кавенятко вже чекає</td></tr>
<tr><td align="center" style="font-family:${FONT};font-size:15px;line-height:1.5;color:${C.muted};padding:0 0 26px">Натисни кнопку, щоб увійти в extrovert.cafe. Пароля в нас немає: щоразу, коли входиш поштою, приходить такий лист.</td></tr>
<tr><td align="center" style="padding:0 0 22px">
<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
<td align="center" bgcolor="${C.accent}" style="border-radius:999px;background:${C.accent};background-image:${C.grad}">
<a href="${a}" target="_blank" style="display:inline-block;padding:15px 38px;font-family:${FONT};font-size:16px;line-height:20px;font-weight:900;color:${C.accentInk};text-decoration:none;border-radius:999px">Увійти в гру</a>
</td></tr></table>
</td></tr>
<tr><td align="center" style="font-family:${FONT};font-size:13px;line-height:1.45;color:${C.muted};padding:0 0 22px">${esc(note)}</td></tr>
<tr><td bgcolor="${C.panel2}" style="background:${C.panel2};border-radius:14px;padding:14px 16px;font-family:${FONT};font-size:12px;line-height:1.45;color:${C.muted}">
Кнопка не натискається? Скопіюй адресу в браузер:<br>
<a href="${a}" target="_blank" style="color:${C.accent};word-break:break-all">${a}</a>
</td></tr>
</table>
</td></tr>

<tr><td align="center" style="padding:22px 12px 0;font-family:${FONT};font-size:12px;line-height:1.5;color:${C.muted}">
${esc(ignore)}<br><br>
<a href="${o}" style="color:${C.muted};text-decoration:underline">extrovert.cafe</a>
</td></tr>

</table>
</td></tr>
</table>
</body>
</html>`;

  return { subject, text, html };
}
