import { AKG_MICRO_KEYS, akgFor } from "./akg";
import type { NutrientMap } from "./nutrients";
import { daysBetween } from "./time";
import type { LabEntry, PatientProfile, WeightEntry } from "./types";

// Rujukan rumus:
// - Energi 25–30 kkal/kg/hari, protein 1,0–1,5 g/kg/hari:
//   ESPEN practical guideline: Clinical nutrition in cancer (Muscaritoli dkk., 2021).
// - Risiko refeeding & target awal 5–10 kkal/kg yang dinaikkan bertahap:
//   NICE CG32, Nutrition support for adults.
// - Kaheksia kanker: konsensus Fearon dkk. (2011).
// - Vitamin & mineral: AKG 2019 (lihat akg.ts).
// Target dari dokter/ahli gizi selalu menggantikan hasil rumus.

export type TargetSource = "dokter" | "rumus" | "batasan";
export type RefeedingLevel = "rendah" | "sedang" | "tinggi" | "sangat_tinggi";

export interface TargetLine {
  target: number;
  min: number | null;
  max: number | null;
  source: TargetSource;
  basis: string[];
}

export interface Targets {
  weightKg: number | null;
  weightDate: string | null;
  bmi: number | null;
  bmiCategory: string | null;
  weightLoss: {
    fromUsualPct: number | null;
    pct1m: number | null;
    pct3m: number | null;
    pct6m: number | null;
  };
  dosingWeightKg: number | null;
  dosingWeightBasis: string | null;
  refeeding: {
    level: RefeedingLevel;
    auto: boolean;
    reasons: string[];
    day: number | null;
    rampActive: boolean;
  };
  energy: TargetLine | null;
  protein: TargetLine | null;
  fluid: TargetLine | null;
  fatG: number | null;
  carbG: number | null;
  micros: NutrientMap;
  akgLabel: string;
  cachexia: boolean;
  warnings: string[];
}

export interface TargetInput {
  profile: PatientProfile;
  weights: WeightEntry[];
  labs: LabEntry[];
  today: string;
}

const ENERGY_PER_KG = { baring: 25, terbatas: 28, aktif: 30 } as const;
const ACTIVITY_LABEL = {
  baring: "lebih banyak berbaring",
  terbatas: "aktivitas terbatas",
  aktif: "masih aktif/berjalan",
} as const;

const fmt = (n: number, digits = 0) =>
  n.toLocaleString("id-ID", { maximumFractionDigits: digits, minimumFractionDigits: 0 });

const round10 = (n: number) => Math.round(n / 10) * 10;
const round1 = (n: number) => Math.round(n * 10) / 10;

/** Kategori IMT Kemenkes RI. */
export function bmiCategory(bmi: number): string {
  if (bmi < 17) return "Kurus berat";
  if (bmi < 18.5) return "Kurus ringan";
  if (bmi <= 25) return "Normal";
  if (bmi <= 27) return "Gemuk ringan";
  return "Gemuk berat";
}

/** BB ideal Broca modifikasi untuk perempuan. */
export function idealWeightKg(heightCm: number): number {
  const base = heightCm - 100;
  return heightCm >= 150 ? base * 0.9 : base;
}

