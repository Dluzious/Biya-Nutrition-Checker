import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { NUTRIENT_KEYS, NUTRIENT_BY_KEY, isNutrientKey, normalizeAmount, type NutrientMap } from "../shared/nutrients";
import type { EvaluationOutput, ProductForm, SuggestionOutput } from "../shared/types";
import type { Env } from "./db";

export class AiError extends Error {
  constructor(
    message: string,
    readonly status = 502,
  ) {
    super(message);
  }
}

export function modelFor(env: Env): string {
  return env.ANTHROPIC_MODEL || "claude-opus-5-5";
}

type Effort = "low" | "medium" | "high";

async function callClaude<T>(
  env: Env,
  opts: {
    system: string;
    content: Anthropic.Beta.BetaContentBlockParam[];
    schema: Record<string, unknown>;
    validator: z.ZodType<T>;
    effort: Effort;
    timeoutMs: number;
  },
): Promise<T> {
  if (!env.ANTHROPIC_API_KEY) {
    throw new AiError("API key Anthropic belum diatur di server (secret ANTHROPIC_API_KEY).", 503);
  }
  const client = new Anthropic({
    apiKey: env.ANTHROPIC_API_KEY,
    timeout: opts.timeoutMs,
    ...(env.ANTHROPIC_BASE_URL ? { baseURL: env.ANTHROPIC_BASE_URL } : {}),
  });

  let response: Anthropic.Beta.BetaMessage;
  try {
    response = await client.beta.messages.create({
      model: modelFor(env),
      max_tokens: 16000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      thinking: { type: "adaptive" },
      output_config: { effort: opts.effort, format: { type: "json_schema", schema: opts.schema } },
      system: opts.system,
      messages: [{ role: "user", content: opts.content }],
    });
  } catch (error) {
    if (error instanceof Anthropic.AuthenticationError) {
      throw new AiError("API key Anthropic tidak valid. Periksa secret ANTHROPIC_API_KEY.", 503);
    }
    if (error instanceof Anthropic.PermissionDeniedError) {
      throw new AiError("API key tidak punya akses ke model ini.", 503);
    }
    if (error instanceof Anthropic.RateLimitError) {
      throw new AiError("Batas penggunaan AI sedang tercapai. Coba lagi beberapa menit lagi.", 429);
    }
    if (error instanceof Anthropic.BadRequestError) {
      throw new AiError(`Permintaan ke AI ditolak: ${error.message}`, 400);
    }
    if (error instanceof Anthropic.APIConnectionTimeoutError) {
      throw new AiError("AI terlalu lama merespons. Coba lagi.", 504);
    }
    if (error instanceof Anthropic.APIError) {
      throw new AiError(`Layanan AI bermasalah (${error.status ?? "jaringan"}). Coba lagi.`, 502);
    }
    throw error;
  }

  if (response.stop_reason === "refusal") {
    throw new AiError("AI menolak memproses permintaan ini. Coba dengan foto/data lain.", 422);
  }
  if (response.stop_reason === "max_tokens") {
    throw new AiError("Jawaban AI terpotong. Coba lagi.", 502);
  }
  const text = response.content
    .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")
    .map((b) => b.text)
    .join("");
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new AiError("Format jawaban AI tidak terbaca. Coba lagi.", 502);
  }
  const result = opts.validator.safeParse(parsed);
  if (!result.success) throw new AiError("Format jawaban AI tidak sesuai. Coba lagi.", 502);
  return result.data;
}

const nullable = (type: "string" | "number") => ({ anyOf: [{ type }, { type: "null" }] });

// ---------------------------------------------------------------------------
// Membaca label produk dari foto

