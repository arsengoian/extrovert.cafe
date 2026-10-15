"""Вектор зовнішності людини з вирізок — для впізнавання за одягом.

Моделі — person-reidentification-retail-0277/0286/0287 з Intel Open Model
Zoo (OpenVINO IR, вхід 128×256, вихід 256 чисел кожна). Навчені саме на
тому, що нам треба: та сама людина з різних боків у камерах магазинів. На
архіві картки 09–14.10 (docs/video.md, «Люди й візити») середнє трьох
розрізняє «спина ↔ спина» з AUC 0,98 і «спина ↔ обличчя» (вхід ↔ вихід) з
AUC 0,93, тоді як загальна модель зору DINOv2 — 0,58 і 0,80, а гістограма
кольору одягу — 0,80 і 0,84. Пороги впізнавання (config.py) підібрані на
цьому середньому — з однією моделлю шкала схожості інша.

Вектор проходу — для кожної моделі зважене середнє її векторів по вирізках,
нормоване, і три такі блоки поруч, поділені на √3: скалярний добуток двох
векторів — середній косинус трьох моделей.

Один потік: воркер і так обмежений половиною ядра (docker-compose.prod.yml),
і пул потоків OpenVINO на всі ядра хоста лише заважав би сусідам.
"""
import os

import numpy as np

W, H = 128, 256
DIM = 256


class Reid:
    def __init__(self, folder: str, models=("0277", "0286", "0287")):
        self.nets = []
        paths = [os.path.join(folder or "", f"person-reidentification-retail-{m}.xml") for m in models]
        if not models or not all(os.path.exists(p) for p in paths):
            return
        import openvino as ov
        core = ov.Core()
        core.set_property("CPU", {"INFERENCE_NUM_THREADS": 1})
        for p in paths:
            net = core.compile_model(core.read_model(p), "CPU")
            self.nets.append((net, net.outputs[0]))

    @property
    def enabled(self) -> bool:
        return bool(self.nets)

    @property
    def dim(self) -> int:
        return DIM * len(self.nets)

    def embed(self, images) -> np.ndarray | None:
        """PIL-вирізки → (n, 256·моделей): блок кожної моделі нормований окремо."""
        if not self.enabled or not images:
            return None
        rows = []
        for im in images:
            # Моделі чекають BGR 0..255; середнє й масштаб уже всередині IR.
            a = np.asarray(im.convert("RGB").resize((W, H)), np.float32)[:, :, ::-1]
            x = np.ascontiguousarray(a.transpose(2, 0, 1)[None])
            parts = []
            for net, out in self.nets:
                y = net(x)[out][0]
                parts.append(y / (np.linalg.norm(y) + 1e-9))
            rows.append(np.concatenate(parts))
        return np.stack(rows).astype(np.float32)


def blocks(v: np.ndarray) -> int:
    return max(1, len(v) // DIM)


def _norm_blocks(m: np.ndarray) -> np.ndarray:
    k = blocks(m)
    m = m.reshape(k, -1)
    m = m / (np.linalg.norm(m, axis=1, keepdims=True) + 1e-9)
    return (m.reshape(-1) / np.sqrt(k)).astype(np.float32)


def mean_vec(vecs: np.ndarray, weights) -> tuple[np.ndarray, float]:
    """Вирізки → вектор проходу (як agg в аналізі архіву) і сума ваг."""
    w = np.asarray(weights, np.float32)
    if w.sum() <= 0:
        w = np.ones(len(vecs), np.float32)
    return _norm_blocks((vecs * w[:, None]).sum(0)), float(w.sum())


def merge(a, wa: float, b, wb: float) -> tuple[np.ndarray | None, float]:
    """Два шматки одного проходу → один вектор, зважено вагами вирізок."""
    if a is None:
        return b, wb
    if b is None:
        return a, wa
    a, b = np.asarray(a, np.float32), np.asarray(b, np.float32)
    k = blocks(a)
    # Блоки a і b нормовані до 1/√k — множимо назад, щоб зважування йшло по
    # одиничних векторах моделей, а не по вже поділених.
    m = a * np.sqrt(k) * wa + b * np.sqrt(k) * wb
    return _norm_blocks(m), wa + wb
