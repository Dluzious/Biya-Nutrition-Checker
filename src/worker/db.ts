import { DEFAULT_PROFILE } from "../shared/types";
import type {
  Evaluation,
  Intake,
  LabEntry,
  Member,
  PatientProfile,
  Product,
  PushPrefs,
  ScheduleItem,
  SymptomEntry,
  WeightEntry,
} from "../shared/types";
import { generateVapidKeys, type VapidKeys } from "./webpush";

export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
  ANTHROPIC_API_KEY?: string;
  FAMILY_PASSWORD?: string;
  ANTHROPIC_MODEL?: string;
  /** Opsional: alamat API lain (proxy/gateway). */
  ANTHROPIC_BASE_URL?: string;
}

type Row = Record<string, unknown>;

const json = <T>(v: unknown, fallback: T): T => {
  if (typeof v !== "string") return fallback;
  try {
    return JSON.parse(v) as T;
  } catch {
    return fallback;
  }
};

export const newId = () => crypto.randomUUID();

export async function getSetting<T>(db: D1Database, key: string): Promise<T | null> {
  const row = await db.prepare("SELECT value FROM settings WHERE key = ?").bind(key).first<Row>();
  return row ? json<T | null>(row.value, null) : null;
}

export async function setSetting(db: D1Database, key: string, value: unknown, by: string | null) {
  await db
    .prepare(
      `INSERT INTO settings (key, value, updated_at, updated_by) VALUES (?, ?, strftime('%Y-%m-%dT%H:%M:%fZ','now'), ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at, updated_by = excluded.updated_by`,
    )
    .bind(key, JSON.stringify(value), by)
    .run();
}

/** Mengambil nilai setting, atau membuatnya sekali (aman bila dua request bersamaan). */
async function getOrCreateSetting<T>(db: D1Database, key: string, create: () => Promise<T>): Promise<T> {
  const existing = await getSetting<T>(db, key);
  if (existing) return existing;
  const value = await create();
  await db
    .prepare("INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)")
    .bind(key, JSON.stringify(value))
    .run();
  return (await getSetting<T>(db, key))!;
}

export function getVapidKeys(db: D1Database): Promise<VapidKeys> {
  return getOrCreateSetting(db, "vapid", generateVapidKeys);
}

export function getSessionSecret(db: D1Database): Promise<string> {
  return getOrCreateSetting(db, "session_secret", async () => {
    const bytes = crypto.getRandomValues(new Uint8Array(32));
    return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
  });
}

function mergeProfile(stored: Partial<PatientProfile> | null): PatientProfile {
  const s = stored ?? {};
  return {
    ...DEFAULT_PROFILE,
    ...s,
    conditions: { ...DEFAULT_PROFILE.conditions, ...(s.conditions ?? {}) },
    doctorTargets: { ...DEFAULT_PROFILE.doctorTargets, ...(s.doctorTargets ?? {}) },
    factorOverrides: { ...DEFAULT_PROFILE.factorOverrides, ...(s.factorOverrides ?? {}) },
  };
}

export async function getProfile(db: D1Database): Promise<PatientProfile> {
  return mergeProfile(await getSetting<Partial<PatientProfile>>(db, "profile"));
}

export async function getProfileMeta(db: D1Database) {
  return db
    .prepare(
      `SELECT s.updated_at AS updatedAt, m.name AS updatedByName FROM settings s
       LEFT JOIN members m ON m.id = s.updated_by WHERE s.key = 'profile'`,
    )
    .first<{ updatedAt: string; updatedByName: string | null }>();
}

export async function listMembers(db: D1Database): Promise<Member[]> {
  const { results } = await db.prepare("SELECT id, name, role FROM members ORDER BY created_at").all<Row>();
  return results.map((r) => ({ id: String(r.id), name: String(r.name), role: r.role as Member["role"] }));
}

export function productFromRow(r: Row): Product {
  return {
    id: String(r.id),
    name: String(r.name),
    brand: String(r.brand ?? ""),
    form: r.form as Product["form"],
    servingLabel: String(r.serving_label ?? ""),
    servingVolumeMl: (r.serving_volume_ml as number | null) ?? null,
    servingGrams: (r.serving_grams as number | null) ?? null,
    preparation: String(r.preparation ?? ""),
    nutrients: json(r.nutrients, {}),
    notes: String(r.notes ?? ""),
    source: r.source as Product["source"],
    active: Boolean(r.active),
    updatedAt: String(r.updated_at),
  };
}

export async function listProducts(db: D1Database): Promise<Product[]> {
  const { results } = await db.prepare("SELECT * FROM products ORDER BY active DESC, name").all<Row>();
  return results.map(productFromRow);
}

export async function getProduct(db: D1Database, id: string): Promise<Product | null> {
  const row = await db.prepare("SELECT * FROM products WHERE id = ?").bind(id).first<Row>();
  return row ? productFromRow(row) : null;
}