const LABEL_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "is_nutrition_label",
    "product_name",
    "brand",
    "form",
    "serving_description",
    "serving_size_g",
    "serving_volume_ml",
    "preparation",
    "nutrients",
    "notes",
    "confidence",
  ],
  properties: {
    is_nutrition_label: { type: "boolean" },
    product_name: { type: "string" },
    brand: { type: "string" },
    form: { type: "string", enum: ["cair", "bubuk", "lainnya"] },
    serving_description: { type: "string" },
    serving_size_g: nullable("number"),
    serving_volume_ml: nullable("number"),
    preparation: { type: "string" },
    nutrients: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["key", "label_text", "amount", "unit", "basis"],
        properties: {
          key: { type: "string", enum: [...NUTRIENT_KEYS, "lainnya"] },
          label_text: { type: "string" },
          amount: { type: "number" },
          unit: { type: "string" },
          basis: { type: "string", enum: ["per_saji", "per_100ml", "per_100g"] },
        },
      },
    },
    notes: { type: "array", items: { type: "string" } },
    confidence: { type: "string", enum: ["tinggi", "sedang", "rendah"] },
  },
} as const;

const LabelSchema = z.object({
  is_nutrition_label: z.boolean(),
  product_name: z.string(),
  brand: z.string(),
  form: z.enum(["cair", "bubuk", "lainnya"]),
  serving_description: z.string(),
  serving_size_g: z.number().nullable(),
  serving_volume_ml: z.number().nullable(),
  preparation: z.string(),
  nutrients: z.array(
    z.object({
      key: z.string(),
      label_text: z.string(),
      amount: z.number(),
      unit: z.string(),
      basis: z.enum(["per_saji", "per_100ml", "per_100g"]),
    }),
  ),
  notes: z.array(z.string()),
  confidence: z.enum(["tinggi", "sedang", "rendah"]),
});

type LabelReading = z.infer<typeof LabelSchema>;

const NUTRIENT_GUIDE = Object.values(NUTRIENT_BY_KEY)
  .map((n) => `- ${n.key}: ${n.label}`)
  .join("\n");

const LABEL_SYSTEM = `Kamu membaca foto kemasan produk nutrisi (formula oral/enteral seperti Nutrican atau Fresubin) untuk aplikasi pemantau gizi seorang pasien kanker yang menjalani diet cair.

Tugasmu menyalin isi tabel "Informasi Nilai Gizi"/"Nutrition Facts" dan petunjuk penyajian SEAKURAT MUNGKIN dari foto.

Aturan:
- Hanya salin angka yang benar-benar terlihat di foto. Jangan mengisi dari ingatanmu tentang produk itu. Angka yang buram, terpotong, atau ragu: jangan dimasukkan, tulis di notes.
- Salin satuan persis seperti tercetak (g, mg, mcg, µg, IU, kkal, kJ, dll.). Jangan mengonversi sendiri.
- Abaikan kolom %AKG / %DV. Ambil angka massa/energinya.
- basis: "per_saji" bila angka untuk satu takaran saji, "per_100ml" atau "per_100g" bila tabel per 100 ml/g. Bila tabel punya dua kolom, salin keduanya sebagai entri terpisah.
- Pemetaan key:
${NUTRIENT_GUIDE}
  Energi total → energy_kcal (abaikan "energi dari lemak"). Lemak total → fat_g. Karbohidrat total → carb_g. Serat pangan → fiber_g. Gula total → sugar_g. EPA/DHA/omega-3 → omega3_mg (jumlahkan EPA+DHA bila terpisah, sebutkan di notes). Zat gizi lain (lemak jenuh, kolesterol, laktosa, dll.) → "lainnya".
- serving_description: tulis takaran saji persis seperti di label (mis. "1 botol (200 ml)", "6 sendok takar (45 g)").
- serving_volume_ml: volume AKHIR satu sajian yang siap diminum, bila tertulis (mis. botol 200 ml, atau "menghasilkan 200 ml"). Untuk bubuk yang hanya menyebut jumlah air, isi null dan jelaskan di notes.
- serving_size_g: berat bubuk per sajian bila tertulis.
- preparation: cara penyajian/pengenceran bila ada (bahasa Indonesia).
- is_nutrition_label: false bila foto tidak memuat informasi nilai gizi sama sekali.
- confidence: seberapa yakin kamu bahwa angka yang disalin benar.
- notes: bahasa Indonesia, singkat — misalnya angka yang tidak terbaca, peringatan di kemasan (mis. tidak untuk penderita galaktosemia), atau rasa/varian produk.`;

