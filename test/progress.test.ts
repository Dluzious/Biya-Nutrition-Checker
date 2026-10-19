import { describe, expect, it } from "vitest";
import { summarizePeriods, weekStart, type DayPoint } from "../src/shared/progress";

const day = (date: string, count: number, energyPct: number | null, proteinPct: number | null = energyPct): DayPoint => ({
  date,
  count,
  energyPct,
  proteinPct,
  fluidPct: null,
  energyKcal: (energyPct ?? 0) * 10,
  proteinG: (proteinPct ?? 0) / 2,
});

describe("progress", () => {
  it("menentukan Senin sebagai awal minggu", () => {
    expect(weekStart("2026-10-19")).toBe("2026-10-19"); // Senin
    expect(weekStart("2026-10-25")).toBe("2026-10-19"); // Minggu
    expect(weekStart("2026-11-01")).toBe("2026-10-26"); // lintas bulan
  });

  it("merata-rata hanya hari yang ada catatannya", () => {
    const weeks = summarizePeriods(
      [day("2026-10-12", 3, 80), day("2026-10-13", 0, 0), day("2026-10-14", 4, 100), day("2026-10-19", 2, 60)],
      "week",
      "2026-10-20",
    );
    expect(weeks).toHaveLength(2);
    expect(weeks[0]).toMatchObject({ label: "12–18 Okt", daysLogged: 2, avgEnergyPct: 90, daysEnergyMet: 1, partial: false });
    expect(weeks[1]).toMatchObject({ label: "19–25 Okt", daysLogged: 1, avgEnergyPct: 60, partial: true });
  });

  it("mengelompokkan per bulan dengan label Indonesia", () => {
    const months = summarizePeriods([day("2026-09-30", 2, 70), day("2026-10-01", 2, 95)], "month", "2026-10-20");
    expect(months.map((m) => [m.label, m.daysInPeriod, m.partial])).toEqual([
      ["Sep 2026", 30, false],
      ["Okt 2026", 31, true],
    ]);
  });
});
