"""Моделі впізнавання для образу воркера: скачати й звірити хеш (docker/Dockerfile, стадія reid).

Ті самі файли, на яких підібрано пороги впізнавання (аналіз архіву картки
09–14.10, docs/video.md «Люди й візити»): інша збірка моделі — інша шкала
схожості, і пороги з config.py перестали б значити те, що значать.
"""
import hashlib
import sys
import urllib.request

BASE = "https://storage.openvinotoolkit.org/repositories/open_model_zoo/2023.0/models_bin/1"
WANT = {
    "0277.xml": "5adcc4ff114737479ee16c1a7f525a7e8e1487d86c7ee7a1b50fcd68ee71f596",
    "0277.bin": "1968d1f91878813b632441c65c9d9147010d225828ae6acdbda364a2e3337315",
    "0286.xml": "d9669dabfa73717a78da9e3b78374571e346cf1c9edf6cb5ff01ed296c878c30",
    "0286.bin": "70c3a02efef82911fad69997894e978eea1a842792f9e2182ad36cb0cb1f01e6",
    "0287.xml": "09af746c1068a3e89355e1f0226d3d6982dc1cd77634b1f70a40f1f654a94be1",
    "0287.bin": "7f53d18d11253455e0e11646b2176cf6509cc7c97cb5376f9b91b4c41e09a06c",
}

for key, sha in WANT.items():
    model, ext = key.split(".")
    name = f"person-reidentification-retail-{model}.{ext}"
    data = urllib.request.urlopen(f"{BASE}/person-reidentification-retail-{model}/FP32/{name}").read()
    got = hashlib.sha256(data).hexdigest()
    if got != sha:
        sys.exit(f"{name}: sha256 {got}, чекали {sha}")
    with open(name, "wb") as fh:
        fh.write(data)
    print(f"{name}: {len(data)} байт, хеш збігся")