export interface ProductDraft {
  name: string;
  brand: string;
  form: ProductForm;
  servingLabel: string;
  servingVolumeMl: number | null;
  servingGrams: number | null;
  preparation: string;
  nutrients: NutrientMap;
  notes: string[];
  confidence: LabelReading["confidence"];
  isNutritionLabel: boolean;
}

export function labelToDraft(reading: LabelReading): ProductDraft {
  const notes = [...reading.notes];
  let servingVolumeMl = reading.serving_volume_ml;
  let servingGrams = reading.serving_size_g;
  let servingLabel = reading.serving_description;

  const hasPerServing = reading.nutrients.some((n) => n.basis === "per_saji");
  let fallbackBasis: "per_100ml" | "per_100g" | null = null;
  if (!hasPerServing) {
    if (reading.nutrients.some((n) => n.basis === "per_100ml")) fallbackBasis = "per_100ml";
    else if (reading.nutrients.some((n) => n.basis === "per_100g")) fallbackBasis = "per_100g";
  }
  // Tanpa kolom per sajian dan tanpa ukuran sajian: jadikan 100 ml/100 g sebagai satu takaran.
  if (fallbackBasis === "per_100ml" && !servingVolumeMl) {
    servingVolumeMl = 100;
    servingLabel = "100 ml";
    notes.push("Label hanya mencantumkan nilai per 100 ml; takaran saji di aplikasi diatur 100 ml.");
  }
  if (fallbackBasis === "per_100g" && !servingGrams) {
    servingGrams = 100;
    servingLabel = "100 g";
    notes.push("Label hanya mencantumkan nilai per 100 g; takaran saji di aplikasi diatur 100 g.");
  }

  const factorFor = (basis: LabelReading["nutrients"][number]["basis"]): number | null => {
    if (basis === "per_saji") return 1;
    if (basis === "per_100ml") return servingVolumeMl ? servingVolumeMl / 100 : null;
    return servingGrams ? servingGrams / 100 : null;
  };

  const nutrients: NutrientMap = {};
  const chosenBasis: Partial<Record<string, string>> = {};
  const priority = { per_saji: 0, per_100ml: 1, per_100g: 2 } as const;
  const ordered = [...reading.nutrients].sort((a, b) => priority[a.basis] - priority[b.basis]);
  for (const n of ordered) {
    if (!isNutrientKey(n.key)) continue;
    if (chosenBasis[n.key]) continue;
    const factor = factorFor(n.basis);
    if (factor === null) continue;
    const value = normalizeAmount(n.key, n.amount, n.unit);
    if (value === null) {
      notes.push(`Satuan "${n.unit}" untuk ${n.label_text} tidak dikenali — isi manual bila perlu.`);
      continue;
    }
    nutrients[n.key] = Math.round(value * factor * 1000) / 1000;
    chosenBasis[n.key] = n.basis;
    if (/^(iu|si|ui)$/i.test(n.unit.trim())) {
      notes.push(`${n.label_text} dikonversi dari IU (perkiraan).`);
    }
  }

  if (reading.form === "bubuk" && !servingVolumeMl) {
    notes.push("Isi volume akhir 1 sajian setelah dilarutkan (ukur dengan gelas takar) agar bisa dicatat per ml.");
  }

  return {
    name: reading.product_name,
    brand: reading.brand,
    form: reading.form,
    servingLabel,
    servingVolumeMl,
    servingGrams,
    preparation: reading.preparation,
    nutrients,
    notes,
    confidence: reading.confidence,
    isNutritionLabel: reading.is_nutrition_label,
  };
}

export interface ImageInput {
  mediaType: "image/jpeg" | "image/png" | "image/webp";
  data: string;
}

