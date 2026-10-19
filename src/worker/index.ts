import { z } from "zod";
import { intakeFromProduct, sumIntakes } from "../shared/intake";
import { NUTRIENT_KEYS, formatNutrient, type NutrientMap } from "../shared/nutrients";
import { addDays, isValidTimeZone, localParts } from "../shared/time";
import { LAB_FIELDS, RED_FLAGS, type Member } from "../shared/types";
import { AiError, estimateDrink, evaluateIntake, modelFor, readLabel, suggestIntake } from "./ai";
import { checkPassword, clearLoginFailures, issueToken, loginBlocked, recordLoginFailure, verifyToken } from "./auth";
import { buildAiContext } from "./context";
import {
  DEFAULT_PREFS,
  getProduct,
  getProfile,
  getProfileMeta,
  getSetting,
  getVapidKeys,
  listEvaluations,
  listIntakes,
  listLabs,
  listMembers,
  listProducts,
  listSchedule,
  listSubscriptions,
  listSymptoms,
  listWeights,
  newId,
  setSetting,
  type Env,
} from "./db";
import { notify, runScheduledChecks, sendToSubscriptions } from "./notify";

class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

const jsonResponse = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });

async function body<T>(req: Request, schema: z.ZodType<T>): Promise<T> {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    throw new HttpError(400, "Body harus JSON.");
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new HttpError(400, `Data tidak valid: ${issue.path.join(".") || "body"} — ${issue.message}`);
  }
  return parsed.data;
}

// ---------------------------------------------------------------------------
// Skema validasi

const num = z.number().finite();
const posNum = num.positive();
const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const timeStr = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
const text = (max: number) => z.string().max(max);

const nutrientMapSchema = z
  .record(z.string(), num.nonnegative())
  .transform((m) => {
    const out: NutrientMap = {};
    for (const key of NUTRIENT_KEYS) if (m[key] !== undefined) out[key] = m[key];
    return out;
  });

const profileSchema = z.object({
  name: text(80),
  diagnosis: text(300),
  dietOrder: text(300),
  age: z.number().int().min(1).max(120).nullable(),
  heightCm: num.min(80).max(230).nullable(),
  usualWeightKg: num.min(20).max(250).nullable(),
  activity: z.enum(["baring", "terbatas", "aktif"]),
  conditions: z.object({
    kidney: z.enum(["normal", "ckd", "dialisis"]),
    diabetes: z.boolean(),
    fluidRestrictionMl: num.min(300).max(6000).nullable(),
    refeeding: z.enum(["auto", "rendah", "sedang", "tinggi", "sangat_tinggi"]),
    lowIntakeDays: z.number().int().min(0).max(365).nullable(),
    nutritionStartDate: dateStr.nullable(),
    riskMedication: z.boolean(),
    therapy: text(500),
    notes: text(1000),
  }),
  doctorTargets: z.object({
    energyKcal: num.min(200).max(5000).nullable(),
    proteinG: num.min(5).max(300).nullable(),
    fluidMl: num.min(300).max(6000).nullable(),
    note: text(500),
  }),
  factorOverrides: z.object({
    kcalPerKg: num.min(5).max(50).nullable(),
    proteinPerKg: num.min(0.3).max(3).nullable(),
  }),
  maxVolumePerSittingMl: num.min(20).max(1000).nullable(),
  timezone: z.string().refine(isValidTimeZone, "zona waktu tidak dikenal"),
  missedAlertMinutes: z.number().int().min(10).max(240),
});

const productSchema = z.object({
  name: text(120).min(1),
  brand: text(80),
  form: z.enum(["cair", "bubuk", "lainnya"]),
  servingLabel: text(160),
  servingVolumeMl: posNum.max(2000).nullable(),
  servingGrams: posNum.max(1000).nullable(),
  preparation: text(600),
  nutrients: nutrientMapSchema,
  notes: text(1500),
  source: z.enum(["manual", "ai", "estimasi"]),
  active: z.boolean(),
});