function sortedWeights(weights: WeightEntry[]): WeightEntry[] {
  return [...weights].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

function lossOverWindow(
  sorted: WeightEntry[],
  current: WeightEntry,
  days: number,
  tolerance: number,
): number | null {
  let best: WeightEntry | null = null;
  let bestDiff = Infinity;
  for (const w of sorted) {
    if (w.date >= current.date) continue;
    const age = daysBetween(w.date, current.date);
    const diff = Math.abs(age - days);
    if (diff <= tolerance && diff < bestDiff) {
      best = w;
      bestDiff = diff;
    }
  }
  if (!best) return null;
  return round1(((best.kg - current.kg) / best.kg) * 100);
}

function latestLabValue(
  labs: LabEntry[],
  key: keyof LabEntry["values"],
  today: string,
  maxAgeDays: number,
): number | null {
  const recent = labs
    .filter((l) => l.values[key] !== undefined && daysBetween(l.date, today) <= maxAgeDays)
    .sort((a, b) => (a.date < b.date ? 1 : -1));
  return recent.length ? (recent[0].values[key] as number) : null;
}

export function assessRefeeding(
  profile: PatientProfile,
  bmi: number | null,
  loss36: number | null,
  labs: LabEntry[],
  today: string,
): { level: RefeedingLevel; reasons: string[] } {
  const reasons: string[] = [];
  const lowDays = profile.conditions.lowIntakeDays ?? 0;

  const k = latestLabValue(labs, "kalium", today, 14);
  const p = latestLabValue(labs, "fosfat", today, 14);
  const mg = latestLabValue(labs, "magnesium", today, 14);
  const lowLabs: string[] = [];
  if (k !== null && k < 3.5) lowLabs.push(`kalium ${fmt(k, 1)}`);
  if (p !== null && p < 2.5) lowLabs.push(`fosfat ${fmt(p, 1)}`);
  if (mg !== null && mg < 1.7) lowLabs.push(`magnesium ${fmt(mg, 1)}`);

  const veryHigh: string[] = [];
  if (bmi !== null && bmi < 14) veryHigh.push(`IMT ${fmt(bmi, 1)} (<14)`);
  if (lowDays > 15) veryHigh.push(`asupan hampir tidak ada ${lowDays} hari (>15)`);
  if (veryHigh.length) return { level: "sangat_tinggi", reasons: veryHigh };

  const major: string[] = [];
  if (bmi !== null && bmi < 16) major.push(`IMT ${fmt(bmi, 1)} (<16)`);
  if (loss36 !== null && loss36 > 15) major.push(`BB turun ${fmt(loss36, 1)}% (>15%)`);
  if (lowDays > 10) major.push(`asupan sangat sedikit ${lowDays} hari (>10)`);
  if (lowLabs.length) major.push(`elektrolit rendah: ${lowLabs.join(", ")}`);
  if (major.length) return { level: "tinggi", reasons: major };

  const minor: string[] = [];
  if (bmi !== null && bmi < 18.5) minor.push(`IMT ${fmt(bmi, 1)} (<18,5)`);
  if (loss36 !== null && loss36 > 10) minor.push(`BB turun ${fmt(loss36, 1)}% (>10%)`);
  if (lowDays > 5) minor.push(`asupan sangat sedikit ${lowDays} hari (>5)`);
  if (profile.conditions.riskMedication) minor.push("obat berisiko (insulin/kemoterapi/antasida/diuretik)");
  if (minor.length >= 2) return { level: "tinggi", reasons: minor };

  if (lowDays > 5) return { level: "sedang", reasons: minor };
  reasons.push(...minor);
  return { level: "rendah", reasons };
}

export function computeTargets(input: TargetInput): Targets {
  const { profile, labs, today } = input;
  const warnings: string[] = [];
  const sorted = sortedWeights(input.weights.filter((w) => w.date <= today));
  const current = sorted.length ? sorted[sorted.length - 1] : null;
  const weightKg = current?.kg ?? null;
  const heightCm = profile.heightCm;

  const bmi =
    weightKg !== null && heightCm ? round1(weightKg / (heightCm / 100) ** 2) : null;

  const weightLoss = {
    fromUsualPct:
      weightKg !== null && profile.usualWeightKg
        ? round1(((profile.usualWeightKg - weightKg) / profile.usualWeightKg) * 100)
        : null,
    pct1m: current ? lossOverWindow(sorted, current, 30, 10) : null,
    pct3m: current ? lossOverWindow(sorted, current, 91, 21) : null,
    pct6m: current ? lossOverWindow(sorted, current, 182, 30) : null,
  };
  const loss36Candidates = [weightLoss.pct3m, weightLoss.pct6m].filter(
    (v): v is number => v !== null,
  );
  const loss36 = loss36Candidates.length
    ? Math.max(...loss36Candidates)
    : weightLoss.fromUsualPct;

  // Kaheksia (Fearon 2011): turun >5% dalam 6 bulan, atau >2% dengan IMT <20.
  const loss6 = weightLoss.pct6m ?? weightLoss.fromUsualPct;
  const cachexia =
    loss6 !== null && (loss6 > 5 || (bmi !== null && bmi < 20 && loss6 > 2));

  if (weightKg === null) {
    warnings.push("Berat badan belum diisi — target dari rumus belum bisa dihitung.");
  } else if (current && daysBetween(current.date, today) > 14) {
    warnings.push(
      `Berat badan terakhir dicatat ${daysBetween(current.date, today)} hari lalu. Timbang ulang agar target akurat.`,
    );
  }
  if (!heightCm) warnings.push("Tinggi badan belum diisi — IMT dan risiko refeeding kurang akurat.");
  if (profile.age === null) warnings.push("Usia belum diisi — acuan AKG memakai kelompok 30–49 tahun.");

  // Berat badan untuk perhitungan: aktual, kecuali obesitas (IMT ≥30).
  let dosingWeightKg = weightKg;
  let dosingWeightBasis: string | null = weightKg !== null ? "BB aktual" : null;
  if (weightKg !== null && heightCm && bmi !== null && bmi >= 30) {
    const ibw = idealWeightKg(heightCm);
    dosingWeightKg = round1(ibw + 0.25 * (weightKg - ibw));
    dosingWeightBasis = "BB terkoreksi (IMT ≥30)";
  }

  // Refeeding
  const auto = profile.conditions.refeeding === "auto";
  const assessed = assessRefeeding(profile, bmi, loss36, labs, today);
  const level: RefeedingLevel = auto
    ? assessed.level
    : (profile.conditions.refeeding as RefeedingLevel);
  const reasons = auto ? assessed.reasons : ["ditetapkan manual di profil"];
  const start = profile.conditions.nutritionStartDate;
  const day = start ? daysBetween(start, today) + 1 : null;

  // Energi
  let energy: TargetLine | null = null;
  let rampActive = false;
  if (profile.doctorTargets.energyKcal) {
    energy = {
      target: profile.doctorTargets.energyKcal,
      min: null,
      max: null,
      source: "dokter",
      basis: ["Target dari dokter/ahli gizi."],
    };
    if (level === "tinggi" || level === "sangat_tinggi") {
      warnings.push(
        "Risiko refeeding tinggi: pastikan target dari dokter sudah memperhitungkan kenaikan bertahap dan pemantauan elektrolit.",
      );
    }
  } else if (dosingWeightKg !== null && weightKg !== null) {
    const perKg = profile.factorOverrides.kcalPerKg ?? ENERGY_PER_KG[profile.activity];
    const full = round10(perKg * dosingWeightKg);
    const basis = [
      `${fmt(perKg, 1)} kkal/kg × ${fmt(dosingWeightKg, 1)} kg (${dosingWeightBasis}) = ${fmt(full)} kkal.`,
      profile.factorOverrides.kcalPerKg
        ? "Faktor kkal/kg diatur manual di profil."
        : `Faktor ${perKg} kkal/kg dipilih karena ${ACTIVITY_LABEL[profile.activity]} (ESPEN: 25–30 kkal/kg/hari).`,
    ];
    let target = full;

    if ((level === "tinggi" || level === "sangat_tinggi") && day !== null) {
      const startPerKg = level === "sangat_tinggi" ? 5 : 10;
      const rampDays = level === "sangat_tinggi" ? 7 : 5;
      const startKcal = startPerKg * weightKg;
      if (day < rampDays) {
        const d = Math.max(day, 1);
        target = round10(startKcal + ((full - startKcal) * (d - 1)) / (rampDays - 1));
        rampActive = true;
        basis.push(
          `Risiko refeeding ${level === "sangat_tinggi" ? "sangat tinggi" : "tinggi"}: hari ke-${d} dari ${rampDays}, mulai ${startPerKg} kkal/kg lalu naik bertahap sampai target penuh (NICE CG32).`,
        );
      }
    } else if (level === "sedang" && day !== null && day <= 2) {
      target = round10(full * 0.5);
      rampActive = true;
      basis.push(
        `Asupan sangat sedikit >5 hari: hari ke-${Math.max(day, 1)}, maksimal 50% kebutuhan pada 2 hari pertama (NICE CG32).`,
      );
    } else if ((level === "tinggi" || level === "sangat_tinggi") && day === null) {
      warnings.push(
        "Risiko refeeding tinggi tetapi tanggal mulai nutrisi belum diisi. Isi di Profil agar target dinaikkan bertahap, dan konsultasikan ke dokter.",
      );
    }

    energy = {
      target,
      min: rampActive ? null : round10(25 * dosingWeightKg),
      max: rampActive ? null : round10(30 * dosingWeightKg),
      source: "rumus",
      basis,
    };
  }

  if (level === "tinggi" || level === "sangat_tinggi") {
    warnings.push(
      "Risiko refeeding: perlu pemeriksaan kalium, fosfat, magnesium dan pemberian tiamin sesuai arahan dokter pada hari-hari awal.",
    );
  }

  // Protein
  let protein: TargetLine | null = null;
  if (profile.doctorTargets.proteinG) {
    protein = {
      target: profile.doctorTargets.proteinG,
      min: null,
      max: null,
      source: "dokter",
      basis: ["Target dari dokter/ahli gizi."],
    };
  } else if (dosingWeightKg !== null) {
    const kidney = profile.conditions.kidney;
    const range =
      kidney === "ckd"
        ? { def: 1.0, min: 0.8, max: 1.0 }
        : kidney === "dialisis"
          ? { def: 1.2, min: 1.2, max: 1.5 }
          : { def: 1.2, min: 1.0, max: 1.5 };
    const perKg = profile.factorOverrides.proteinPerKg ?? range.def;
    const target = Math.round(perKg * dosingWeightKg);
    const basis = [
      `${fmt(perKg, 1)} g/kg × ${fmt(dosingWeightKg, 1)} kg = ${fmt(target)} g.`,
      kidney === "normal"
        ? "ESPEN: protein >1 g/kg/hari, bila memungkinkan sampai 1,5 g/kg/hari."
        : kidney === "ckd"
          ? "Gangguan ginjal (belum dialisis): dibatasi sementara sampai ada arahan dokter."
          : "Pasien dialisis membutuhkan protein lebih tinggi (1,2–1,5 g/kg).",
    ];
    if (kidney !== "normal") {
      warnings.push(
        "Ada gangguan ginjal: minta dokter menetapkan target protein dan cairan, lalu isi di Profil.",
      );
    }
    protein = {
      target,
      min: Math.round(range.min * dosingWeightKg),
      max: Math.round(range.max * dosingWeightKg),
      source: "rumus",
      basis,
    };
  }

  // Cairan
  let fluid: TargetLine | null = null;
  const restriction = profile.conditions.fluidRestrictionMl;
  if (profile.doctorTargets.fluidMl) {
    fluid = {
      target: profile.doctorTargets.fluidMl,
      min: null,
      max: restriction,
      source: "dokter",
      basis: ["Target dari dokter/ahli gizi."],
    };
  } else if (weightKg !== null) {
    const age = profile.age;
    const perKg = age === null ? 30 : age <= 55 ? 35 : age <= 75 ? 30 : 25;
    let target = round10(perKg * weightKg);
    const basis = [
      `${perKg} ml/kg × ${fmt(weightKg, 1)} kg = ${fmt(target)} ml${age === null ? " (usia belum diisi)" : ` (usia ${age} th)`}.`,
      "Termasuk volume susu formula. Tambah bila demam, diare, atau muntah — sesuai arahan dokter.",
    ];
    let source: TargetSource = "rumus";
    if (restriction && restriction < target) {
      target = restriction;
      source = "batasan";
      basis.push(`Dibatasi ${fmt(restriction)} ml/hari sesuai batasan cairan dari dokter.`);
    }
    fluid = { target, min: null, max: restriction, source, basis };
  }

  // Lemak & karbohidrat (informasi, bukan target utama)
  let fatG: number | null = null;
  let carbG: number | null = null;
  if (energy) {
    const fatPct = profile.conditions.diabetes ? 0.4 : 0.35;
    fatG = Math.round((energy.target * fatPct) / 9);
    const proteinKcal = (protein?.target ?? 0) * 4;
    carbG = Math.max(0, Math.round((energy.target - proteinKcal - energy.target * fatPct) / 4));
  }

  const akg = akgFor(profile.age);
  const micros: NutrientMap = {};
  for (const key of AKG_MICRO_KEYS) {
    const v = akg.values[key];
    if (v !== undefined) micros[key] = v;
  }

  if (cachexia) {
    warnings.push(
      "Penurunan BB memenuhi kriteria kaheksia kanker. Sampaikan ke dokter; asupan energi-protein yang cukup sangat penting.",
    );
  }

  return {
    weightKg,
    weightDate: current?.date ?? null,
    bmi,
    bmiCategory: bmi !== null ? bmiCategory(bmi) : null,
    weightLoss,
    dosingWeightKg,
    dosingWeightBasis,
    refeeding: { level, auto, reasons, day, rampActive },
    energy,
    protein,
    fluid,
    fatG,
    carbG,
    micros,
    akgLabel: `AKG 2019 – ${akg.label}`,
    cachexia,
    warnings,
  };
}