export async function readLabel(env: Env, images: ImageInput[]): Promise<ProductDraft> {
  const reading = await callClaude(env, {
    system: LABEL_SYSTEM,
    content: [
      ...images.map(
        (img): Anthropic.Beta.BetaImageBlockParam => ({
          type: "image",
          source: { type: "base64", media_type: img.mediaType, data: img.data },
        }),
      ),
      {
        type: "text",
        text:
          images.length > 1
            ? `Ada ${images.length} foto dari produk yang sama (mis. depan, tabel gizi, petunjuk penyajian). Gabungkan informasinya.`
            : "Baca label produk di foto ini.",
      },
    ],
    schema: LABEL_SCHEMA,
    validator: LabelSchema,
    effort: "medium",
    timeoutMs: 120_000,
  });
  return labelToDraft(reading);
}

// ---------------------------------------------------------------------------
// Perkiraan kandungan minuman umum (jus, air kelapa, kaldu, dll.)

const ESTIMATE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["is_liquid", "name", "assumptions", "nutrients", "cautions", "confidence"],
  properties: {
    is_liquid: { type: "boolean" },
    name: { type: "string" },
    assumptions: { type: "array", items: { type: "string" } },
    nutrients: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["key", "amount"],
        properties: {
          key: { type: "string", enum: NUTRIENT_KEYS },
          amount: { type: "number" },
        },
      },
    },
    cautions: { type: "array", items: { type: "string" } },
    confidence: { type: "string", enum: ["tinggi", "sedang", "rendah"] },
  },
} as const;

const EstimateSchema = z.object({
  is_liquid: z.boolean(),
  name: z.string(),
  assumptions: z.array(z.string()),
  nutrients: z.array(z.object({ key: z.string(), amount: z.number() })),
  cautions: z.array(z.string()),
  confidence: z.enum(["tinggi", "sedang", "rendah"]),
});

const ESTIMATE_UNITS = Object.values(NUTRIENT_BY_KEY)
  .map((n) => `- ${n.key}: ${n.label} (${n.unit})`)
  .join("\n");

const ESTIMATE_SYSTEM = `Kamu memperkirakan kandungan gizi minuman atau makanan cair yang umum di Indonesia (mis. jus mangga, jus alpukat, air kelapa, susu UHT, kaldu ayam, sari kacang hijau, teh manis) untuk aplikasi pemantau gizi pasien yang menjalani diet cair.

Aturan:
- Hitung untuk VOLUME yang disebutkan pengguna, bukan per 100 ml.
- Pakai pengetahuanmu tentang Tabel Komposisi Pangan Indonesia (TKPI) dan USDA FoodData Central.
- Bila resep tidak disebutkan (gula, susu kental manis, es, buah:air), pakai cara penyajian paling umum di Indonesia dan tulis asumsinya di assumptions (singkat, bahasa Indonesia).
- Isi nutrients dengan angka dalam satuan persis berikut, hanya untuk zat gizi yang bisa diperkirakan wajar; lewati yang tidak tahu:
${ESTIMATE_UNITS}
- Minimal isi energy_kcal, protein_g, carb_g, fat_g, dan sugar_g bila relevan.
- name: nama singkat yang jelas, sertakan asumsi utama (mis. "Jus mangga (tanpa gula)").
- cautions: maksimal 2 catatan singkat tentang kecocokan minuman ini untuk pasien sesuai diagnosis dan instruksi diet yang diberikan (mis. keasaman, ampas/serat, gula tinggi, rendah protein dibanding formula). Kosongkan bila tidak ada.
- is_liquid: false bila yang disebutkan bukan minuman/makanan cair.
- confidence: seberapa yakin perkiraanmu.`;

export interface DrinkEstimate {
  isLiquid: boolean;
  name: string;
  volumeMl: number;
  nutrients: NutrientMap;
  assumptions: string[];
  cautions: string[];
  confidence: "tinggi" | "sedang" | "rendah";
}

