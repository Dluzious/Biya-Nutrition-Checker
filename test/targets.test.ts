import { describe, expect, it } from "vitest";
import { computeTargets, idealWeightKg } from "../src/shared/targets";
import { DEFAULT_PROFILE, type PatientProfile, type WeightEntry } from "../src/shared/types";

const profile = (over: Partial<PatientProfile> = {}, cond: Partial<PatientProfile["conditions"]> = {}): PatientProfile => ({
  ...DEFAULT_PROFILE,
  age: 40,
  heightCm: 158,
  ...over,
  conditions: { ...DEFAULT_PROFILE.conditions, ...cond },
});
const w = (date: string, kg: number): WeightEntry => ({ id: date, date, kg, note: "" });

describe("computeTargets", () => {
  it("menghitung energi, protein, cairan sesuai ESPEN untuk BB aktual", () => {
    const t = computeTargets({ profile: profile(), weights: [w("2026-10-18", 45)], labs: [], today: "2026-10-19" });
    expect(t.bmi).toBe(18);
    expect(t.bmiCategory).toBe("Kurus ringan");
    // aktivitas terbatas: 28 kkal/kg × 45 = 1260
    expect(t.energy).toMatchObject({ target: 1260, min: 1130, max: 1350, source: "rumus" });
    // 1,2 g/kg × 45 = 54
    expect(t.protein).toMatchObject({ target: 54, min: 45, max: 68 });
    // usia 40: 35 ml/kg × 45 = 1575 → 1580
    expect(t.fluid?.target).toBe(1580);
    expect(t.micros.iron_mg).toBe(18);
  });

  it("memakai target dokter bila diisi", () => {
    const t = computeTargets({
      profile: profile({ doctorTargets: { energyKcal: 1500, proteinG: 70, fluidMl: 1800, note: "" } }),
      weights: [w("2026-10-18", 45)],
      labs: [],
      today: "2026-10-19",
    });
    expect(t.energy).toMatchObject({ target: 1500, source: "dokter" });
    expect(t.protein).toMatchObject({ target: 70, source: "dokter" });
    expect(t.fluid).toMatchObject({ target: 1800, source: "dokter" });
  });

  it("menerapkan batasan cairan dari dokter", () => {
    const t = computeTargets({
      profile: profile({}, { fluidRestrictionMl: 1200 }),
      weights: [w("2026-10-18", 45)],
      labs: [],
      today: "2026-10-19",
    });
    expect(t.fluid).toMatchObject({ target: 1200, source: "batasan" });
  });

  it("menaikkan energi bertahap bila risiko refeeding tinggi (NICE)", () => {
    const p = profile({}, { lowIntakeDays: 12, nutritionStartDate: "2026-10-19" });
    const day1 = computeTargets({ profile: p, weights: [w("2026-10-18", 45)], labs: [], today: "2026-10-19" });
    expect(day1.refeeding.level).toBe("tinggi");
    expect(day1.energy?.target).toBe(450); // 10 kkal/kg
    const day3 = computeTargets({ profile: p, weights: [w("2026-10-18", 45)], labs: [], today: "2026-10-21" });
    expect(day3.energy?.target).toBe(860); // 450 + (1260-450)*2/4 = 855 → 860
    const day5 = computeTargets({ profile: p, weights: [w("2026-10-18", 45)], labs: [], today: "2026-10-23" });
    expect(day5.energy?.target).toBe(1260);
    expect(day5.refeeding.rampActive).toBe(false);
  });

  it("membatasi 50% pada 2 hari pertama bila asupan sedikit >5 hari", () => {
    const p = profile({}, { lowIntakeDays: 7, nutritionStartDate: "2026-10-19" });
    const t = computeTargets({ profile: p, weights: [w("2026-10-18", 50)], labs: [], today: "2026-10-20" });
    expect(t.refeeding.level).toBe("sedang");
    expect(t.energy?.target).toBe(700); // 50% × 1400
  });

  it("mendeteksi risiko refeeding dari elektrolit rendah", () => {
    const t = computeTargets({
      profile: profile(),
      weights: [w("2026-10-18", 50)],
      labs: [{ id: "l", date: "2026-10-17", values: { fosfat: 2.1 }, note: "" }],
      today: "2026-10-19",
    });
    expect(t.refeeding.level).toBe("tinggi");
    expect(t.refeeding.reasons[0]).toContain("fosfat");
  });

  it("menghitung penurunan BB dan kaheksia", () => {
    const t = computeTargets({
      profile: profile(),
      weights: [w("2026-04-20", 52), w("2026-07-20", 49), w("2026-10-18", 45)],
      labs: [],
      today: "2026-10-19",
    });
    expect(t.weightLoss.pct6m).toBe(13.5);
    expect(t.weightLoss.pct3m).toBe(8.2);
    expect(t.cachexia).toBe(true);
  });

  it("memakai BB terkoreksi bila IMT ≥30", () => {
    const t = computeTargets({ profile: profile(), weights: [w("2026-10-18", 80)], labs: [], today: "2026-10-19" });
    const ibw = idealWeightKg(158); // 52,2
    expect(t.dosingWeightKg).toBeCloseTo(ibw + 0.25 * (80 - ibw), 1);
    expect(t.dosingWeightBasis).toContain("terkoreksi");
  });

  it("memberi peringatan bila BB belum ada", () => {
    const t = computeTargets({ profile: profile(), weights: [], labs: [], today: "2026-10-19" });
    expect(t.energy).toBeNull();
    expect(t.warnings.join(" ")).toContain("Berat badan belum diisi");
  });
});