export function intakeFromRow(r: Row): Intake {
  return {
    id: String(r.id),
    takenAt: String(r.taken_at),
    localDate: String(r.local_date),
    productId: (r.product_id as string | null) ?? null,
    productName: String(r.product_name),
    amount: Number(r.amount),
    unit: r.unit as Intake["unit"],
    volumeMl: Number(r.volume_ml),
    nutrients: json(r.nutrients, {}),
    note: String(r.note ?? ""),
    loggedBy: String(r.logged_by),
    loggedByName: (r.logged_by_name as string | undefined) ?? undefined,
  };
}

export async function listIntakes(db: D1Database, fromDate: string, toDate: string): Promise<Intake[]> {
  const { results } = await db
    .prepare(
      `SELECT i.*, m.name AS logged_by_name FROM intakes i LEFT JOIN members m ON m.id = i.logged_by
       WHERE i.local_date BETWEEN ? AND ? ORDER BY i.taken_at`,
    )
    .bind(fromDate, toDate)
    .all<Row>();
  return results.map(intakeFromRow);
}

export function symptomFromRow(r: Row): SymptomEntry {
  return {
    id: String(r.id),
    at: String(r.at),
    localDate: String(r.local_date),
    nausea: Number(r.nausea),
    vomiting: Number(r.vomiting),
    bloating: Number(r.bloating),
    diarrhea: Number(r.diarrhea),
    pain: Number(r.pain),
    redFlags: json(r.red_flags, []),
    note: String(r.note ?? ""),
    loggedBy: String(r.logged_by),
    loggedByName: (r.logged_by_name as string | undefined) ?? undefined,
  };
}

export async function listSymptoms(db: D1Database, fromDate: string, toDate: string): Promise<SymptomEntry[]> {
  const { results } = await db
    .prepare(
      `SELECT s.*, m.name AS logged_by_name FROM symptoms s LEFT JOIN members m ON m.id = s.logged_by
       WHERE s.local_date BETWEEN ? AND ? ORDER BY s.at`,
    )
    .bind(fromDate, toDate)
    .all<Row>();
  return results.map(symptomFromRow);
}

export async function listWeights(db: D1Database): Promise<WeightEntry[]> {
  const { results } = await db.prepare("SELECT * FROM weights ORDER BY date, created_at").all<Row>();
  return results.map((r) => ({
    id: String(r.id),
    date: String(r.date),
    kg: Number(r.kg),
    note: String(r.note ?? ""),
  }));
}

export async function listLabs(db: D1Database): Promise<LabEntry[]> {
  const { results } = await db.prepare('SELECT * FROM labs ORDER BY date DESC, created_at DESC').all<Row>();
  return results.map((r) => ({
    id: String(r.id),
    date: String(r.date),
    values: json(r.values, {}),
    note: String(r.note ?? ""),
  }));
}

export function scheduleFromRow(r: Row): ScheduleItem {
  return {
    id: String(r.id),
    time: String(r.time),
    label: String(r.label ?? ""),
    productId: (r.product_id as string | null) ?? null,
    plannedMl: (r.planned_ml as number | null) ?? null,
    enabled: Boolean(r.enabled),
  };
}

export async function listSchedule(db: D1Database): Promise<ScheduleItem[]> {
  const { results } = await db.prepare("SELECT * FROM schedule ORDER BY time").all<Row>();
  return results.map(scheduleFromRow);
}

export async function listEvaluations(db: D1Database, limit: number, localDate?: string): Promise<Evaluation[]> {
  const stmt = localDate
    ? db
        .prepare(
          `SELECT e.*, m.name AS created_by_name FROM evaluations e LEFT JOIN members m ON m.id = e.created_by
           WHERE e.local_date = ? ORDER BY e.created_at DESC LIMIT ?`,
        )
        .bind(localDate, limit)
    : db
        .prepare(
          `SELECT e.*, m.name AS created_by_name FROM evaluations e LEFT JOIN members m ON m.id = e.created_by
           ORDER BY e.created_at DESC LIMIT ?`,
        )
        .bind(limit);
  const { results } = await stmt.all<Row>();
  return results.map((r) => ({
    id: String(r.id),
    createdAt: String(r.created_at),
    localDate: String(r.local_date),
    kind: r.kind as Evaluation["kind"],
    output: json(r.output, {} as Evaluation["output"]),
    model: String(r.model),
    createdBy: String(r.created_by),
    createdByName: (r.created_by_name as string | undefined) ?? undefined,
  }));
}

export const DEFAULT_PREFS: Record<Member["role"], PushPrefs> = {
  pasien: { reminders: true, missed: false, alerts: true, activity: false },
  pendamping: { reminders: true, missed: true, alerts: true, activity: true },
};

export interface SubscriptionRow {
  id: string;
  memberId: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  prefs: PushPrefs;
  device: string;
}

export async function listSubscriptions(db: D1Database): Promise<SubscriptionRow[]> {
  const { results } = await db.prepare("SELECT * FROM push_subscriptions").all<Row>();
  return results.map((r) => ({
    id: String(r.id),
    memberId: String(r.member_id),
    endpoint: String(r.endpoint),
    p256dh: String(r.p256dh),
    auth: String(r.auth),
    prefs: json(r.prefs, DEFAULT_PREFS.pendamping),
    device: String(r.device ?? ""),
  }));
}