export async function estimateDrink(
  env: Env,
  input: { description: string; volumeMl: number; diagnosis: string; dietOrder: string },
): Promise<DrinkEstimate> {
  const r = await callClaude(env, {
    system: ESTIMATE_SYSTEM,
    content: [
      {
        type: "text",
        text: `Minuman: ${input.description}\nVolume: ${input.volumeMl} ml\nDiagnosis pasien: ${input.diagnosis || "-"}\nInstruksi diet: ${input.dietOrder || "-"}`,
      },
    ],
    schema: ESTIMATE_SCHEMA,
    validator: EstimateSchema,
    effort: "medium",
    timeoutMs: 90_000,
  });
  const nutrients: NutrientMap = {};
  for (const n of r.nutrients) {
    if (isNutrientKey(n.key) && Number.isFinite(n.amount) && n.amount >= 0) {
      nutrients[n.key] = Math.round(n.amount * 1000) / 1000;
    }
  }
  return {
    isLiquid: r.is_liquid,
    name: r.name,
    volumeMl: input.volumeMl,
    nutrients,
    assumptions: r.assumptions,
    cautions: r.cautions,
    confidence: r.confidence,
  };
}

// ---------------------------------------------------------------------------
// Analisis makanan (diet lunak) dari foto dan/atau keterangan

const FOOD_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["is_food", "name", "portion_description", "items", "total_grams", "fluid_ml", "nutrients", "diet_fit", "assumptions", "confidence"],
  properties: {
    is_food: { type: "boolean" },
    name: { type: "string" },
    portion_description: { type: "string" },
    items: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["name", "grams", "energy_kcal", "protein_g"],
        properties: {
          name: { type: "string" },
          grams: { type: "number" },
          energy_kcal: { type: "number" },
          protein_g: { type: "number" },
        },
      },
    },
    total_grams: { type: "number" },
    fluid_ml: { type: "number" },
    nutrients: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["key", "amount"],
        properties: {
          key: { type: "string", enum: NUTRIENT_KEYS },
          amount: { type: "number" },
        },
      },
    },
    diet_fit: {
      type: "object",
      additionalProperties: false,
      required: ["status", "notes"],
      properties: {
        status: { type: "string", enum: ["sesuai", "sebagian", "tidak_sesuai"] },
        notes: { type: "array", items: { type: "string" } },
      },
    },
    assumptions: { type: "array", items: { type: "string" } },
    confidence: { type: "string", enum: ["tinggi", "sedang", "rendah"] },
  },
} as const;

const FoodSchema = z.object({
  is_food: z.boolean(),
  name: z.string(),
  portion_description: z.string(),
  items: z.array(z.object({ name: z.string(), grams: z.number(), energy_kcal: z.number(), protein_g: z.number() })),
  total_grams: z.number(),
  fluid_ml: z.number(),
  nutrients: z.array(z.object({ key: z.string(), amount: z.number() })),
  diet_fit: z.object({ status: z.enum(["sesuai", "sebagian", "tidak_sesuai"]), notes: z.array(z.string()) }),
  assumptions: z.array(z.string()),
  confidence: z.enum(["tinggi", "sedang", "rendah"]),
});

export type FoodReading = z.infer<typeof FoodSchema>;

