import { describe, expect, it } from "vitest";
import { expectedFraction, intakeFromProduct, suggestNext, sumIntakes } from "../src/shared/intake";
import type { Product, ScheduleItem } from "../src/shared/types";

const fresubin: Product = {
  id: "f",
  name: "Fresubin 2 kcal",
  brand: "Fresenius",
  form: "cair",
  servingLabel: "1 botol 200 ml",
  servingVolumeMl: 200,
  servingGrams: null,
  preparation: "",
  nutrients: { energy_kcal: 400, protein_g: 20 },
  notes: "",
  source: "manual",
  active: true,
  updatedAt: "",
};
const slot = (time: string, extra: Partial<ScheduleItem> = {}): ScheduleItem => ({
  id: time,
  time,
  label: "",
  productId: null,
  plannedMl: null,
  enabled: true,
  ...extra,
});

describe("intake", () => {
  it("menghitung kandungan dari ml dan porsi", () => {
    expect(intakeFromProduct(fresubin, 150, "ml")).toEqual({
      volumeMl: 150,
      nutrients: { energy_kcal: 300, protein_g: 15 },
    });
    expect(intakeFromProduct(fresubin, 0.5, "porsi").volumeMl).toBe(100);
    expect(() => intakeFromProduct({ ...fresubin, servingVolumeMl: null }, 100, "ml")).toThrow();
  });

  it("menjumlahkan asupan", () => {
    const t = sumIntakes([
      { nutrients: { energy_kcal: 300 }, volumeMl: 150 },
      { nutrients: { energy_kcal: 400, protein_g: 20 }, volumeMl: 200 },
    ]);
    expect(t.nutrients).toEqual({ energy_kcal: 700, protein_g: 20 });
    expect(t.volumeMl).toBe(350);
  });

  it("menghitung target berjalan dari jadwal", () => {
    const s = [slot("07:00"), slot("10:00"), slot("13:00"), slot("16:00")];
    expect(expectedFraction(9 * 60, s)).toBe(0.25);
    expect(expectedFraction(16 * 60, s)).toBe(1);
  });
});

describe("suggestNext", () => {
  const targets = {
    energy: { target: 1600, min: null, max: null, source: "rumus" as const, basis: [] },
    protein: { target: 80, min: null, max: null, source: "rumus" as const, basis: [] },
    fluid: { target: 1600, min: null, max: null, source: "rumus" as const, basis: [] },
  };

  it("membagi sisa energi ke jadwal tersisa dan menghormati volume maksimal", () => {
    const s = suggestNext({
      nowMinutes: 9 * 60 + 30,
      schedule: [slot("07:00"), slot("10:00"), slot("13:00"), slot("16:00"), slot("19:00")],
      products: [fresubin],
      totals: { nutrients: { energy_kcal: 400, protein_g: 20 }, volumeMl: 200, count: 1 },
      targets,
      intakeMinutes: [7 * 60 + 5],
      maxVolumeMl: 200,
      fluidRestricted: false,
    });
    expect(s.time).toBe("10:00");
    expect(s.slotsLeft).toBe(4);
    // sisa 1200 kkal / 4 jadwal = 300 kkal = 150 ml
    expect(s.amount).toBe(150);
    expect(s.energyKcal).toBe(300);
    expect(s.notes.join(" ")).toContain("air putih");
  });

  it("menyarankan jadwal tambahan bila volume maksimal tidak cukup", () => {
    const s = suggestNext({
      nowMinutes: 18 * 60,
      schedule: [slot("19:00")],
      products: [fresubin],
      totals: { nutrients: {}, volumeMl: 0, count: 0 },
      targets,
      intakeMinutes: [],
      maxVolumeMl: 150,
      fluidRestricted: true,
    });
    expect(s.amount).toBe(150);
    expect(s.notes.join(" ")).toMatch(/perlu ±\d+ kali minum/);
  });

  it("menandai selesai bila target tercapai", () => {
    const s = suggestNext({
      nowMinutes: 20 * 60,
      schedule: [],
      products: [fresubin],
      totals: { nutrients: { energy_kcal: 1650, protein_g: 82 }, volumeMl: 1700, count: 5 },
      targets,
      intakeMinutes: [],
      maxVolumeMl: 200,
      fluidRestricted: false,
    });
    expect(s.done).toBe(true);
  });
});
