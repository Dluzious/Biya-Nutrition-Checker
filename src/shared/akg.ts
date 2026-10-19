import type { NutrientKey, NutrientMap } from "./nutrients";

// Angka Kecukupan Gizi (AKG) 2019 untuk perempuan, Permenkes RI No. 28/2019.
// Dipakai sebagai acuan vitamin & mineral. Energi, protein, dan cairan TIDAK
// memakai tabel ini — targetnya dihitung dari kondisi klinis (lihat targets.ts),
// karena AKG disusun untuk orang sehat.

interface AkgGroup {
  label: string;
  minAge: number;
  maxAge: number;
  values: NutrientMap;
  waterMl: number;
}

const COLUMNS: { label: string; minAge: number; maxAge: number }[] = [
  { label: "Perempuan 19–29 th", minAge: 19, maxAge: 29 },
  { label: "Perempuan 30–49 th", minAge: 30, maxAge: 49 },
  { label: "Perempuan 50–64 th", minAge: 50, maxAge: 64 },
  { label: "Perempuan 65–80 th", minAge: 65, maxAge: 80 },
  { label: "Perempuan >80 th", minAge: 81, maxAge: 200 },
];

// Satu baris per zat gizi, satu kolom per kelompok umur di atas.
const ROWS: Partial<Record<NutrientKey, number[]>> = {
  energy_kcal: [2250, 2150, 1800, 1550, 1400],
  protein_g: [60, 60, 60, 58, 58],
  fat_g: [65, 60, 50, 45, 40],
  carb_g: [360, 340, 280, 230, 200],
  fiber_g: [32, 30, 25, 22, 20],
  vit_a_mcg: [600, 600, 600, 600, 600],
  vit_d_mcg: [15, 15, 15, 20, 20],
  vit_e_mg: [15, 15, 15, 15, 15],
  vit_k_mcg: [55, 55, 55, 55, 55],
  vit_c_mg: [75, 75, 75, 75, 75],
  vit_b1_mg: [1.1, 1.1, 1.1, 1.1, 1.1],
  vit_b2_mg: [1.1, 1.1, 1.1, 1.1, 1.1],
  vit_b3_mg: [14, 14, 14, 14, 14],
  vit_b6_mg: [1.3, 1.3, 1.5, 1.5, 1.5],
  folate_mcg: [400, 400, 400, 400, 400],
  vit_b12_mcg: [4, 4, 4, 4, 4],
  calcium_mg: [1000, 1000, 1200, 1200, 1200],
  phosphorus_mg: [700, 700, 700, 700, 700],
  magnesium_mg: [330, 340, 340, 320, 320],
  iron_mg: [18, 18, 8, 8, 8],
  zinc_mg: [8, 8, 8, 8, 8],
  selenium_mcg: [24, 25, 25, 24, 24],
  iodine_mcg: [150, 150, 150, 150, 150],
  sodium_mg: [1500, 1500, 1400, 1200, 1000],
  potassium_mg: [4700, 4700, 4700, 4700, 4700],
};

const WATER_ML = [2350, 2350, 2350, 1550, 1400];

const GROUPS: AkgGroup[] = COLUMNS.map((col, i) => ({
  ...col,
  waterMl: WATER_ML[i],
  values: Object.fromEntries(
    Object.entries(ROWS).map(([k, arr]) => [k, arr![i]]),
  ) as NutrientMap,
}));

/** Zat gizi yang targetnya diambil dari AKG (bukan dari rumus klinis). */
export const AKG_MICRO_KEYS: NutrientKey[] = [
  "vit_a_mcg",
  "vit_d_mcg",
  "vit_e_mg",
  "vit_k_mcg",
  "vit_c_mg",
  "vit_b1_mg",
  "vit_b2_mg",
  "vit_b3_mg",
  "vit_b6_mg",
  "folate_mcg",
  "vit_b12_mcg",
  "calcium_mg",
  "phosphorus_mg",
  "magnesium_mg",
  "iron_mg",
  "zinc_mg",
  "selenium_mcg",
  "iodine_mcg",
  "sodium_mg",
  "potassium_mg",
];

export function akgFor(age: number | null | undefined): AkgGroup {
  // Tanpa umur, pakai kelompok 30–49 th sebagai titik tengah.
  if (age === null || age === undefined || !Number.isFinite(age)) return GROUPS[1];
  if (age < 19) return GROUPS[0];
  return GROUPS.find((g) => age >= g.minAge && age <= g.maxAge) ?? GROUPS[GROUPS.length - 1];
}
