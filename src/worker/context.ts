import { expectedFraction, slotDone, suggestNext, sumIntakes } from "../shared/intake";
import { NUTRIENT_BY_KEY, NUTRIENT_KEYS, roundNutrient, type NutrientMap } from "../shared/nutrients";
import { computeTargets } from "../shared/targets";
import { addDays, localParts, timeToMinutes } from "../shared/time";
import { RED_FLAGS } from "../shared/types";
import {
  getProfile,
  listIntakes,
  listLabs,
  listProducts,
  listSchedule,
  listSymptoms,
  listWeights,
  type Env,
} from "./db";

const r = (n: number | undefined | null) => (n === undefined || n === null ? null : roundNutrient(n));

function pct(value: number | undefined, target: number | undefined | null): number | null {
  if (!target) return null;
  return Math.round(((value ?? 0) / target) * 100);
}

function compactNutrients(n: NutrientMap): Record<string, number> {
  const out: Record<string, number> = {};
  for (const key of NUTRIENT_KEYS) {
    const v = n[key];
    if (v !== undefined && v !== null) out[`${NUTRIENT_BY_KEY[key].label} (${NUTRIENT_BY_KEY[key].unit})`] = roundNutrient(v);
  }
  return out;
}

/** Menyusun ringkasan data untuk AI. Dihitung di server agar sama untuk semua anggota. */
export async function buildAiContext(env: Env, date: string, now = new Date()) {
  const profile = await getProfile(env.DB);
  const tz = profile.timezone;
  const nowLocal = localParts(now, tz);
  const isToday = date === nowLocal.date;
  const from = addDays(date, -6);

  const [products, schedule, intakes, symptoms, weights, labs] = await Promise.all([
    listProducts(env.DB),
    listSchedule(env.DB),
    listIntakes(env.DB, from, date),
    listSymptoms(env.DB, addDays(date, -2), date),
    listWeights(env.DB),
    listLabs(env.DB),
  ]);

  const targets = computeTargets({ profile, weights, labs, today: date });
  const todays = intakes.filter((i) => i.localDate === date);
  const totals = sumIntakes(todays);
  const intakeMinutes = todays.map((i) => localParts(new Date(i.takenAt), tz).minutes);
  const nowMinutes = isToday ? nowLocal.minutes : date < nowLocal.date ? 24 * 60 : 0;

  const suggestion = suggestNext({
    nowMinutes,
    schedule,
    products,
    totals,
    targets,
    intakeMinutes,
    maxVolumeMl: profile.maxVolumePerSittingMl,
    fluidRestricted: Boolean(profile.conditions.fluidRestrictionMl),
  });

  const history = [];
  for (let d = from; d <= date; d = addDays(d, 1)) {
    const dayTotals = sumIntakes(intakes.filter((i) => i.localDate === d));
    const t = d === date ? targets : computeTargets({ profile, weights, labs, today: d });
    history.push({
      tanggal: d,
      kali_minum: dayTotals.count,
      energi_kkal: r(dayTotals.nutrients.energy_kcal) ?? 0,
      persen_energi: pct(dayTotals.nutrients.energy_kcal, t.energy?.target),
      protein_g: r(dayTotals.nutrients.protein_g) ?? 0,
      persen_protein: pct(dayTotals.nutrients.protein_g, t.protein?.target),
      cairan_ml: Math.round(dayTotals.volumeMl),
    });
  }

  // null = tidak tercantum di label produk yang diminum (bukan berarti 0).
  const microAdequacy: Record<string, number | null> = {};
  for (const [key, target] of Object.entries(targets.micros)) {
    const k = key as keyof NutrientMap;
    microAdequacy[`${NUTRIENT_BY_KEY[k].label}`] = totals.nutrients[k] === undefined ? null : pct(totals.nutrients[k], target);
  }

  const redFlagLabel = (k: string) => RED_FLAGS.find((f) => f.key === k)?.label ?? k;

  return {
    waktu_sekarang: isToday ? `${nowLocal.date} ${nowLocal.time} (${tz})` : `${date} (hari lampau/rekap)`,
    expected_fraction_now: Math.round(expectedFraction(nowMinutes, schedule) * 100) / 100,
    profil: {
      nama: profile.name || "Pasien",
      diagnosis: profile.diagnosis,
      instruksi_diet: profile.dietOrder,
      usia: profile.age,
      tinggi_cm: profile.heightCm,
      bb_biasa_kg: profile.usualWeightKg,
      aktivitas: profile.activity,
      ginjal: profile.conditions.kidney,
      diabetes: profile.conditions.diabetes,
      batas_cairan_ml: profile.conditions.fluidRestrictionMl,
      terapi: profile.conditions.therapy,
      catatan_kondisi: profile.conditions.notes,
      volume_maks_sekali_minum_ml: profile.maxVolumePerSittingMl,
      catatan_target_dokter: profile.doctorTargets.note,
    },
    status_gizi: {
      bb_kg: targets.weightKg,
      tanggal_bb: targets.weightDate,
      imt: targets.bmi,
      kategori_imt: targets.bmiCategory,
      penurunan_bb_persen: targets.weightLoss,
      kaheksia: targets.cachexia,
      risiko_refeeding: targets.refeeding,
    },
    target: {
      energi: targets.energy,
      protein: targets.protein,
      cairan: targets.fluid,
      lemak_g: targets.fatG,
      karbohidrat_g: targets.carbG,
      acuan_mikro: targets.akgLabel,
      peringatan: targets.warnings,
    },
    hari_ini: {
      total: compactNutrients(totals.nutrients),
      cairan_ml: Math.round(totals.volumeMl),
      persen_energi: pct(totals.nutrients.energy_kcal, targets.energy?.target),
      persen_protein: pct(totals.nutrients.protein_g, targets.protein?.target),
      persen_cairan: pct(totals.volumeMl, targets.fluid?.target),
      persen_akg_mikro: microAdequacy,
      catatan_mikro: "null = kandungan tidak tercantum di label produk yang diminum, bukan berarti nol.",
      catatan_minum: todays.map((i) => ({
        jam: localParts(new Date(i.takenAt), tz).time,
        produk: i.productName,
        jumlah: `${roundNutrient(i.amount)} ${i.unit}`,
        volume_ml: Math.round(i.volumeMl),
        energi_kkal: r(i.nutrients.energy_kcal),
        protein_g: r(i.nutrients.protein_g),
        catatan: i.note || undefined,
      })),
    },
    jadwal: schedule
      .filter((s) => s.enabled)
      .map((s) => ({
        jam: s.time,
        label: s.label,
        produk: products.find((p) => p.id === s.productId)?.name ?? null,
        rencana_ml: s.plannedMl,
        sudah_dicatat: slotDone(timeToMinutes(s.time), intakeMinutes),
      })),
    produk_tersedia: products
      .filter((p) => p.active)
      .map((p) => ({
        nama: p.name,
        merek: p.brand,
        bentuk: p.form,
        takaran_saji: p.servingLabel,
        volume_saji_ml: p.servingVolumeMl,
        sumber_data: p.source === "estimasi" ? "perkiraan AI (bukan label)" : p.source === "ai" ? "label kemasan (foto)" : "diisi manual",
        per_saji: compactNutrients(p.nutrients),
      })),
    riwayat_7_hari: history,
    gejala_3_hari: symptoms.map((s) => ({
      waktu: `${s.localDate} ${localParts(new Date(s.at), tz).time}`,
      mual: s.nausea,
      muntah: s.vomiting,
      begah: s.bloating,
      diare: s.diarrhea,
      nyeri: s.pain,
      tanda_bahaya: s.redFlags.map(redFlagLabel),
      catatan: s.note || undefined,
    })),
    skala_gejala: "0 = tidak ada, 1 = ringan, 2 = sedang, 3 = berat",
    riwayat_bb: weights.slice(-12).map((w) => ({ tanggal: w.date, kg: w.kg })),
    lab_terbaru: labs.slice(0, 3),
    deterministic_suggestion: {
      jam: suggestion.time,
      produk: suggestion.product?.name ?? null,
      jumlah: suggestion.amount,
      satuan: suggestion.unit,
      energi_kkal: suggestion.energyKcal,
      protein_g: suggestion.proteinG,
      sisa_target: suggestion.remaining,
      jadwal_tersisa: suggestion.slotsLeft,
      catatan: suggestion.notes,
    },
  };
}
