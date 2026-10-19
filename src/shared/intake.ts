import { addNutrients, scaleNutrients, type NutrientMap } from "./nutrients";
import type { Targets } from "./targets";
import { minutesToTime, timeToMinutes } from "./time";
import type { Intake, IntakeUnit, Product, ScheduleItem } from "./types";

export function intakeFromProduct(
  product: Pick<Product, "servingVolumeMl" | "nutrients">,
  amount: number,
  unit: IntakeUnit,
): { volumeMl: number; nutrients: NutrientMap } {
  if (!(amount > 0)) throw new Error("Jumlah harus lebih dari 0.");
  if (unit === "ml") {
    if (!product.servingVolumeMl) {
      throw new Error("Produk ini belum punya volume per takaran saji; catat dalam porsi.");
    }
    return {
      volumeMl: amount,
      nutrients: scaleNutrients(product.nutrients, amount / product.servingVolumeMl),
    };
  }
  return {
    volumeMl: product.servingVolumeMl ? product.servingVolumeMl * amount : 0,
    nutrients: scaleNutrients(product.nutrients, amount),
  };
}

export interface DayTotals {
  nutrients: NutrientMap;
  volumeMl: number;
  count: number;
}

export function sumIntakes(intakes: Pick<Intake, "nutrients" | "volumeMl">[]): DayTotals {
  let nutrients: NutrientMap = {};
  let volumeMl = 0;
  for (const i of intakes) {
    nutrients = addNutrients(nutrients, i.nutrients);
    volumeMl += i.volumeMl;
  }
  return { nutrients, volumeMl, count: intakes.length };
}

export type AdequacyStatus = "kurang" | "hampir" | "cukup" | "lebih";

export function adequacyStatus(pct: number): AdequacyStatus {
  if (pct < 75) return "kurang";
  if (pct < 90) return "hampir";
  if (pct <= 120) return "cukup";
  return "lebih";
}

export const STATUS_LABEL: Record<AdequacyStatus, string> = {
  kurang: "Kurang",
  hampir: "Hampir cukup",
  cukup: "Cukup",
  lebih: "Berlebih",
};

const DAY_START = 6 * 60;
const DAY_END = 21 * 60;

/**
 * Berapa bagian target harian yang "seharusnya" sudah tercapai pada menit ini,
 * berdasarkan jadwal minum yang aktif (atau rentang 06.00–21.00 bila tidak ada jadwal).
 */
export function expectedFraction(nowMinutes: number, schedule: ScheduleItem[]): number {
  const times = schedule.filter((s) => s.enabled).map((s) => timeToMinutes(s.time));
  if (times.length === 0) {
    if (nowMinutes <= DAY_START) return 0;
    if (nowMinutes >= DAY_END) return 1;
    return (nowMinutes - DAY_START) / (DAY_END - DAY_START);
  }
  return times.filter((t) => t <= nowMinutes).length / times.length;
}

/** Slot jadwal dianggap sudah dijalankan bila ada catatan minum 30 menit sebelum sampai 90 menit sesudahnya. */
export function slotDone(slotMinutes: number, intakeMinutes: number[]): boolean {
  return intakeMinutes.some((m) => m >= slotMinutes - 30 && m <= slotMinutes + 90);
}

export interface NextSuggestion {
  done: boolean;
  slot: ScheduleItem | null;
  time: string | null;
  product: Product | null;
  amount: number | null;
  unit: IntakeUnit;
  energyKcal: number | null;
  proteinG: number | null;
  remaining: { energyKcal: number; proteinG: number; fluidMl: number };
  slotsLeft: number;
  notes: string[];
}

export interface SuggestInput {
  nowMinutes: number;
  schedule: ScheduleItem[];
  products: Product[];
  totals: DayTotals;
  targets: Pick<Targets, "energy" | "protein" | "fluid">;
  intakeMinutes: number[];
  maxVolumeMl: number | null;
  fluidRestricted: boolean;
}

const round10 = (n: number) => Math.round(n / 10) * 10;

