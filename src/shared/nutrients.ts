// Daftar zat gizi yang dilacak aplikasi. Semua angka disimpan dalam satuan
// kanonik di kolom `unit`, sehingga penjumlahan antar-produk selalu sebanding.

export const NUTRIENTS = [
  { key: "energy_kcal", label: "Energi", unit: "kkal", group: "makro" },
  { key: "protein_g", label: "Protein", unit: "g", group: "makro" },
  { key: "carb_g", label: "Karbohidrat", unit: "g", group: "makro" },
  { key: "fat_g", label: "Lemak", unit: "g", group: "makro" },
  { key: "fiber_g", label: "Serat", unit: "g", group: "makro" },
  { key: "sugar_g", label: "Gula", unit: "g", group: "makro" },
  { key: "omega3_mg", label: "Omega-3 (EPA+DHA)", unit: "mg", group: "makro" },
  { key: "vit_a_mcg", label: "Vitamin A", unit: "mcg", group: "vitamin" },
  { key: "vit_d_mcg", label: "Vitamin D", unit: "mcg", group: "vitamin" },
  { key: "vit_e_mg", label: "Vitamin E", unit: "mg", group: "vitamin" },
  { key: "vit_k_mcg", label: "Vitamin K", unit: "mcg", group: "vitamin" },
  { key: "vit_c_mg", label: "Vitamin C", unit: "mg", group: "vitamin" },
  { key: "vit_b1_mg", label: "Vitamin B1 (tiamin)", unit: "mg", group: "vitamin" },
  { key: "vit_b2_mg", label: "Vitamin B2", unit: "mg", group: "vitamin" },
  { key: "vit_b3_mg", label: "Vitamin B3 (niasin)", unit: "mg", group: "vitamin" },
  { key: "vit_b6_mg", label: "Vitamin B6", unit: "mg", group: "vitamin" },
  { key: "folate_mcg", label: "Folat", unit: "mcg", group: "vitamin" },
  { key: "vit_b12_mcg", label: "Vitamin B12", unit: "mcg", group: "vitamin" },
  { key: "calcium_mg", label: "Kalsium", unit: "mg", group: "mineral" },
  { key: "phosphorus_mg", label: "Fosfor", unit: "mg", group: "mineral" },
  { key: "magnesium_mg", label: "Magnesium", unit: "mg", group: "mineral" },
  { key: "iron_mg", label: "Zat besi", unit: "mg", group: "mineral" },
  { key: "zinc_mg", label: "Seng (zinc)", unit: "mg", group: "mineral" },
  { key: "selenium_mcg", label: "Selenium", unit: "mcg", group: "mineral" },
  { key: "iodine_mcg", label: "Iodium", unit: "mcg", group: "mineral" },
  { key: "sodium_mg", label: "Natrium", unit: "mg", group: "mineral" },
  { key: "potassium_mg", label: "Kalium", unit: "mg", group: "mineral" },
] as const;

export type NutrientKey = (typeof NUTRIENTS)[number]["key"];
export type NutrientMap = Partial<Record<NutrientKey, number>>;

export const NUTRIENT_KEYS = NUTRIENTS.map((n) => n.key) as NutrientKey[];

export const NUTRIENT_BY_KEY: Record<NutrientKey, (typeof NUTRIENTS)[number]> =
  Object.fromEntries(NUTRIENTS.map((n) => [n.key, n])) as never;

export function isNutrientKey(key: string): key is NutrientKey {
  return key in NUTRIENT_BY_KEY;
}

const MASS_TO_MG: Record<string, number> = {
  g: 1000,
  mg: 1,
  mcg: 0.001,
  "µg": 0.001,
  "μg": 0.001,
  ug: 0.001,
};

// Faktor IU -> satuan kanonik. Vitamin E memakai 0,67 mg/IU (alfa-tokoferol
// alami); untuk bentuk sintetis nilainya sedikit lebih rendah, jadi hasilnya
// perkiraan dan ditandai di catatan produk.
const IU_FACTORS: Partial<Record<NutrientKey, number>> = {
  vit_a_mcg: 0.3,
  vit_d_mcg: 0.025,
  vit_e_mg: 0.67,
};

function canonicalUnit(key: NutrientKey): string {
  return NUTRIENT_BY_KEY[key].unit;
}

/**
 * Mengubah angka dari label (dengan satuan apa pun yang tercetak) menjadi
 * satuan kanonik. Mengembalikan null bila satuannya tidak dikenali, supaya
 * pengguna diminta memeriksa angka itu secara manual.
 */
export function normalizeAmount(
  key: NutrientKey,
  value: number,
  rawUnit: string,
): number | null {
  if (!Number.isFinite(value)) return null;
  const unit = rawUnit
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/\.$/, "")
    .replace(/^(mcg|µg|μg|ug)(re|rae|ne)$/, "$1")
    .replace(/^mg(ne|α-te|a-te|te)$/, "mg");
  const target = canonicalUnit(key);

  if (target === "kkal") {
    if (["kkal", "kcal", "kal", "cal"].includes(unit)) return value;
    if (unit === "kj") return value / 4.184;
    return null;
  }

  if (unit === "iu" || unit === "si" || unit === "ui") {
    const f = IU_FACTORS[key];
    return f === undefined ? null : value * f;
  }

  const from = MASS_TO_MG[unit];
  const to = MASS_TO_MG[target];
  if (from === undefined || to === undefined) return null;
  return (value * from) / to;
}

export function addNutrients(a: NutrientMap, b: NutrientMap, factor = 1): NutrientMap {
  const out: NutrientMap = { ...a };
  for (const key of NUTRIENT_KEYS) {
    const v = b[key];
    if (v === undefined || v === null) continue;
    out[key] = (out[key] ?? 0) + v * factor;
  }
  return out;
}

export function scaleNutrients(n: NutrientMap, factor: number): NutrientMap {
  return addNutrients({}, n, factor);
}

export function roundNutrient(value: number): number {
  if (value >= 100) return Math.round(value);
  if (value >= 10) return Math.round(value * 10) / 10;
  return Math.round(value * 100) / 100;
}

export function formatNutrient(key: NutrientKey, value: number | undefined | null): string {
  if (value === undefined || value === null) return "–";
  return `${roundNutrient(value).toLocaleString("id-ID")} ${canonicalUnit(key)}`;
}
