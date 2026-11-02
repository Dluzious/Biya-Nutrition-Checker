import { slotDone } from "../shared/intake";
import { PERIODIC_REMINDER_DAYS, PERIODIC_REMINDER_MINUTES, daysUntil, periodicReminderLabel } from "../shared/meds";
import { localParts, timeToMinutes } from "../shared/time";
import type { PushPrefs } from "../shared/types";
import {
  getProfile,
  getSetting,
  setSetting,
  getVapidKeys,
  listIntakes,
  listProducts,
  listMedLogs,
  listMedications,
  listSchedule,
  listSubscriptions,
  type Env,
  type SubscriptionRow,
} from "./db";
import { sendPush, type PushMessage } from "./webpush";

export async function pushSubject(db: D1Database): Promise<string> {
  // Apple mewajibkan `sub` berupa URL https atau mailto; pakai alamat aplikasi.
  return (await getSetting<string>(db, "origin")) ?? "mailto:biya-nutrition@users.noreply.github.com";
}

export async function sendToSubscriptions(env: Env, subs: SubscriptionRow[], message: PushMessage) {
  if (subs.length === 0) return { sent: 0, failed: 0 };
  const [keys, subject] = await Promise.all([getVapidKeys(env.DB), pushSubject(env.DB)]);
  const results = await Promise.all(
    subs.map(async (s) => {
      try {
        const res = await sendPush(s, message, keys, subject);
        if (res.result === "gone") {
          await env.DB.prepare("DELETE FROM push_subscriptions WHERE id = ?").bind(s.id).run();
        } else if (res.result === "error") {
          console.warn("push gagal", res.status, res.detail);
        }
        return res.result === "ok";
      } catch (e) {
        console.warn("push error", e);
        return false;
      }
    }),
  );
  const sent = results.filter(Boolean).length;
  return { sent, failed: results.length - sent };
}

export async function notify(
  env: Env,
  kind: keyof PushPrefs,
  message: PushMessage,
  opts: { excludeMemberId?: string } = {},
) {
  const subs = (await listSubscriptions(env.DB)).filter(
    (s) => s.prefs[kind] && s.memberId !== opts.excludeMemberId,
  );
  return sendToSubscriptions(env, subs, message);
}

/** Menandai kunci sebagai terkirim; false bila sudah pernah (mencegah notifikasi ganda). */
async function claim(db: D1Database, key: string): Promise<boolean> {
  const res = await db.prepare("INSERT OR IGNORE INTO sent_log (key) VALUES (?)").bind(key).run();
  return (res.meta.changes ?? 0) > 0;
}

const CATCH_UP_MINUTES = 10;

/** Dijalankan cron setiap menit: pengingat jadwal, pengingat sekali, dan peringatan jadwal terlewat. */
export async function runScheduledChecks(env: Env, now = new Date()) {
  // Penanda bahwa cron berjalan; ditampilkan di menu Jadwal.
  await setSetting(env.DB, "cron_heartbeat", now.toISOString(), null);
  const profile = await getProfile(env.DB);
  const tz = profile.timezone;
  const { date, minutes } = localParts(now, tz);

  const [schedule, products, intakes] = await Promise.all([
    listSchedule(env.DB),
    listProducts(env.DB),
    listIntakes(env.DB, date, date),
  ]);
  const intakeMinutes = intakes.map((i) => localParts(new Date(i.takenAt), tz).minutes);
  const patient = profile.name || "Pasien";

  for (const slot of schedule.filter((s) => s.enabled)) {
    const t = timeToMinutes(slot.time);
    const product = products.find((p) => p.id === slot.productId);
    const what = [product?.name, slot.plannedMl ? `${slot.plannedMl} ml` : null].filter(Boolean).join(" ");

    if (minutes >= t && minutes - t <= CATCH_UP_MINUTES && !slotDone(t, intakeMinutes)) {
      if (await claim(env.DB, `rem:${slot.id}:${date}`)) {
        await notify(env, "reminders", {
          title: `Waktunya minum — ${slot.time}`,
          body: [slot.label, what].filter(Boolean).join(" · ") || "Saatnya minum susu/nutrisi sesuai jadwal.",
          tag: `rem-${slot.id}`,
          url: "/?log=1",
        });
      }
    }

    const missedAt = t + profile.missedAlertMinutes;
    if (minutes >= missedAt && minutes - missedAt <= 15 && missedAt < 24 * 60) {
      if (await claim(env.DB, `miss:${slot.id}:${date}`)) {
        const drank = intakeMinutes.some((m) => m >= t - 30 && m <= minutes);
        if (!drank) {
          await notify(env, "missed", {
            title: `Jadwal ${slot.time} belum tercatat`,
            body: `${patient} belum tercatat minum ${what || "sesuai jadwal"}. Mohon dicek.`,
            tag: `miss-${slot.id}`,
            url: "/",
          });
        }
      }
    }
  }

  await runMedicationChecks(env, profile, date, minutes);

  const { results: due } = await env.DB.prepare(
    "SELECT id, message FROM reminders WHERE sent_at IS NULL AND due_at <= ? ORDER BY due_at LIMIT 20",
  )
    .bind(now.toISOString())
    .all<{ id: string; message: string }>();
  for (const r of due) {
    const res = await env.DB.prepare("UPDATE reminders SET sent_at = ? WHERE id = ? AND sent_at IS NULL")
      .bind(now.toISOString(), r.id)
      .run();
    if ((res.meta.changes ?? 0) === 0) continue;
    await notify(env, "reminders", { title: "Pengingat minum", body: r.message, tag: `once-${r.id}`, url: "/?log=1" });
  }

  if (minutes % 60 === 0) {
    const cutoff = new Date(now.getTime() - 3 * 86_400_000).toISOString();
    await env.DB.batch([
      env.DB.prepare("DELETE FROM sent_log WHERE at < ?").bind(cutoff),
      env.DB.prepare("DELETE FROM reminders WHERE sent_at IS NOT NULL AND sent_at < ?").bind(cutoff),
    ]);
  }
}

