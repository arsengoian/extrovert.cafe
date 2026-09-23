// Лист через HTTP API Mailgun (docs/services.md §3, «Вхід гравця»).
//
// Один виклик — один лист, без повторів: лист для входу, що прийшов двічі,
// плутає більше, ніж той, що не прийшов, — людина однаково натисне
// «надіслати ще раз». MAILGUN_API — окремо, бо в EU-регіоні адреса інша
// (https://api.eu.mailgun.net), і домен, заведений там, через api.mailgun.net
// не відправляє.
const cfg = () => ({
  key: process.env.MAILGUN_API_KEY,
  domain: process.env.MAILGUN_DOMAIN,
  api: (process.env.MAILGUN_API || "https://api.mailgun.net").replace(/\/+$/, ""),
  // Відправник — з кореневого домену, а не з технічного
  // mail.extrovert.cafe: у списку листів людині видно саме адресу.
  // Відправляє все одно домен Mailgun, і DMARC це влаштовує —
  // relaxed-вирівнювання дивиться на організаційний домен, спільний в обох.
  from: process.env.MAIL_FROM || "hello@extrovert.cafe",
});

export const mailConfigured = () => Boolean(cfg().key && cfg().domain);

export async function sendMail({ to, subject, text, html, tag }) {
  const { key, domain, api, from } = cfg();
  const body = new FormData();
  // Ім'я в лапках: рядок із крапками RFC 5322 інакше вважає невалідним,
  // і поштові клієнти показують лапки самі.
  body.append("from", `"extrovert.cafe" <${from}>`);
  body.append("to", to);
  body.append("subject", subject);
  body.append("text", text);
  body.append("html", html);
  if (tag) body.append("o:tag", tag);
  // Без трекінгу. Із ним Mailgun переписав би посилання на свій
  // редирект-домен: одноразовий ключ від акаунта їхав би через чужий сервер,
  // а поштові сканери, що перевіряють посилання, ходили б по ньому першими.
  body.append("o:tracking", "no");
  body.append("o:tracking-clicks", "no");
  body.append("o:tracking-opens", "no");

  const res = await fetch(`${api}/v3/${domain}/messages`, {
    method: "POST",
    headers: { authorization: `Basic ${Buffer.from(`api:${key}`).toString("base64")}` },
    body,
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`mailgun ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return res.json();
}
