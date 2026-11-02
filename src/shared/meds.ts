import { addDays, daysBetween, timeToMinutes } from "./time";
import type { MedLog, Medication } from "./types";

/** Hari sebelum jadwal obat berkala saat pengingat dikirim (H-7, H-2, dan hari H). */
export const PERIODIC_REMINDER_DAYS = [7, 2, 0] as const;
/** Jam pengingat obat berkala (waktu lokal). */
export const PERIODIC_REMINDER_MINUTES = 8 * 60;

export type SlotState = "diminum" | "dilewati" | "terlewat" | "sekarang" | "nanti";

export interface DoseSlot {
  med: Medication;
  time: string;
  log: MedLog | undefined;
  state: SlotState;
}

/** Jendela "sekarang": dari jam jadwal sampai 60 menit sesudahnya. */
const DUE_WINDOW = 60;

/**
 * Daftar dosis obat harian pada satu tanggal, urut jam. `nowMinutes` = menit
 * sekarang bila tanggal itu hari ini, 24*60 untuk hari lampau, -1 untuk masa depan.
 */
export function dailySlots(meds: Medication[], logs: MedLog[], date: string, nowMinutes: number): DoseSlot[] {
  const slots: DoseSlot[] = [];
  for (const med of meds) {
    if (!med.active || med.kind !== "harian" || date < med.startDate) continue;
    for (const time of med.times) {
      const log = logs.find((l) => l.medicationId === med.id && l.scheduledDate === date && l.scheduledTime === time);
      const t = timeToMinutes(time);
      let state: SlotState;
      if (log) state = log.status;
      else if (nowMinutes >= t + DUE_WINDOW) state = "terlewat";
      else if (nowMinutes >= t) state = "sekarang";
      else state = "nanti";
      slots.push({ med, time, log, state });
    }
  }
  return slots.sort((a, b) => timeToMinutes(a.time) - timeToMinutes(b.time) || a.med.name.localeCompare(b.med.name));
}

export interface Adherence {
  /** Dosis yang jadwalnya sudah lewat dalam rentang. */
  due: number;
  taken: number;
  skipped: number;
  missed: number;
  pct: number | null;
}

/** Kepatuhan obat harian dari `from` sampai `to` (inklusif); dosis yang belum waktunya tidak dihitung. */
export function adherence(
  meds: Medication[],
  logs: MedLog[],
  from: string,
  to: string,
  today: string,
  nowMinutes: number,
): Adherence {
  let due = 0;
  let taken = 0;
  let skipped = 0;
  for (let d = from; d <= to && d <= today; d = addDays(d, 1)) {
    const now = d === today ? nowMinutes : 24 * 60;
    for (const s of dailySlots(meds, logs, d, now)) {
      if (s.state === "nanti" || s.state === "sekarang") continue;
      due++;
      if (s.state === "diminum") taken++;
      else if (s.state === "dilewati") skipped++;
    }
  }
  return { due, taken, skipped, missed: due - taken - skipped, pct: due ? Math.round((taken / due) * 100) : null };
}

export function daysUntil(today: string, date: string): number {
  return daysBetween(today, date);
}

/** Tanggal jadwal berkala berikutnya setelah dilakukan pada `doneDate`. */
export function nextPeriodicDate(doneDate: string, intervalDays: number | null): string | null {
  return intervalDays ? addDays(doneDate, intervalDays) : null;
}

/** Teks pengingat obat berkala, atau null bila hari ini bukan hari pengingat. */
export function periodicReminderLabel(days: number): string | null {
  if (days === 7) return "1 minggu lagi";
  if (days === 2) return "2 hari lagi";
  if (days === 0) return "Hari ini";
  return null;
}