const MED_DAY_NAMES = ["Minggu", "Senin", "Selasa", "Rabu", "Kamis", "Jumat", "Sabtu"];
const MED_MONTHS = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];

function medDateLabel(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  return `${MED_DAY_NAMES[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]}, ${d} ${MED_MONTHS[m - 1]}`;
}

/** Pengingat obat harian (di jamnya + peringatan terlewat) dan obat berkala (H-7, H-2, hari H). */
async function runMedicationChecks(
  env: Env,
  profile: Awaited<ReturnType<typeof getProfile>>,
  date: string,
  minutes: number,
) {
  const meds = (await listMedications(env.DB)).filter((m) => m.active);
  if (!meds.length) return;
  const logs = await listMedLogs(env.DB, date, date);
  const patient = profile.name || "Pasien";

  for (const med of meds) {
    const what = [med.name, med.dose].filter(Boolean).join(" ");
    if (med.kind === "harian") {
      if (date < med.startDate) continue;
      for (const time of med.times) {
        const t = timeToMinutes(time);
        const logged = logs.some((l) => l.medicationId === med.id && l.scheduledTime === time);
        if (!logged && minutes >= t && minutes - t <= CATCH_UP_MINUTES && (await claim(env.DB, `med:${med.id}:${date}:${time}`))) {
          await notify(env, "medications", {
            title: `💊 Waktunya minum obat — ${time}`,
            body: [what, med.instructions].filter(Boolean).join(" · "),
            tag: `med-${med.id}-${time}`,
            url: "/?tab=obat",
          });
        }
        const missedAt = t + profile.missedAlertMinutes;
        if (minutes >= missedAt && minutes - missedAt <= 15 && missedAt < 24 * 60) {
          if ((await claim(env.DB, `medmiss:${med.id}:${date}:${time}`)) && !logged) {
            await notify(env, "missed", {
              title: `💊 Obat ${time} belum tercatat`,
              body: `${patient} belum tercatat minum ${what}. Mohon dicek.`,
              tag: `medmiss-${med.id}-${time}`,
              url: "/?tab=obat",
            });
          }
        }
      }
    } else if (med.nextDate && minutes >= PERIODIC_REMINDER_MINUTES) {
      const days = daysUntil(date, med.nextDate);
      const label = periodicReminderLabel(days);
      if (!label || !(PERIODIC_REMINDER_DAYS as readonly number[]).includes(days)) continue;
      if (!(await claim(env.DB, `medper:${med.id}:${med.nextDate}:${days}`))) continue;
      const when = [medDateLabel(med.nextDate), med.nextTime, med.location].filter(Boolean).join(" · ");
      await notify(env, "medications", {
        title: `📅 ${label}: ${med.name}`,
        body: `Jadwal ${what} — ${when}.${days === 0 ? " Jangan lupa ya!" : " Siapkan dari sekarang."}`,
        tag: `medper-${med.id}`,
        url: "/?tab=obat",
      });
    }
  }
}
