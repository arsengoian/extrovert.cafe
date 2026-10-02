// Справжня адреса клієнта. За Caddy вона в X-Real-IP (він її переписує,
// підробити ззовні не вийде); локально Caddy немає, і там це неважливо.
// Не адреса — null, щоб сміття в заголовку не валило запит на колонці inet.
// Спільне для входу (rate limit листів) і аналітики (analytics.js).
import { isIP } from "node:net";

export const clientIp = (req) => {
  const ip = String(req.headers["x-real-ip"] || req.ip || "");
  return isIP(ip) ? ip : null;
};
