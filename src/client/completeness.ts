import type { Targets } from "../shared/targets";
import type { Bootstrap } from "./api";

export interface MissingItem {
  /** id elemen di halaman Pasien, untuk menggulir ke kolomnya. */
  id: string;
  label: string;
}

/** Data pasien yang wajib ada agar target bisa dihitung dengan benar. */
export function missingPatientData(boot: Bootstrap, targets: Targets): MissingItem[] {
  const p = boot.profile;
  const out: MissingItem[] = [];
  if (!p.name.trim()) out.push({ id: "field-name", label: "Nama pasien" });
  if (p.age === null) out.push({ id: "field-age", label: "Usia" });
  if (!p.heightCm) out.push({ id: "field-height", label: "Tinggi badan" });
  if (boot.weights.length === 0) out.push({ id: "card-weights", label: "Berat badan" });
  if (refeedingNeedsStartDate(boot, targets)) {
    out.push({ id: "field-startdate", label: "Tanggal mulai nutrisi penuh (risiko refeeding tinggi)" });
  }
  return out;
}

export function refeedingNeedsStartDate(boot: Bootstrap, targets: Targets): boolean {
  const high = targets.refeeding.level === "tinggi" || targets.refeeding.level === "sangat_tinggi";
  return high && !boot.profile.conditions.nutritionStartDate && !boot.profile.doctorTargets.energyKcal;
}

/** Produk aktif yang kandungannya cukup untuk menghitung asupan. */
export function hasUsableProduct(boot: Bootstrap): boolean {
  return boot.products.some((p) => p.active && (p.nutrients.energy_kcal ?? 0) > 0);
}

export function scrollToField(id: string) {
  const el = document.getElementById(id);
  if (!el) return;
  el.scrollIntoView({ behavior: "smooth", block: "center" });
  const input = el.querySelector("input, select, textarea") as HTMLElement | null;
  window.setTimeout(() => input?.focus({ preventScroll: true }), 400);
}
