"""R2: викачати сегмент, покласти доказ.

Імена бакетів і запобіжник проти запису в прод повторюють backend/lib/src/r2.js
навмисно — правило «до імені бакета додається суфікс оточення, і лише
APP_ENV=production дає прод-імʼя» має діяти в кожному процесі, який ходить у
R2, інакше воно не правило, а звичка одного сервісу.
"""
import os

import boto3
from botocore.config import Config as BotoConfig
from botocore.exceptions import ClientError

BUCKETS = {
    "video": "extrovert-video",
    "evidence": "extrovert-evidence",
}


class Missing(Exception):
    """Обʼєкта немає: lifecycle зніс сегмент раніше, ніж ми до нього дійшли."""


def bucket_for(purpose: str, app_env: str) -> str:
    base = BUCKETS[purpose]
    if app_env == "production":
        return base
    return f"{base}-{'staging' if app_env == 'staging' else 'dev'}"


class Storage:
    def __init__(self, cfg):
        self.cfg = cfg
        self.s3 = boto3.client(
            "s3",
            endpoint_url=cfg.r2_endpoint,
            aws_access_key_id=cfg.r2_key,
            aws_secret_access_key=cfg.r2_secret,
            region_name=cfg.r2_region,
            # R2 не любить дефолтні ретраї boto — черга й так переживе
            # невдачу, а зависати на сегменті по пів години сенсу немає.
            config=BotoConfig(retries={"max_attempts": 3, "mode": "standard"},
                              connect_timeout=10, read_timeout=120),
        )

    def _guard(self, bucket: str) -> None:
        if bucket in BUCKETS.values() and self.cfg.app_env != "production":
            raise RuntimeError(
                f"відмова писати в прод-бакет «{bucket}» з оточення "
                f"«{self.cfg.app_env}»")

    def download(self, key: str, dst: str) -> int:
        bucket = bucket_for("video", self.cfg.app_env)
        try:
            self.s3.download_file(bucket, key, dst)
        except ClientError as e:
            code = e.response.get("Error", {}).get("Code")
            if code in ("404", "NoSuchKey", "NotFound"):
                raise Missing(f"{bucket}/{key}") from e
            raise
        return os.path.getsize(dst)

    def put_evidence(self, key: str, body: bytes, content_type: str) -> str:
        bucket = bucket_for("evidence", self.cfg.app_env)
        self._guard(bucket)
        self.s3.put_object(Bucket=bucket, Key=key, Body=body,
                           ContentType=content_type)
        return key
