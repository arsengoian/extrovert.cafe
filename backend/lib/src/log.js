// Логер для сервісів без Fastify. Один рядок — один JSON: так GlitchTip і
// docker logs читають однаково, а grep по service лишається можливим.
export function makeLog(service) {
  const write = (level, msg, extra) => {
    const line = { t: new Date().toISOString(), level, service, msg, ...extra };
    process.stdout.write(`${JSON.stringify(line)}\n`);
  };
  return {
    info: (msg, extra) => write("info", msg, extra),
    warn: (msg, extra) => write("warn", msg, extra),
    error: (msg, extra) => write("error", msg, extra instanceof Error
      ? { err: extra.message, stack: extra.stack }
      : extra),
  };
}