const FOOD_SYSTEM = `Kamu ahli gizi yang memperkirakan kandungan gizi makanan untuk pasien kanker dengan metastasis ke lambung yang sedang menjalani diet lunak (atau transisi dari diet cair). Masukannya foto makanan dan/atau keterangan dari keluarga.

Aturan:
- Kenali setiap komponen hidangan (mis. bubur, ayam suwir, telur, kuah) dan perkirakan beratnya dalam gram dari ukuran wadah/sendok di foto (piring makan ±23 cm, mangkuk sedang ±300–400 ml, sendok makan ±10–15 g). Bila keterangan menyebut porsi ("setengah mangkuk"), pakai keterangan itu.
- Hitung kandungan untuk SELURUH porsi yang terlihat/disebutkan. Pakai Tabel Komposisi Pangan Indonesia (TKPI) dan USDA.
- nutrients: total seluruh porsi dalam satuan persis berikut; isi minimal energi, protein, karbohidrat, lemak, serat, natrium bila bisa diperkirakan:
${ESTIMATE_UNITS}
- items: rincian per komponen (gram, kkal, protein).
- total_grams: perkiraan berat total porsi.
- fluid_ml: perkiraan air/kuah yang ikut terminum dari porsi ini (kuah sup, bubur encer, susu); kecil untuk makanan padat lunak seperti tahu atau telur.
- name: nama hidangan singkat (mis. "Bubur ayam tanpa kerupuk").
- portion_description: porsi dengan kata-kata (mis. "1 mangkuk sedang ±300 g").
- diet_fit: apakah sesuai diet lunak untuk lambung yang sensitif — lunak, mudah dicerna, rendah serat kasar, tidak pedas/asam/bersantan kental/digoreng keras. "sebagian" bila ada komponen yang sebaiknya disisihkan (sebutkan di notes, maks 2 catatan singkat).
- assumptions: asumsi penting yang memengaruhi angka (maks 3, singkat).
- is_food: false bila foto/keterangan bukan makanan.
- confidence: seberapa yakin perkiraanmu; foto buram/porsi tertutup → rendah.
- Bahasa Indonesia.`;

export interface FoodEstimate {
  isFood: boolean;
  name: string;
  portionDescription: string;
  items: { name: string; grams: number; energyKcal: number; proteinG: number }[];
  totalGrams: number;
  fluidMl: number;
  nutrients: NutrientMap;
  dietFit: { status: "sesuai" | "sebagian" | "tidak_sesuai"; notes: string[] };
  assumptions: string[];
  confidence: "tinggi" | "sedang" | "rendah";
}

/** Mengubah jawaban AI menjadi perkiraan yang aman dipakai (kunci dikenal, tidak negatif). */
export function foodToEstimate(r: FoodReading): FoodEstimate {
  const nonNeg = (n: number) => (Number.isFinite(n) && n > 0 ? Math.round(n * 1000) / 1000 : 0);
  const nutrients: NutrientMap = {};
  for (const n of r.nutrients) {
    if (isNutrientKey(n.key) && Number.isFinite(n.amount) && n.amount >= 0) nutrients[n.key] = nonNeg(n.amount);
  }
  return {
    isFood: r.is_food,
    name: r.name.trim() || "Makanan",
    portionDescription: r.portion_description,
    items: r.items.map((i) => ({ name: i.name, grams: nonNeg(i.grams), energyKcal: nonNeg(i.energy_kcal), proteinG: nonNeg(i.protein_g) })),
    totalGrams: nonNeg(r.total_grams),
    fluidMl: nonNeg(r.fluid_ml),
    nutrients,
    dietFit: r.diet_fit,
    assumptions: r.assumptions.slice(0, 3),
    confidence: r.confidence,
  };
}

export async function estimateFood(
  env: Env,
  input: { images: ImageInput[]; description: string; diagnosis: string; dietOrder: string },
): Promise<FoodEstimate> {
  const reading = await callClaude(env, {
    system: FOOD_SYSTEM,
    content: [
      ...input.images.map(
        (img): Anthropic.Beta.BetaImageBlockParam => ({
          type: "image",
          source: { type: "base64", media_type: img.mediaType, data: img.data },
        }),
      ),
      {
        type: "text",
        text: [
          input.images.length ? `${input.images.length} foto makanan terlampir.` : "Tidak ada foto; perkirakan dari keterangan saja.",
          `Keterangan keluarga: ${input.description || "-"}`,
          `Diagnosis: ${input.diagnosis || "-"}`,
          `Instruksi diet: ${input.dietOrder || "-"}`,
        ].join("\n"),
      },
    ],
    schema: FOOD_SCHEMA,
    validator: FoodSchema,
    effort: "medium",
    timeoutMs: 120_000,
  });
  return foodToEstimate(reading);
}

// ---------------------------------------------------------------------------
// Evaluasi kecukupan & saran asupan berikutnya

