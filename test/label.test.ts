import { describe, expect, it } from "vitest";
import { normalizeAmount } from "../src/shared/nutrients";
import { labelToDraft } from "../src/worker/ai";

describe("normalizeAmount", () => {
  it("mengonversi satuan umum", () => {
    expect(normalizeAmount("vit_d_mcg", 400, "IU")).toBe(10);
    expect(normalizeAmount("vit_a_mcg", 1000, "IU")).toBe(300);
    expect(normalizeAmount("energy_kcal", 418.4, "kJ")).toBeCloseTo(100);
    expect(normalizeAmount("sodium_mg", 0.2, "g")).toBe(200);
    expect(normalizeAmount("selenium_mcg", 0.02, "mg")).toBeCloseTo(20);
    expect(normalizeAmount("vit_b12_mcg", 1.2, "µg")).toBe(1.2);
    expect(normalizeAmount("vit_a_mcg", 300, "mcg RE")).toBe(300);
    expect(normalizeAmount("protein_g", 5, "sendok")).toBeNull();
  });
});

describe("labelToDraft", () => {
  it("memprioritaskan kolom per sajian dan mengisi dari per 100 ml bila perlu", () => {
    const d = labelToDraft({
      is_nutrition_label: true,
      product_name: "Fresubin 2 kcal",
      brand: "Fresenius Kabi",
      form: "cair",
      serving_description: "1 botol (200 ml)",
      serving_size_g: null,
      serving_volume_ml: 200,
      preparation: "",
      nutrients: [
        { key: "energy_kcal", label_text: "Energi", amount: 200, unit: "kkal", basis: "per_100ml" },
        { key: "energy_kcal", label_text: "Energi", amount: 400, unit: "kkal", basis: "per_saji" },
        { key: "protein_g", label_text: "Protein", amount: 10, unit: "g", basis: "per_100ml" },
        { key: "vit_d_mcg", label_text: "Vitamin D", amount: 2, unit: "µg", basis: "per_saji" },
        { key: "lainnya", label_text: "Lemak jenuh", amount: 1, unit: "g", basis: "per_saji" },
      ],
      notes: [],
      confidence: "tinggi",
    });
    expect(d.nutrients).toEqual({ energy_kcal: 400, protein_g: 20, vit_d_mcg: 2 });
  });

  it("memakai 100 ml sebagai takaran bila label tidak menyebut ukuran sajian", () => {
    const d = labelToDraft({
      is_nutrition_label: true,
      product_name: "X",
      brand: "",
      form: "cair",
      serving_description: "",
      serving_size_g: null,
      serving_volume_ml: null,
      preparation: "",
      nutrients: [{ key: "energy_kcal", label_text: "Energi", amount: 150, unit: "kcal", basis: "per_100ml" }],
      notes: [],
      confidence: "sedang",
    });
    expect(d.servingVolumeMl).toBe(100);
    expect(d.nutrients.energy_kcal).toBe(150);
  });
});
