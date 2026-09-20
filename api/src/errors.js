// Помилка з кодом відповіді, яку можна кинути звідусіль — зокрема зсередини
// транзакції.
//
// Чому не `return reply.code(409).send(...)`: усередині tx() такий вихід —
// це звичайне повернення значення, тому транзакція КОМІТИТЬСЯ разом з усім,
// що встигли записати до перевірки. Ми вже на цьому попались: невдала
// спроба вдягнути замкнений предмет лишала по собі новий порожній комплект
// і знятий із кавенятка старий. Кинутий виняток відкочує транзакцію, а
// setErrorHandler перетворює його на ту саму відповідь.
export class HttpError extends Error {
  constructor(status, body) {
    super(body?.error ?? `HTTP ${status}`);
    this.status = status;
    this.body = body;
  }
}

export function fail(status, error, extra = {}) {
  throw new HttpError(status, { error, ...extra });
}

export function registerErrorHandler(app) {
  app.setErrorHandler((err, req, reply) => {
    if (err instanceof HttpError) return reply.code(err.status).send(err.body);
    app.log.error(err);
    const status = err.statusCode && err.statusCode < 500 ? err.statusCode : 500;
    return reply.code(status).send({ error: status === 500 ? "internal" : err.code ?? "bad_request" });
  });
}
