import { addDays } from "./time";

// Ringkasan kecukupan per minggu (Senin–Minggu) dan per bulan, untuk melihat progres.

export interface DayPoint {
  date: string;
  /** Jumlah catatan minum hari itu; 0 = tidak ada catatan (tidak ikut dirata-rata). */
  count: number;
  energyPct: number | null;
  proteinPct: number | null;
  fluidPct: number | null;
  energyKcal: number;
  proteinG: number;
}

export interface PeriodSummary {
  key: string;
  label: string;
  start: string;
  end: string;
  /** Periode yang sedang berjalan (belum selesai). */
  partial: boolean;
  daysInPeriod: number;
  daysLogged: number;
  avgEnergyPct: number | null;
  avgProteinPct: number | null;
  avgFluidPct: number | null;
  avgEnergyKcal: number | null;
  avgProteinG: number | null;
  /** Hari dengan energi/protein ≥90% target. */
  daysEnergyMet: number;
  daysProteinMet: number;
}

export const MET_THRESHOLD = 90;

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];

function dayOfWeek(date: string): number {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

/** Senin pada minggu tanggal tersebut. */
export function weekStart(date: string): string {
  const dow = dayOfWeek(date);
  return addDays(date, dow === 0 ? -6 : 1 - dow);
}

function monthEnd(monthStart: string): string {
  const [y, m] = monthStart.split("-").map(Number);
  const next = m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, "0")}-01`;
  return addDays(next, -1);
}

function shortDate(date: string): { d: number; m: string } {
  const [, m, d] = date.split("-").map(Number);
  return { d, m: MONTHS[m - 1] };
}

function weekLabel(start: string, end: string): string {
  const a = shortDate(start);
  const b = shortDate(end);
  return a.m === b.m ? `${a.d}–${b.d} ${b.m}` : `${a.d} ${a.m}–${b.d} ${b.m}`;
}

const avg = (xs: number[]) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : null);

export function summarizePeriods(days: DayPoint[], period: "week" | "month", today: string): PeriodSummary[] {
  const groups = new Map<string, DayPoint[]>();
  for (const day of days) {
    if (day.date > today) continue;
    const key = period === "week" ? weekStart(day.date) : `${day.date.slice(0, 7)}-01`;
    const list = groups.get(key) ?? [];
    list.push(day);
    groups.set(key, list);
  }

  return [...groups.entries()]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([start, list]) => {
      const end = period === "week" ? addDays(start, 6) : monthEnd(start);
      const logged = list.filter((d) => d.count > 0);
      const pcts = (k: "energyPct" | "proteinPct" | "fluidPct") =>
        logged.map((d) => d[k]).filter((v): v is number => v !== null);
      const [, m, dd] = start.split("-");
      return {
        key: start,
        label: period === "week" ? weekLabel(start, end) : `${MONTHS[Number(m) - 1]} ${start.slice(0, 4)}`,
        start,
        end,
        partial: end >= today,
        daysInPeriod:
          period === "week" ? 7 : Number(monthEnd(start).slice(8)) - Number(dd) + 1,
        daysLogged: logged.length,
        avgEnergyPct: avg(pcts("energyPct")),
        avgProteinPct: avg(pcts("proteinPct")),
        avgFluidPct: avg(pcts("fluidPct")),
        avgEnergyKcal: avg(logged.map((d) => d.energyKcal)),
        avgProteinG: avg(logged.map((d) => d.proteinG)),
        daysEnergyMet: logged.filter((d) => (d.energyPct ?? 0) >= MET_THRESHOLD).length,
        daysProteinMet: logged.filter((d) => (d.proteinPct ?? 0) >= MET_THRESHOLD).length,
      };
    });
}