const intakeSchema = z.union([
  z.object({
    productId: z.string().min(1),
    amount: posNum.max(5000),
    unit: z.enum(["ml", "porsi"]),
    takenAt: z.string().datetime().optional(),
    note: text(300).default(""),
  }),
  z.object({
    productId: z.null(),
    productName: text(120).min(1),
    volumeMl: posNum.max(5000),
    /** Kandungan untuk volume ini (mis. hasil perkiraan AI); kosong = cairan saja. */
    nutrients: nutrientMapSchema.optional(),
    takenAt: z.string().datetime().optional(),
    note: text(300).default(""),
  }),
]);

const level = z.number().int().min(0).max(3);
const symptomSchema = z.object({
  nausea: level,
  vomiting: level,
  bloating: level,
  diarrhea: level,
  pain: level,
  redFlags: z.array(z.enum(RED_FLAGS.map((f) => f.key) as [string, ...string[]])).max(RED_FLAGS.length),
  note: text(500).default(""),
  at: z.string().datetime().optional(),
});

const labSchema = z.object({
  date: dateStr,
  values: z.partialRecord(z.enum(LAB_FIELDS.map((f) => f.key) as [string, ...string[]]), num),
  note: text(300).default(""),
});

const scheduleSchema = z.object({
  time: timeStr,
  label: text(80),
  productId: z.string().nullable(),
  plannedMl: posNum.max(2000).nullable(),
  enabled: z.boolean(),
});

const prefsSchema = z.object({
  reminders: z.boolean(),
  missed: z.boolean(),
  alerts: z.boolean(),
  activity: z.boolean(),
});

const imageSchema = z.object({
  mediaType: z.enum(["image/jpeg", "image/png", "image/webp"]),
  data: z.string().min(100).max(7_000_000),
});

// ---------------------------------------------------------------------------
// Router sederhana

type Ctx = { env: Env; req: Request; url: URL; params: Record<string, string>; me: Member };
type Handler = (c: Ctx) => Promise<Response>;
const routes: { method: string; pattern: RegExp; keys: string[]; handler: Handler }[] = [];

function route(method: string, path: string, handler: Handler) {
  const keys: string[] = [];
  const pattern = new RegExp(
    `^${path.replace(/:(\w+)/g, (_, k) => {
      keys.push(k);
      return "([^/]+)";
    })}$`,
  );
  routes.push({ method, pattern, keys, handler });
}

async function today(env: Env) {
  const profile = await getProfile(env.DB);
  return { profile, local: localParts(new Date(), profile.timezone) };
}

route("GET", "/api/me", async ({ me }) => jsonResponse({ me }));

route("PUT", "/api/me", async ({ env, req, me }) => {
  const data = await body(req, z.object({ name: text(40).min(1), role: z.enum(["pasien", "pendamping"]) }));
  try {
    await env.DB.prepare("UPDATE members SET name = ?, role = ? WHERE id = ?").bind(data.name.trim(), data.role, me.id).run();
  } catch {
    throw new HttpError(409, "Nama itu sudah dipakai anggota lain.");
  }
  return jsonResponse({ me: { ...me, ...data } });
});

route("GET", "/api/bootstrap", async ({ env, me }) => {
  const [profile, profileMeta, members, products, schedule, weights, labs, vapid, cronHeartbeat] = await Promise.all([
    getProfile(env.DB),
    getProfileMeta(env.DB),
    listMembers(env.DB),
    listProducts(env.DB),
    listSchedule(env.DB),
    listWeights(env.DB),
    listLabs(env.DB),
    getVapidKeys(env.DB),
    getSetting<string>(env.DB, "cron_heartbeat"),
  ]);
  return jsonResponse({
    me,
    members,
    profile,
    profileMeta,
    products,
    schedule,
    weights,
    labs,
    vapidPublicKey: vapid.publicKey,
    ai: { ready: Boolean(env.ANTHROPIC_API_KEY), model: modelFor(env) },
    cronHeartbeat,
    serverTime: new Date().toISOString(),
  });
});

route("PUT", "/api/profile", async ({ env, req, me }) => {
  const profile = await body(req, profileSchema);
  await setSetting(env.DB, "profile", profile, me.id);
  return jsonResponse({ profile });
});

