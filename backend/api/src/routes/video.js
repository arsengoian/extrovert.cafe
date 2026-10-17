// Відео з точки: малина вантажить сегменти в R2 за підписаним посиланням і
// реєструє їх тут; адмінка бере посилання на завантаження
// (docs/video.md, «Вивантаження»).
//
// Чому підписане посилання на кожен сегмент, а не тимчасовий ключ R2 на
// малині, як планувалось: curl 7.52 на Stretch не вміє підписувати S3-запити
// (--aws-sigv4 з'явився в 7.75), а рахувати SigV4 у shell на Pi 1 для
// кожного файла — крихко й недешево. Плата — залежність від api: ліг api —
// вивантаження чекає. Але флешка тримає дні запису, тож коротке падіння
// нічого не губить, а ключа від бакета на пристрої в коридорі немає зовсім.
import { presign } from "@extrovert/lib/r2.js";
import { many, one, query } from "../db.js";
import { requireAdmin } from "../auth.js";
import { fail } from "../errors.js";
import { pointFromRequest } from "./points.js";

// Ім'я сегмента — час початку з recorder.sh: «20261007T120000Z.mkv» (UTC,
// відео й звук; з 07.10.2026) або «….ts» у старих, без Z — місцевий час
// малини. Час початку однаково шле малина числом (started_at, секунди), бо
// лише вона знає свій часовий пояс.
const NAME = /^\d{8}T\d{6}Z?\.(ts|mkv)$/;
const TYPE = { ts: "video/mp2t", mkv: "video/x-matroska" };
const typeOf = (name) => TYPE[name.split(".").pop()];
const CAMERA = /^[a-z0-9_-]{1,32}$/;
const MAX_BYTES = 200 * 1024 * 1024;

function pointOrFail(req) {
  const point = pointFromRequest(req);
  if (!point || point !== req.params.id) fail(401, "unauthorized");
  return point;
}

function startedAt(v) {
  const s = Number(v);
  const at = new Date(s * 1000);
  // Дві доби назад — запас на чергу після обриву; вперед — лише годинник.
  if (!Number.isFinite(s) || Math.abs(Date.now() - at) > 9 * 86400_000) fail(400, "bad_started_at");
  return at;
}

const keyFor = (point, camera, name, at) => `${point}/${camera}/${at.toISOString().slice(0, 10)}/${name}`;

export default async function routes(app) {
  // Посилання на заливку одного сегмента. Ключ детермінований: повтор після
  // обриву перезаливає той самий об'єкт, а не плодить копії.
  app.post("/points/:id/video/upload", async (req) => {
    const point = pointOrFail(req);
    const name = String(req.body?.name ?? "");
    const camera = String(req.body?.camera ?? "cam1");
    const bytes = Number(req.body?.bytes);
    if (!NAME.test(name)) fail(400, "bad_name");
    if (!CAMERA.test(camera)) fail(400, "bad_camera");
    if (!Number.isInteger(bytes) || bytes <= 0 || bytes > MAX_BYTES) fail(400, "bad_bytes");
    // Пауза з адмінки (points.video_upload_paused_at, 17.10.2026). Саме 423, а
    // не 400: на 400 малина відкладає сегмент у rejected/ як битий, а на
    // будь-що інше лишає його в черзі й перепитує пізніше (uploader.c).
    const paused = await one("select video_upload_paused_at from points where id = $1", [point]);
    if (paused?.video_upload_paused_at) fail(423, "upload_paused");
    const key = keyFor(point, camera, name, startedAt(req.body?.started_at));
    const { url } = presign({ method: "PUT", purpose: "video", key, contentType: typeOf(name), expiresIn: 3600 });
    return { key, url };
  });

  // Реєстрація залитого сегмента. Віримо не малині, а R2: об'єкт має бути
  // там і мати той самий розмір — інакше локальну копію стирати не можна.
  app.post("/points/:id/video/segment", async (req) => {
    const point = pointOrFail(req);
    const key = String(req.body?.key ?? "");
    const camera = String(req.body?.camera ?? "cam1");
    const bytes = Number(req.body?.bytes);
    const at = startedAt(req.body?.started_at);
    if (!key.startsWith(`${point}/`) || !NAME.test(key.split("/").pop())) fail(400, "bad_key");
    if (!CAMERA.test(camera)) fail(400, "bad_camera");

    const { url } = presign({ method: "HEAD", purpose: "video", key, expiresIn: 120 });
    const head = await fetch(url, { method: "HEAD" }).catch(() => null);
    if (!head?.ok) fail(409, "not_uploaded");
    const stored = Number(head.headers.get("content-length"));
    if (Number.isInteger(bytes) && stored !== bytes) fail(409, "size_mismatch", { stored });

    await query(
      `insert into video_segments (point_id, camera_id, r2_key, started_at, bytes)
       values ($1, $2, $3, $4, $5)
       on conflict (r2_key) do update set bytes = excluded.bytes`,
      [point, camera, key, at, stored]
    );
    return { ok: true };
  });

  // Адмінка: посилання на сегмент — завантажити або дивитись у плеєрі.
  // Відео йде браузеру прямо з R2: api лише підписує посилання й через себе
  // жодного байта не пропускає. Перегляд — без attachment і на годину, бо
  // плеєр докачує файл шматками (Range), поки його перемотують.
  const segmentUrl = (play) => async (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    const seg = await one("select r2_key, point_id, started_at from video_segments where id = $1", [req.params.id]);
    if (!seg) fail(404, "no_such_segment");
    const filename = play ? null : `${seg.point_id}-${seg.r2_key.split("/").pop()}`;
    const { url } = presign({ method: "GET", purpose: "video", key: seg.r2_key, expiresIn: play ? 3600 : 600, filename });
    return { url };
  };
  app.get("/admin/video/segments/:id/download", segmentUrl(false));
  app.get("/admin/video/segments/:id/play", segmentUrl(true));

  // Доказ події (кадр, а з EVIDENCE_CLIPS=1 ще й кліп) з приватного бакета
  // extrovert-evidence. Ключ беремо з самої події, а не з запиту: інакше
  // адмінка могла б підписати будь-який обʼєкт бакета.
  app.get("/admin/video/events/:id/evidence/:name", async (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    const ev = await one("select point_id, evidence from video_events where id = $1", [req.params.id]);
    const key = ev?.evidence?.[req.params.name];
    if (typeof key !== "string") fail(404, "no_such_evidence");
    const download = req.query.download === "1";
    const filename = download ? `${ev.point_id}-${req.params.id}-${key.split("/").pop()}` : null;
    const { url } = presign({ method: "GET", purpose: "evidence", key, expiresIn: 600, filename });
    return { url };
  });

  // Скільки сегментів за останню добу — щоб адмінка бачила дірки в архіві.
  app.get("/admin/video/coverage", async (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    return {
      hours: await many(
        `select date_trunc('hour', started_at) as hour, point_id, count(*)::int as segments, sum(bytes)::bigint as bytes
           from video_segments where started_at > now() - interval '24 hours'
          group by 1, 2 order by 1`
      ),
    };
  });
}