const CLINICAL_CONTEXT = `Kamu adalah ahli gizi klinis (dietisien) yang mendampingi seorang pasien kanker perempuan dan keluarganya lewat aplikasi pemantau asupan. Diagnosis dan instruksi diet dari dokter ada di data (profil.diagnosis, profil.instruksi_diet) — umumnya DIET CAIR dengan formula oral (ONS) seperti Nutrican dan Fresubin. Bicaralah seperti dietisien yang hangat kepada pasien (sapa dengan namanya, profil.nama) dan pendampingnya, bukan kepada tenaga kesehatan.

Prinsip:
- Nilai berdasarkan data yang diberikan saja. Bila data penting kurang (BB lama tidak ditimbang, produk belum lengkap, belum ada catatan), katakan dengan jelas.
- Target energi/protein/cairan sudah dihitung aplikasi (ESPEN 2021: 25–30 kkal/kg, protein 1,0–1,5 g/kg; atau target dokter bila ada). Pakai target itu; jangan membuat target baru.
- Patuhi tahap diet di profil.tahap_diet: "cair" = hanya cairan, jangan sarankan makanan; "cair_lunak" = formula cair tetap utama, makanan lunak mulai bertahap; "lunak" = makanan lunak boleh menjadi menu utama dengan formula sebagai tambahan. Makanan lunak: lembut, mudah dicerna, rendah serat kasar, tidak pedas/asam/bersantan kental/digoreng (mis. bubur, nasi tim, sup sayur lunak, telur rebus/kukus, tahu, ikan kukus, daging cincang halus, pisang, pepaya). Jangan menyarankan makanan keras/biasa, suplemen herbal, atau obat; jangan menyarankan mengubah/menghentikan obat atau terapi. Saran formula hanya dari produk yang tersedia, ditambah air putih bila tidak ada batasan cairan.
- Saat transisi ke makanan lunak, porsi makan biasanya kecil sehingga asupan bisa turun: sarankan formula tetap diminum di antara waktu makan sampai makanan lunak memenuhi sebagian besar kebutuhan. Makan sedikit-sedikit tapi sering (5–6 kali), kunyah perlahan.
- Hormati volume maksimal sekali minum. Bila ada mual, muntah, begah, atau diare, sarankan cara meningkatkan toleransi (porsi lebih kecil dan lebih sering, diminum perlahan/disesap, disajikan dingin, jeda dari berbaring setelah minum) dan sarankan konsultasi bila menetap.
- Bila risiko refeeding tinggi dan masih di hari-hari awal, ingatkan agar tidak mengejar target penuh terlalu cepat dan perlunya cek elektrolit sesuai arahan dokter.
- Tanda bahaya (muntah darah/cairan seperti kopi, BAB hitam, tidak bisa menahan cairan, BAK sangat sedikit, pingsan, demam ≥38°C, nyeri perut hebat, sesak) → minta segera menghubungi dokter atau ke IGD.
- SINGKAT: setiap poin maksimal satu kalimat pendek. Bahasa Indonesia sederhana dan hangat. Bulatkan angka. Jangan mengulang data mentah dan jangan berceramah.
- Selalu sertakan kata-kata penyemangat yang tulus dan spesifik pada kemajuan nyata (mis. protein naik dari kemarin, jadwal pagi tepat waktu). Jangan memuji berlebihan bila asupan jauh kurang; tetap jujur lalu beri semangat untuk langkah berikutnya. Bila ada tanda bahaya, utamakan keselamatan dan beri dukungan yang menenangkan.
- Kamu bukan pengganti dokter; sampaikan hal yang perlu ditanyakan ke dokter bila relevan.`;

const EVALUATION_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "status",
    "ringkasan",
    "temuan",
    "saran",
    "rencana_asupan_berikutnya",
    "tanda_bahaya",
    "pertanyaan_untuk_dokter",
    "semangat",
  ],
  properties: {
    semangat: { type: "string" },
    status: { type: "string", enum: ["cukup", "hampir_cukup", "kurang", "berlebih", "perlu_perhatian"] },
    ringkasan: { type: "string" },
    temuan: { type: "array", items: { type: "string" } },
    saran: { type: "array", items: { type: "string" } },
    rencana_asupan_berikutnya: { type: "string" },
    tanda_bahaya: { type: "array", items: { type: "string" } },
    pertanyaan_untuk_dokter: { type: "array", items: { type: "string" } },
  },
} as const;

