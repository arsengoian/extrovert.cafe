# Воркер аналізу відео. Дві стадії, бо експорт моделі й запуск моделі
# потрібні в РІЗНИХ місцях:
#
#   model   — тягне torch + ultralytics (≈1,5 ГБ) і один раз конвертує
#             yolo11n.pt у ONNX. Виконується на збірці, тобто в CI чи на
#             машині розробника, де є і диск, і трафік.
#   runtime — те, що реально їде на дроплет analysis (1 vCPU / 2 ГБ / 50 ГБ):
#             python, ffmpeg, onnxruntime і готовий .onnx. Ні torch, ні
#             ultralytics тут немає — вони б зайняли більше, ніж увесь
#             робочий набір воркера.
#
# Збирати на ПК і везти образ, а не збирати на дроплеті: там на це немає
# ні памʼяті, ні часу — той самий принцип, що з малиною (CLAUDE.md).

FROM python:3.11-slim AS model
ARG MODEL=yolo11n
ARG IMGSZ=448
# ultralytics тягне за собою десктопний opencv, а він у slim не стартує без
# libxcb/libgl. Стадія все одно викидається, тож простіше доставити бібліотеки,
# ніж воювати з залежностями.
RUN apt-get update \
 && apt-get install -y --no-install-recommends libgl1 libglib2.0-0 \
 && rm -rf /var/lib/apt/lists/*
# CPU-колесо torch (≈190 МБ) замість дефолтного CUDA-збирання (≈2,5 ГБ):
# експорту в ONNX відеокарта не потрібна.
RUN pip install --no-cache-dir torch==2.4.1 torchvision==0.19.1 \
      --index-url https://download.pytorch.org/whl/cpu \
 && pip install --no-cache-dir ultralytics==8.3.9 onnx==1.16.2 onnxslim==0.1.34
WORKDIR /export
# 448, а не 640, і int8 поверх нього. Це не економія з переляку, а замір
# (README.md, «Скільки це коштує насправді»): на одному ядрі 640 дає 269 мс
# на кадр, 448 — 143, 448+int8 — 112, і на тестовому відео всі три знаходять
# однакову кількість людей. За 640 ми платили б утричі більшим ядром за
# рамки, яких там немає.
RUN python -c "from ultralytics import YOLO; YOLO('${MODEL}.pt').export(format='onnx', imgsz=${IMGSZ}, simplify=True, opset=12)" \
 && mv ${MODEL}.onnx model-fp32.onnx \
 && pip install --no-cache-dir onnxruntime==1.19.2 \
 && python -c "from onnxruntime.quantization import quantize_dynamic, QuantType; quantize_dynamic('model-fp32.onnx', 'model.onnx', weight_type=QuantType.QUInt8)"

FROM python:3.11-slim AS runtime
RUN apt-get update \
 && apt-get install -y --no-install-recommends ffmpeg \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY backend/worker/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY --from=model /export/model.onnx /app/models/model.onnx
# Неквантована копія лежить поруч: якщо на живому відео int8 почне губити
# людей, перемикання — це один MODEL_PATH, а не перезбірка образу посеред дня.
COPY --from=model /export/model-fp32.onnx /app/models/model-fp32.onnx
COPY backend/worker/worker /app/worker
COPY backend/worker/tools /app/tools
ENV PYTHONUNBUFFERED=1 \
    MODEL_PATH=/app/models/model.onnx \
    OMP_NUM_THREADS=1
# Одне ядро — і onnxruntime про це має знати сам: інакше він підніме пул
# потоків на всі ядра хоста й на shared vCPU це дасть мінус, а не плюс.
CMD ["python", "-m", "worker.main"]