export function suggestNext(input: SuggestInput): NextSuggestion {
  const { targets, totals, nowMinutes } = input;
  const notes: string[] = [];
  const remaining = {
    energyKcal: Math.max(0, (targets.energy?.target ?? 0) - (totals.nutrients.energy_kcal ?? 0)),
    proteinG: Math.max(0, (targets.protein?.target ?? 0) - (totals.nutrients.protein_g ?? 0)),
    fluidMl: Math.max(0, (targets.fluid?.target ?? 0) - totals.volumeMl),
  };

  const enabled = input.schedule
    .filter((s) => s.enabled)
    .sort((a, b) => timeToMinutes(a.time) - timeToMinutes(b.time));
  // Slot yang belum lewat lebih dari 30 menit dan belum ada catatan minumnya.
  const upcoming = enabled.filter((s) => {
    const t = timeToMinutes(s.time);
    return t >= nowMinutes - 30 && !slotDone(t, input.intakeMinutes);
  });
  const slot = upcoming[0] ?? null;
  const slotsLeft = Math.max(upcoming.length, 1);

  const base: NextSuggestion = {
    done: false,
    slot,
    time: slot ? slot.time : null,
    product: null,
    amount: null,
    unit: "ml",
    energyKcal: null,
    proteinG: null,
    remaining,
    slotsLeft,
    notes,
  };

  if (!targets.energy) {
    notes.push("Lengkapi data pasien (berat badan) atau isi target dokter untuk mendapat saran jumlah.");
    return base;
  }

  if (remaining.energyKcal <= 0 && remaining.proteinG <= 0) {
    base.done = true;
    notes.push("Target energi dan protein hari ini sudah tercapai.");
    if (remaining.fluidMl > 0 && !input.fluidRestricted) {
      notes.push(`Cairan masih kurang ±${round10(remaining.fluidMl)} ml — bisa dari air putih sedikit-sedikit.`);
    }
    return base;
  }

  if (!slot) {
    if (nowMinutes >= 22 * 60) {
      notes.push("Tidak ada jadwal tersisa hari ini. Bila pasien terjaga dan sanggup, boleh tambahan kecil.");
    } else if (enabled.length) {
      notes.push("Semua jadwal hari ini sudah lewat. Pertimbangkan minum tambahan sekarang.");
    } else {
      notes.push("Belum ada jadwal minum. Atur di menu Jadwal agar pengingat aktif.");
    }
  }

  const nutritive = input.products.filter(
    (p) => p.active && (p.nutrients.energy_kcal ?? 0) > 0,
  );
  if (nutritive.length === 0) {
    notes.push("Belum ada produk bergizi. Tambahkan produk (foto label) di menu Produk.");
    return base;
  }

  const planned = slot?.productId ? nutritive.find((p) => p.id === slot.productId) : undefined;
  let product = planned;
  if (!product) {
    const energyGap = remaining.energyKcal / targets.energy.target;
    const proteinGap = targets.protein ? remaining.proteinG / targets.protein.target : 0;
    const density = (p: Product, key: "energy_kcal" | "protein_g") =>
      (p.nutrients[key] ?? 0) / (p.servingVolumeMl ?? 200);
    const key = proteinGap > energyGap + 0.1 ? "protein_g" : "energy_kcal";
    product = [...nutritive].sort((a, b) => density(b, key) - density(a, key))[0];
  }

  const perSlotKcal = remaining.energyKcal / slotsLeft;
  const kcalPerServing = product.nutrients.energy_kcal ?? 0;
  const maxVol = input.maxVolumeMl ?? 200;

  if (product.servingVolumeMl) {
    const kcalPerMl = kcalPerServing / product.servingVolumeMl;
    const needed = round10(perSlotKcal / kcalPerMl);
    let volume = Math.max(needed, slot?.plannedMl ?? 0, 50);
    if (volume > maxVol) {
      volume = maxVol;
      const sittingsNeeded = Math.ceil(remaining.energyKcal / (maxVol * kcalPerMl));
      if (sittingsNeeded > slotsLeft) {
        notes.push(
          `Dengan maksimal ${maxVol} ml sekali minum, perlu ±${sittingsNeeded} kali minum lagi hari ini (jadwal tersisa ${upcoming.length}). Pertimbangkan menambah jadwal atau memilih produk lebih padat kalori.`,
        );
      }
    }
    volume = round10(volume);
    const factor = volume / product.servingVolumeMl;
    Object.assign(base, {
      product,
      amount: volume,
      unit: "ml" as const,
      energyKcal: Math.round(kcalPerServing * factor),
      proteinG: Math.round((product.nutrients.protein_g ?? 0) * factor * 10) / 10,
    });

    if (!input.fluidRestricted) {
      const plannedVolume = volume * slotsLeft;
      const extraWater = remaining.fluidMl - plannedVolume;
      if (extraWater >= 100) {
        notes.push(
          `Selain susu, cairan masih kurang ±${round10(extraWater)} ml hari ini — tambahkan air putih sedikit-sedikit di antara jadwal.`,
        );
      }
    }
  } else {
    const servings = Math.max(0.5, Math.round((perSlotKcal / kcalPerServing) * 2) / 2);
    Object.assign(base, {
      product,
      amount: servings,
      unit: "porsi" as const,
      energyKcal: Math.round(kcalPerServing * servings),
      proteinG: Math.round((product.nutrients.protein_g ?? 0) * servings * 10) / 10,
    });
  }

  if (slot && timeToMinutes(slot.time) < nowMinutes) {
    notes.unshift(`Jadwal ${slot.time} belum dicatat — minum sekarang bila memungkinkan.`);
  }
  if (!slot) base.time = minutesToTime(nowMinutes);
  return base;
}
