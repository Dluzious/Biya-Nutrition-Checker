import type { NutrientMap } from "./nutrients";

export type Role = "pasien" | "pendamping";

export interface Member {
  id: string;
  name: string;
  role: Role;
}

export type Activity = "baring" | "terbatas" | "aktif";
export type KidneyStatus = "normal" | "ckd" | "dialisis";
export type RefeedingSetting = "auto" | "rendah" | "sedang" | "tinggi" | "sangat_tinggi";

export interface PatientProfile {
  name: string;
  diagnosis: string;
  /** Instruksi diet dari dokter, mis. "Diet cair: Nutrican & Fresubin". */
  dietOrder: string;
  age: number | null;
  heightCm: number | null;
  /** Berat badan biasa sebelum sakit, untuk menghitung persentase penurunan. */
  usualWeightKg: number | null;
  activity: Activity;
  conditions: {
    kidney: KidneyStatus;
    diabetes: boolean;
    /** Batas cairan harian dari dokter (edema, asites, gagal jantung). */
    fluidRestrictionMl: number | null;
    refeeding: RefeedingSetting;
    /** Berapa hari asupan sangat sedikit/hampir tidak ada sebelum nutrisi dimulai. */
    lowIntakeDays: number | null;
    /** Tanggal (YYYY-MM-DD) nutrisi penuh mulai diberikan, untuk target bertahap. */
    nutritionStartDate: string | null;
    /** Insulin, kemoterapi, antasida, atau diuretik (kriteria risiko refeeding NICE). */
    riskMedication: boolean;
    therapy: string;
    notes: string;
  };
  doctorTargets: {
    energyKcal: number | null;
    proteinG: number | null;
    fluidMl: number | null;
    note: string;
  };
  factorOverrides: {
    kcalPerKg: number | null;
    proteinPerKg: number | null;
  };
  maxVolumePerSittingMl: number | null;
  timezone: string;
  missedAlertMinutes: number;
}

export const DEFAULT_PROFILE: PatientProfile = {
  name: "",
  diagnosis: "Melanoma maligna dengan metastasis ke lambung",
  dietOrder: "Diet cair — utamanya Nutrican dan Fresubin",
  age: null,
  heightCm: null,
  usualWeightKg: null,
  activity: "terbatas",
  conditions: {
    kidney: "normal",
    diabetes: false,
    fluidRestrictionMl: null,
    refeeding: "auto",
    lowIntakeDays: null,
    nutritionStartDate: null,
    riskMedication: false,
    therapy: "",
    notes: "",
  },
  doctorTargets: { energyKcal: null, proteinG: null, fluidMl: null, note: "" },
  factorOverrides: { kcalPerKg: null, proteinPerKg: null },
  maxVolumePerSittingMl: 200,
  timezone: "Asia/Jakarta",
  missedAlertMinutes: 45,
};

export type ProductForm = "cair" | "bubuk" | "lainnya";

export interface Product {
  id: string;
  name: string;
  brand: string;
  form: ProductForm;
  /** Keterangan takaran saji, mis. "1 botol 200 ml" atau "6 sendok takar + 200 ml air". */
  servingLabel: string;
  /** Volume akhir 1 takaran saji setelah siap diminum (ml). */
  servingVolumeMl: number | null;
  servingGrams: number | null;
  preparation: string;
  /** Kandungan per 1 takaran saji, dalam satuan kanonik. */
  nutrients: NutrientMap;
  notes: string;
  source: "manual" | "ai";
  active: boolean;
  updatedAt: string;
}

export type IntakeUnit = "ml" | "porsi";

export interface Intake {
  id: string;
  takenAt: string;
  localDate: string;
  productId: string | null;
  productName: string;
  amount: number;
  unit: IntakeUnit;
  volumeMl: number;
  /** Salinan kandungan saat dicatat, supaya riwayat tidak berubah bila produk diedit. */
  nutrients: NutrientMap;
  note: string;
  loggedBy: string;
  loggedByName?: string;
}

export interface WeightEntry {
  id: string;
  date: string;
  kg: number;
  note: string;
}

export const RED_FLAGS = [
  { key: "muntah_darah", label: "Muntah darah / cairan hitam seperti kopi" },
  { key: "bab_hitam", label: "BAB hitam atau berdarah" },
  { key: "tidak_bisa_minum", label: "Tidak bisa menahan cairan apa pun (muntah terus)" },
  { key: "bak_sedikit", label: "Buang air kecil sangat sedikit / tidak BAK >8 jam" },
  { key: "pingsan", label: "Pingsan, sangat lemas, atau pusing berat saat berdiri" },
  { key: "demam", label: "Demam ≥38°C" },
  { key: "nyeri_hebat", label: "Nyeri perut hebat atau perut kaku/membesar" },
  { key: "sesak", label: "Sesak napas" },
] as const;

export type RedFlagKey = (typeof RED_FLAGS)[number]["key"];

export interface SymptomEntry {
  id: string;
  at: string;
  localDate: string;
  /** Skala 0 (tidak ada) – 3 (berat). */
  nausea: number;
  vomiting: number;
  bloating: number;
  diarrhea: number;
  pain: number;
  redFlags: RedFlagKey[];
  note: string;
  loggedBy: string;
  loggedByName?: string;
}

export const LAB_FIELDS = [
  { key: "albumin", label: "Albumin", unit: "g/dL" },
  { key: "hb", label: "Hemoglobin", unit: "g/dL" },
  { key: "natrium", label: "Natrium (Na)", unit: "mmol/L" },
  { key: "kalium", label: "Kalium (K)", unit: "mmol/L" },
  { key: "fosfat", label: "Fosfat (P)", unit: "mg/dL" },
  { key: "magnesium", label: "Magnesium (Mg)", unit: "mg/dL" },
  { key: "ureum", label: "Ureum", unit: "mg/dL" },
  { key: "kreatinin", label: "Kreatinin", unit: "mg/dL" },
  { key: "gds", label: "Gula darah sewaktu", unit: "mg/dL" },
  { key: "crp", label: "CRP", unit: "mg/L" },
] as const;

export type LabKey = (typeof LAB_FIELDS)[number]["key"];

export interface LabEntry {
  id: string;
  date: string;
  values: Partial<Record<LabKey, number>>;
  note: string;
}

export interface ScheduleItem {
  id: string;
  time: string; // HH:MM waktu lokal
  label: string;
  productId: string | null;
  plannedMl: number | null;
  enabled: boolean;
}

export interface PushPrefs {
  reminders: boolean;
  missed: boolean;
  alerts: boolean;
  activity: boolean;
}

export interface Evaluation {
  id: string;
  createdAt: string;
  localDate: string;
  kind: "evaluasi" | "saran";
  output: EvaluationOutput | SuggestionOutput;
  model: string;
  createdBy: string;
  createdByName?: string;
}

export interface EvaluationOutput {
  status: "cukup" | "hampir_cukup" | "kurang" | "berlebih" | "perlu_perhatian";
  ringkasan: string;
  temuan: string[];
  saran: string[];
  rencana_asupan_berikutnya: string;
  tanda_bahaya: string[];
  pertanyaan_untuk_dokter: string[];
}

export interface SuggestionOutput {
  saran_utama: string;
  rincian: string[];
  catatan: string[];
}