// Produk
route("POST", "/api/products", async ({ env, req }) => {
  const p = await body(req, productSchema);
  const id = newId();
  await env.DB.prepare(
    `INSERT INTO products (id, name, brand, form, serving_label, serving_volume_ml, serving_grams, preparation, nutrients, notes, source, active)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(id, p.name, p.brand, p.form, p.servingLabel, p.servingVolumeMl, p.servingGrams, p.preparation, JSON.stringify(p.nutrients), p.notes, p.source, p.active ? 1 : 0)
    .run();
  return jsonResponse({ product: await getProduct(env.DB, id) }, 201);
});

route("PUT", "/api/products/:id", async ({ env, req, params }) => {
  const p = await body(req, productSchema);
  const res = await env.DB.prepare(
    `UPDATE products SET name = ?, brand = ?, form = ?, serving_label = ?, serving_volume_ml = ?, serving_grams = ?, preparation = ?,
       nutrients = ?, notes = ?, source = ?, active = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?`,
  )
    .bind(p.name, p.brand, p.form, p.servingLabel, p.servingVolumeMl, p.servingGrams, p.preparation, JSON.stringify(p.nutrients), p.notes, p.source, p.active ? 1 : 0, params.id)
    .run();
  if (!res.meta.changes) throw new HttpError(404, "Produk tidak ditemukan.");
  return jsonResponse({ product: await getProduct(env.DB, params.id) });
});

route("DELETE", "/api/products/:id", async ({ env, params }) => {
  // Riwayat minum menyimpan salinan kandungan, jadi produk aman dihapus.
  await env.DB.batch([
    env.DB.prepare("DELETE FROM products WHERE id = ?").bind(params.id),
    env.DB.prepare("UPDATE schedule SET product_id = NULL WHERE product_id = ?").bind(params.id),
  ]);
  return jsonResponse({ ok: true });
});

// Data harian
route("GET", "/api/day", async ({ env, url }) => {
  const { local } = await today(env);
  const date = url.searchParams.get("date") ?? local.date;
  if (!dateStr.safeParse(date).success) throw new HttpError(400, "Tanggal tidak valid.");
  const [intakes, symptoms, evaluations, reminders] = await Promise.all([
    listIntakes(env.DB, date, date),
    listSymptoms(env.DB, date, date),
    listEvaluations(env.DB, 10, date),
    env.DB.prepare(
      `SELECT r.id, r.due_at AS dueAt, r.message, m.name AS createdByName FROM reminders r
       LEFT JOIN members m ON m.id = r.created_by WHERE r.sent_at IS NULL ORDER BY r.due_at`,
    ).all(),
  ]);
  return jsonResponse({ date, now: local, intakes, symptoms, evaluations, reminders: reminders.results });
});

route("GET", "/api/history", async ({ env, url }) => {
  const { local } = await today(env);
  const days = Math.min(Math.max(Number(url.searchParams.get("days") ?? 14), 1), 90);
  const to = url.searchParams.get("to") ?? local.date;
  const from = addDays(to, -(days - 1));
  const [intakes, symptoms] = await Promise.all([listIntakes(env.DB, from, to), listSymptoms(env.DB, from, to)]);
  const out = [];
  for (let d = from; d <= to; d = addDays(d, 1)) {
    const totals = sumIntakes(intakes.filter((i) => i.localDate === d));
    const daySymptoms = symptoms.filter((s) => s.localDate === d);
    out.push({
      date: d,
      count: totals.count,
      volumeMl: Math.round(totals.volumeMl),
      nutrients: totals.nutrients,
      maxSymptom: daySymptoms.reduce((m, s) => Math.max(m, s.nausea, s.vomiting, s.bloating, s.diarrhea, s.pain), 0),
      redFlags: daySymptoms.some((s) => s.redFlags.length > 0),
    });
  }
  return jsonResponse({ days: out });
});

// Asupan
route("POST", "/api/intakes", async ({ env, req, me }) => {
  const data = await body(req, intakeSchema);
  const { profile } = await today(env);
  const takenAt = data.takenAt ? new Date(data.takenAt) : new Date();
  if (takenAt.getTime() > Date.now() + 5 * 60_000) throw new HttpError(400, "Waktu minum tidak boleh di masa depan.");
  const localDate = localParts(takenAt, profile.timezone).date;

  let productId: string | null = null;
  let productName: string;
  let amount: number;
  let unit: "ml" | "porsi";
  let volumeMl: number;
  let nutrients: NutrientMap;
  if (data.productId !== null) {
    const product = await getProduct(env.DB, data.productId);
    if (!product) throw new HttpError(404, "Produk tidak ditemukan.");
    try {
      ({ volumeMl, nutrients } = intakeFromProduct(product, data.amount, data.unit));
    } catch (e) {
      throw new HttpError(400, (e as Error).message);
    }
    productId = product.id;
    productName = product.name;
    amount = data.amount;
    unit = data.unit;
  } else {
    productName = data.productName;
    amount = data.volumeMl;
    unit = "ml";
    volumeMl = data.volumeMl;
    nutrients = data.nutrients ?? {};
  }

  const id = newId();
  await env.DB.prepare(
    `INSERT INTO intakes (id, taken_at, local_date, product_id, product_name, amount, unit, volume_ml, nutrients, note, logged_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(id, takenAt.toISOString(), localDate, productId, productName, amount, unit, volumeMl, JSON.stringify(nutrients), data.note, me.id)
    .run();

  const kcal = nutrients.energy_kcal ? ` (${formatNutrient("energy_kcal", nutrients.energy_kcal)})` : "";
  await notify(
    env,
    "activity",
    {
      title: `${profile.name || "Pasien"} minum ${productName}`,
      body: `${Math.round(volumeMl) || amount} ${volumeMl ? "ml" : unit}${kcal} — dicatat oleh ${me.name}.`,
      tag: "activity",
      url: "/",
    },
    { excludeMemberId: me.id },
  );
  return jsonResponse({ id }, 201);
});

route("DELETE", "/api/intakes/:id", async ({ env, params }) => {
  await env.DB.prepare("DELETE FROM intakes WHERE id = ?").bind(params.id).run();
  return jsonResponse({ ok: true });
});

// Gejala
route("POST", "/api/symptoms", async ({ env, req, me }) => {
  const data = await body(req, symptomSchema);
  const { profile } = await today(env);
  const at = data.at ? new Date(data.at) : new Date();
  const id = newId();
  await env.DB.prepare(
    `INSERT INTO symptoms (id, at, local_date, nausea, vomiting, bloating, diarrhea, pain, red_flags, note, logged_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(id, at.toISOString(), localParts(at, profile.timezone).date, data.nausea, data.vomiting, data.bloating, data.diarrhea, data.pain, JSON.stringify(data.redFlags), data.note, me.id)
    .run();
  if (data.redFlags.length) {
    const labels = data.redFlags.map((k) => RED_FLAGS.find((f) => f.key === k)?.label ?? k);
    await notify(
      env,
      "alerts",
      {
        title: `⚠️ Tanda bahaya: ${profile.name || "Pasien"}`,
        body: `${labels.join("; ")}. Segera hubungi dokter/IGD. (dicatat ${me.name})`,
        tag: "alert",
        url: "/",
      },
      { excludeMemberId: me.id },
    );
  }
  return jsonResponse({ id }, 201);
});

route("DELETE", "/api/symptoms/:id", async ({ env, params }) => {
  await env.DB.prepare("DELETE FROM symptoms WHERE id = ?").bind(params.id).run();
  return jsonResponse({ ok: true });
});

// Berat badan & lab
route("POST", "/api/weights", async ({ env, req, me }) => {
  const data = await body(req, z.object({ date: dateStr, kg: num.min(20).max(250), note: text(200).default("") }));
  const id = newId();
  await env.DB.prepare("INSERT INTO weights (id, date, kg, note, logged_by) VALUES (?, ?, ?, ?, ?)")
    .bind(id, data.date, data.kg, data.note, me.id)
    .run();
  return jsonResponse({ id }, 201);
});

route("DELETE", "/api/weights/:id", async ({ env, params }) => {
  await env.DB.prepare("DELETE FROM weights WHERE id = ?").bind(params.id).run();
  return jsonResponse({ ok: true });
});

route("POST", "/api/labs", async ({ env, req, me }) => {
  const data = await body(req, labSchema);
  const id = newId();
  await env.DB.prepare('INSERT INTO labs (id, date, "values", note, logged_by) VALUES (?, ?, ?, ?, ?)')
    .bind(id, data.date, JSON.stringify(data.values), data.note, me.id)
    .run();
  return jsonResponse({ id }, 201);
});

route("DELETE", "/api/labs/:id", async ({ env, params }) => {
  await env.DB.prepare("DELETE FROM labs WHERE id = ?").bind(params.id).run();
  return jsonResponse({ ok: true });
});

// Jadwal & pengingat
route("POST", "/api/schedule", async ({ env, req }) => {
  const s = await body(req, scheduleSchema);
  const id = newId();
  await env.DB.prepare("INSERT INTO schedule (id, time, label, product_id, planned_ml, enabled) VALUES (?, ?, ?, ?, ?, ?)")
    .bind(id, s.time, s.label, s.productId, s.plannedMl, s.enabled ? 1 : 0)
    .run();
  return jsonResponse({ id }, 201);
});

route("PUT", "/api/schedule/:id", async ({ env, req, params }) => {
  const s = await body(req, scheduleSchema);
  await env.DB.prepare("UPDATE schedule SET time = ?, label = ?, product_id = ?, planned_ml = ?, enabled = ? WHERE id = ?")
    .bind(s.time, s.label, s.productId, s.plannedMl, s.enabled ? 1 : 0, params.id)
    .run();
  return jsonResponse({ ok: true });
});

route("DELETE", "/api/schedule/:id", async ({ env, params }) => {
  await env.DB.prepare("DELETE FROM schedule WHERE id = ?").bind(params.id).run();
  return jsonResponse({ ok: true });
});

route("POST", "/api/reminders", async ({ env, req, me }) => {
  const data = await body(req, z.object({ minutes: z.number().int().min(1).max(24 * 60), message: text(200).default("") }));
  const dueAt = new Date(Date.now() + data.minutes * 60_000);
  const { profile } = await today(env);
  const message = data.message || `Waktunya minum lagi (diatur ${me.name} untuk ${localParts(dueAt, profile.timezone).time}).`;
  const id = newId();
  await env.DB.prepare("INSERT INTO reminders (id, due_at, message, created_by) VALUES (?, ?, ?, ?)")
    .bind(id, dueAt.toISOString(), message, me.id)
    .run();
  return jsonResponse({ id, dueAt: dueAt.toISOString() }, 201);
});

route("DELETE", "/api/reminders/:id", async ({ env, params }) => {
  await env.DB.prepare("DELETE FROM reminders WHERE id = ?").bind(params.id).run();
  return jsonResponse({ ok: true });
});

// Notifikasi push
route("POST", "/api/push/subscribe", async ({ env, req, url, me }) => {
  const data = await body(
    req,
    z.object({
      endpoint: z.string().url().max(1000),
      keys: z.object({ p256dh: z.string().min(20).max(200), auth: z.string().min(8).max(100) }),
      device: text(120).default(""),
      prefs: prefsSchema.optional(),
    }),
  );
  if (!data.endpoint.startsWith("https://")) throw new HttpError(400, "Endpoint push harus https.");
  const prefs = data.prefs ?? DEFAULT_PREFS[me.role];
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO push_subscriptions (id, member_id, endpoint, p256dh, auth, prefs, device) VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(endpoint) DO UPDATE SET member_id = excluded.member_id, p256dh = excluded.p256dh, auth = excluded.auth,
         prefs = excluded.prefs, device = excluded.device`,
    ).bind(newId(), me.id, data.endpoint, data.keys.p256dh, data.keys.auth, JSON.stringify(prefs), data.device),
    env.DB.prepare(
      `INSERT INTO settings (key, value) VALUES ('origin', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    ).bind(JSON.stringify(url.origin)),
  ]);
  return jsonResponse({ prefs });
});

route("PUT", "/api/push/prefs", async ({ env, req }) => {
  const data = await body(req, z.object({ endpoint: z.string().url(), prefs: prefsSchema }));
  const res = await env.DB.prepare("UPDATE push_subscriptions SET prefs = ? WHERE endpoint = ?")
    .bind(JSON.stringify(data.prefs), data.endpoint)
    .run();
  if (!res.meta.changes) throw new HttpError(404, "Perangkat ini belum terdaftar untuk notifikasi.");
  return jsonResponse({ prefs: data.prefs });
});

route("POST", "/api/push/unsubscribe", async ({ env, req }) => {
  const data = await body(req, z.object({ endpoint: z.string().url() }));
  await env.DB.prepare("DELETE FROM push_subscriptions WHERE endpoint = ?").bind(data.endpoint).run();
  return jsonResponse({ ok: true });
});

route("GET", "/api/push/devices", async ({ env }) => {
  const [subs, members] = await Promise.all([listSubscriptions(env.DB), listMembers(env.DB)]);
  return jsonResponse({
    devices: subs.map((s) => ({
      endpoint: s.endpoint,
      device: s.device,
      prefs: s.prefs,
      memberName: members.find((m) => m.id === s.memberId)?.name ?? "?",
    })),
  });
});

route("POST", "/api/push/test", async ({ env, req, me }) => {
  const data = await body(req, z.object({ endpoint: z.string().url() }));
  const subs = (await listSubscriptions(env.DB)).filter((s) => s.endpoint === data.endpoint);
  if (!subs.length) throw new HttpError(404, "Perangkat ini belum terdaftar untuk notifikasi.");
  const res = await sendToSubscriptions(env, subs, {
    title: "Notifikasi aktif ✅",
    body: `Halo ${me.name}, pengingat minum akan muncul seperti ini.`,
    tag: "test",
    url: "/",
  });
  return jsonResponse(res);
});

// AI
route("POST", "/api/ai/estimate", async ({ env, req }) => {
  const data = await body(req, z.object({ description: text(300).min(2), volumeMl: posNum.max(2000) }));
  const { profile } = await today(env);
  const estimate = await estimateDrink(env, {
    description: data.description.trim(),
    volumeMl: data.volumeMl,
    diagnosis: profile.diagnosis,
    dietOrder: profile.dietOrder,
  });
  return jsonResponse({ estimate });
});

route("POST", "/api/ai/label", async ({ env, req }) => {
  const data = await body(req, z.object({ images: z.array(imageSchema).min(1).max(4) }));
  const draft = await readLabel(env, data.images);
  return jsonResponse({ draft });
});

async function saveEvaluation(env: Env, me: Member, date: string, kind: "evaluasi" | "saran", output: unknown) {
  const id = newId();
  await env.DB.prepare("INSERT INTO evaluations (id, local_date, kind, output, model, created_by) VALUES (?, ?, ?, ?, ?, ?)")
    .bind(id, date, kind, JSON.stringify(output), modelFor(env), me.id)
    .run();
  return (await listEvaluations(env.DB, 1, date)).find((e) => e.id === id);
}

const AI_COOLDOWN_MS = 2 * 60_000;
const AI_LOCK_STALE_MS = 3 * 60_000;

/**
 * Mencegah evaluasi/saran yang sama dikirim berulang ke API: tolak bila baru
 * dibuat <2 menit lalu, atau bila sedang diproses atas permintaan HP lain.
 * Mengembalikan fungsi untuk melepas kunci setelah selesai.
 */
async function claimAiRun(env: Env, me: Member, date: string, kind: "evaluasi" | "saran") {
  const label = kind === "evaluasi" ? "Evaluasi" : "Saran AI";
  const recent = await env.DB.prepare(
    `SELECT e.created_at AS at, m.name AS name FROM evaluations e LEFT JOIN members m ON m.id = e.created_by
     WHERE e.local_date = ? AND e.kind = ? ORDER BY e.created_at DESC LIMIT 1`,
  )
    .bind(date, kind)
    .first<{ at: string; name: string | null }>();
  if (recent && Date.now() - Date.parse(recent.at) < AI_COOLDOWN_MS) {
    const sec = Math.max(1, Math.round((Date.now() - Date.parse(recent.at)) / 1000));
    throw new HttpError(409, `${label} baru saja dibuat oleh ${recent.name ?? "anggota lain"} ${sec} detik lalu. Hasilnya ada di halaman Hari Ini.`);
  }

  const key = `ai_lock:${kind}:${date}`;
  const claimed = await env.DB.prepare(
    `INSERT INTO settings (key, value, updated_at, updated_by) VALUES (?1, ?2, ?3, ?4)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at, updated_by = excluded.updated_by
     WHERE settings.updated_at < ?5`,
  )
    .bind(key, JSON.stringify(me.name), new Date().toISOString(), me.id, new Date(Date.now() - AI_LOCK_STALE_MS).toISOString())
    .run();
  if (!claimed.meta.changes) {
    const holder = await getSetting<string>(env.DB, key);
    throw new HttpError(409, `${label} sedang diproses atas permintaan ${holder ?? "anggota lain"}. Tunggu sebentar.`);
  }
  return async () => {
    await env.DB.prepare("DELETE FROM settings WHERE key = ?").bind(key).run();
  };
}

route("POST", "/api/ai/evaluate", async ({ env, req, me }) => {
  const data = await body(req, z.object({ date: dateStr }));
  const release = await claimAiRun(env, me, data.date, "evaluasi");
  try {
    const context = await buildAiContext(env, data.date);
    const output = await evaluateIntake(env, context);
    return jsonResponse({ evaluation: await saveEvaluation(env, me, data.date, "evaluasi", output) });
  } finally {
    await release();
  }
});

route("POST", "/api/ai/suggest", async ({ env, req, me }) => {
  const data = await body(req, z.object({ date: dateStr }));
  const release = await claimAiRun(env, me, data.date, "saran");
  try {
    const context = await buildAiContext(env, data.date);
    const output = await suggestIntake(env, context);
    return jsonResponse({ evaluation: await saveEvaluation(env, me, data.date, "saran", output) });
  } finally {
    await release();
  }
});

route("GET", "/api/evaluations", async ({ env, url }) => {
  const limit = Math.min(Number(url.searchParams.get("limit") ?? 20), 100);
  return jsonResponse({ evaluations: await listEvaluations(env.DB, limit) });
});

// ---------------------------------------------------------------------------

async function login(env: Env, req: Request): Promise<Response> {
  const ip = req.headers.get("CF-Connecting-IP") ?? "local";
  if (!env.FAMILY_PASSWORD) throw new HttpError(503, "Server belum diatur: secret FAMILY_PASSWORD belum diisi.");
  if (await loginBlocked(env.DB, ip)) throw new HttpError(429, "Terlalu banyak percobaan. Coba lagi 15 menit lagi.");
  const data = await body(
    req,
    z.object({ password: z.string().max(200), name: text(40).min(1), role: z.enum(["pasien", "pendamping"]) }),
  );
  if (!(await checkPassword(env, data.password))) {
    await recordLoginFailure(env.DB, ip);
    throw new HttpError(401, "Kata sandi keluarga salah.");
  }
  await clearLoginFailures(env.DB, ip);
  const name = data.name.trim();
  let member = (await listMembers(env.DB)).find((m) => m.name.toLowerCase() === name.toLowerCase());
  if (!member) {
    member = { id: newId(), name, role: data.role };
    await env.DB.prepare("INSERT INTO members (id, name, role) VALUES (?, ?, ?)").bind(member.id, member.name, member.role).run();
  }
  return jsonResponse({ token: await issueToken(env, member.id), me: member });
}

async function handleApi(req: Request, env: Env): Promise<Response> {
  const url = new URL(req.url);
  if (url.pathname === "/api/login" && req.method === "POST") return login(env, req);
  if (url.pathname === "/api/health") return jsonResponse({ ok: true });

  const auth = req.headers.get("Authorization") ?? "";
  const memberId = auth.startsWith("Bearer ") ? await verifyToken(env, auth.slice(7)) : null;
  const me = memberId ? (await listMembers(env.DB)).find((m) => m.id === memberId) : undefined;
  if (!me) throw new HttpError(401, "Silakan masuk lagi.");

  for (const r of routes) {
    if (r.method !== req.method) continue;
    const m = url.pathname.match(r.pattern);
    if (!m) continue;
    const params = Object.fromEntries(r.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])]));
    return r.handler({ env, req, url, params, me });
  }
  throw new HttpError(404, "Endpoint tidak ditemukan.");
}

export default {
  async fetch(req, env): Promise<Response> {
    const url = new URL(req.url);
    if (!url.pathname.startsWith("/api/")) return env.ASSETS.fetch(req);
    try {
      return await handleApi(req, env);
    } catch (e) {
      if (e instanceof HttpError || e instanceof AiError) {
        return jsonResponse({ error: e.message }, e.status);
      }
      console.error(e);
      return jsonResponse({ error: "Terjadi kesalahan di server." }, 500);
    }
  },

  async scheduled(_event, env, ctx): Promise<void> {
    ctx.waitUntil(runScheduledChecks(env));
  },
} satisfies ExportedHandler<Env>;
