// Overseer — telegram-бот звітності. Працює на лупі, шле події в груповий чат.
const EVERY_MS = Number(process.env.OVERSEER_INTERVAL_MS || 300000);

async function tick() {
  // TODO: продажі за період з Postgres → повідомлення в чат
  // TODO: перевірка Checkbox GET /api/v1/webhook — last_error_date не порожній?
  // TODO: пінг pos.extrovert.cafe/healthz по кожній точці
}

console.log(`overseer: лупа кожні ${EVERY_MS} мс`);
setInterval(tick, EVERY_MS);
tick();