const EvaluationSchema: z.ZodType<EvaluationOutput> = z.object({
  status: z.enum(["cukup", "hampir_cukup", "kurang", "berlebih", "perlu_perhatian"]),
  ringkasan: z.string(),
  temuan: z.array(z.string()),
  saran: z.array(z.string()),
  rencana_asupan_berikutnya: z.string(),
  tanda_bahaya: z.array(z.string()),
  pertanyaan_untuk_dokter: z.array(z.string()),
  semangat: z.string(),
});

const SUGGESTION_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["saran_utama", "rincian", "catatan", "semangat"],
  properties: {
    semangat: { type: "string" },
    saran_utama: { type: "string" },
    rincian: { type: "array", items: { type: "string" } },
    catatan: { type: "array", items: { type: "string" } },
  },
} as const;

const SuggestionSchema: z.ZodType<SuggestionOutput> = z.object({
  saran_utama: z.string(),
  rincian: z.array(z.string()),
  catatan: z.array(z.string()),
  semangat: z.string(),
});

export async function evaluateIntake(env: Env, context: unknown): Promise<EvaluationOutput> {
  return callClaude(env, {
    system: `${CLINICAL_CONTEXT}

Tugas: sebagai ahli gizi, evaluasi kecukupan nutrisi. Bandingkan asupan hari ini dengan target dan dengan yang seharusnya sudah tercapai pada jam ini (expected_fraction_now), lihat tren 7 hari, berat badan, gejala, dan lab. Jawab RINGKAS.
- status: "perlu_perhatian" bila ada tanda bahaya atau gejala berat; selain itu nilai kecukupan energi & protein.
- ringkasan: 1–2 kalimat pendek (inti kondisi hari ini, sebut % energi & protein).
- temuan: maks 3 poin terpenting saja.
- saran: maks 3 langkah konkret.
- rencana_asupan_berikutnya: 1–2 kalimat — jam, produk, dan ml untuk sisa hari ini, dalam batas volume maksimal sekali minum.
- tanda_bahaya: kosongkan bila tidak ada.
- pertanyaan_untuk_dokter: maks 2, kosongkan bila tidak perlu.
- semangat: 1 kalimat penyemangat yang hangat untuk pasien (dan pendampingnya), spesifik pada usahanya hari ini.`,
    content: [{ type: "text", text: `Data pasien (JSON):\n${JSON.stringify(context)}` }],
    schema: EVALUATION_SCHEMA,
    validator: EvaluationSchema,
    effort: "high",
    timeoutMs: 180_000,
  });
}

export async function suggestIntake(env: Env, context: unknown): Promise<SuggestionOutput> {
  return callClaude(env, {
    system: `${CLINICAL_CONTEXT}

Tugas: sebagai ahli gizi, beri saran SATU kali minum berikutnya. Gunakan deterministic_suggestion sebagai titik awal, sesuaikan dengan gejala dan toleransi terbaru. Jawab RINGKAS.
- saran_utama: satu kalimat — kapan, produk apa, berapa ml (mis. "Pukul 15.00: Fresubin 150 ml, diminum perlahan dalam 20 menit").
- rincian: maks 2 poin pendek (perkiraan kkal/protein, sisa target hari ini).
- catatan: maks 1 hal yang perlu diwaspadai, kosongkan bila tidak ada.
- semangat: 1 kalimat penyemangat singkat untuk pasien.`,
    content: [{ type: "text", text: `Data pasien (JSON):\n${JSON.stringify(context)}` }],
    schema: SUGGESTION_SCHEMA,
    validator: SuggestionSchema,
    effort: "medium",
    timeoutMs: 120_000,
  });
}
