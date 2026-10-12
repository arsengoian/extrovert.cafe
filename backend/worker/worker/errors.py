"""Помилки воркера — у GlitchTip, проєкт `worker` (docs/services.md).

Node-сервіси шлють події власним клієнтом на сто рядків (lib/errors.js),
бо @sentry/node тягне OpenTelemetry. У Python такої проблеми немає:
sentry-sdk — це чистий Python на urllib3, який і так приїхав разом із boto3.

Без DSN нічого не вмикається: локальні прогони й bench лишаються тихими.
Стеля — 20 подій на хвилину, як у lib/errors.js: битий R2 чи база, що
лягла, валили б сегмент за сегментом, і кожен — окрема подія.
"""
import os
import time

_sdk = None
_sent: list[float] = []
LIMIT_PER_MIN = 20


def _cap(event, _hint):
    now = time.monotonic()
    _sent[:] = [t for t in _sent if now - t < 60]
    if len(_sent) >= LIMIT_PER_MIN:
        return None
    _sent.append(now)
    return event


def init(app_env: str) -> bool:
    global _sdk
    dsn = os.environ.get("GLITCHTIP_DSN_WORKER") or os.environ.get("GLITCHTIP_DSN")
    if not dsn:
        return False
    import sentry_sdk
    sentry_sdk.init(
        dsn=dsn,
        environment=app_env,
        # TAG — коміт образу, його переписує rollout.sh; той самий release,
        # що й у сервісів на bun.
        release=os.environ.get("TAG") or None,
        traces_sample_rate=0,
        before_send=_cap,
    )
    sentry_sdk.set_tag("service", "worker")
    _sdk = sentry_sdk
    return True


def capture(err: BaseException, **tags) -> None:
    """Сегмент упав — у GlitchTip зі стеком і тим, який саме сегмент."""
    if _sdk is None:
        return
    _sdk.capture_exception(err, tags={k: str(v) for k, v in tags.items()})
