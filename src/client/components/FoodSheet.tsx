import { useMemo, useRef, useState } from "react";
import { intakeFromProduct } from "../../shared/intake";
import { scaleNutrients, type NutrientKey, type NutrientMap } from "../../shared/nutrients";
import { localParts, zonedToUtc } from "../../shared/time";
import type { Intake, Product } from "../../shared/types";
import { api } from "../api";
import { prepareImage, type PreparedImage } from "../image";
import { useAction, useApp } from "../store";
import { ActionButton, ConfirmDialog, Field, NumberInput, Sheet, StatusPill, fmt, requiredError } from "./ui";

interface FoodEstimate {
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

const AI = "__ai__";
const PORTIONS = [0.25, 0.5, 0.75, 1, 1.5, 2];
const EATEN = [
  { value: 0.25, label: "¼" },
  { value: 0.5, label: "½" },
  { value: 0.75, label: "¾" },
  { value: 1, label: "Habis" },
];
const EDITABLE: { key: NutrientKey; label: string; unit: string }[] = [
  { key: "energy_kcal", label: "Energi", unit: "kkal" },
  { key: "protein_g", label: "Protein", unit: "g" },
  { key: "carb_g", label: "Karbohidrat", unit: "g" },
  { key: "fat_g", label: "Lemak", unit: "g" },
];
const FIT = {
  sesuai: { status: "cukup" as const, label: "Sesuai diet lunak" },
  sebagian: { status: "hampir" as const, label: "Sebagian sesuai" },
  tidak_sesuai: { status: "kurang" as const, label: "Kurang sesuai diet lunak" },
};

function Preview({ nutrients, fluidMl }: { nutrients: NutrientMap; fluidMl: number }) {
  return (
    <div className="card" style={{ background: "var(--surface-2)" }}>
      <div className="row spread small">
        <span>Energi</span>
        <strong>{fmt(nutrients.energy_kcal)} kkal</strong>
      </div>
      <div className="row spread small">
        <span>Protein</span>
        <strong>{fmt(nutrients.protein_g, 1)} g</strong>
      </div>
      <div className="row spread small">
        <span>Karbohidrat · Lemak</span>
        <span>
          {fmt(nutrients.carb_g, 1)} g · {fmt(nutrients.fat_g, 1)} g
        </span>
      </div>
      <div className="row spread small">
        <span>Cairan (air/kuah)</span>
        <span>{fmt(fluidMl)} ml</span>
      </div>
    </div>
  );
}

/**
 * Form catat makan (diet lunak): pilih makanan tersimpan, atau foto/ketik
 * makanan lalu dianalisis AI. Dengan `editing`, mengubah catatan makan lama.
 */
export function FoodSheet({ editing, onClose }: { editing?: Intake; onClose: () => void }) {
  const { boot, date, isToday, todayDate, run, toast } = useApp();
  const tz = boot.profile.timezone;
  const editProduct = editing?.productId ? boot.products.find((p) => p.id === editing.productId) : undefined;
  const savedFoods = boot.products.filter((p) => p.form === "makanan" && p.active);

  const [choice, setChoice] = useState<string>(AI);
  const savedProduct: Product | undefined = editing ? editProduct : savedFoods.find((p) => p.id === choice);
  const [portion, setPortion] = useState<number | null>(editing ? editing.amount : 1);

  const [images, setImages] = useState<PreparedImage[]>([]);
  const [preparing, setPreparing] = useState(false);
  const [description, setDescription] = useState("");
  const [estimate, setEstimate] = useState<FoodEstimate | null>(null);
  const [estNutrients, setEstNutrients] = useState<NutrientMap>({});
  const [analyzing, setAnalyzing] = useState(false);
  const [confirmAi, setConfirmAi] = useState(false);
  const [eaten, setEaten] = useState(1);
  const [saveFavorite, setSaveFavorite] = useState(false);
  const [name, setName] = useState(editing?.productName ?? "");

  const [customTime, setCustomTime] = useState(Boolean(editing) || !isToday);
  const [entryDate, setEntryDate] = useState(editing?.localDate ?? date);
  const [time, setTime] = useState(() =>
    editing ? localParts(new Date(editing.takenAt), tz).time : isToday ? localParts(new Date(), tz).time : "12:00",
  );
  const [note, setNote] = useState(editing?.note ?? "");
  const [saving, setSaving] = useState(false);
  const [removing, execRemove] = useAction();
  const fileInput = useRef<HTMLInputElement>(null);

  const usingAi = !editing && choice === AI;

  // Kandungan yang akan dicatat untuk pilihan saat ini.
  const preview = useMemo((): { nutrients: NutrientMap; fluidMl: number } | null => {
    if (editing) {
      if (!portion) return null;
      if (editProduct) {
        const r = intakeFromProduct(editProduct, portion, "porsi");
        return { nutrients: r.nutrients, fluidMl: r.volumeMl };
      }
      const f = portion / editing.amount;
      return { nutrients: scaleNutrients(editing.nutrients, f), fluidMl: editing.volumeMl * f };
    }
    if (usingAi) {
      return estimate ? { nutrients: scaleNutrients(estNutrients, eaten), fluidMl: estimate.fluidMl * eaten } : null;
    }
    if (!savedProduct || !portion) return null;
    const r = intakeFromProduct(savedProduct, portion, "porsi");
    return { nutrients: r.nutrients, fluidMl: r.volumeMl };
  }, [editing, editProduct, portion, usingAi, estimate, estNutrients, eaten, savedProduct]);

  const canAnalyze = images.length > 0 || description.trim().length >= 3;
  const errors = {
    source: usingAi && !estimate ? (canAnalyze ? "Tekan “Analisis gizi dengan AI” dulu" : "Foto makanan atau tulis keterangannya") : null,
    name: (usingAi && estimate) || (editing && !editProduct) ? requiredError(name, "Isi nama makanan") : null,
    portion: !usingAi && (!portion || portion <= 0) ? "Isi jumlah porsi" : null,
    time: customTime ? requiredError(time, "Isi jam makan") : null,
    date: editing ? (requiredError(entryDate, "Isi tanggal") ?? (entryDate > todayDate ? "Tidak boleh di masa depan" : null)) : null,
  };
  const valid = Object.values(errors).every((e) => !e);

  const addPhotos = async (files: FileList | null) => {
    if (!files?.length) return;
    setPreparing(true);
    try {
      const prepared = await Promise.all([...files].slice(0, 3 - images.length).map(prepareImage));
      setImages([...images, ...prepared].slice(0, 3));
      setEstimate(null);
    } catch (e) {
      toast(`Foto gagal diproses: ${(e as Error).message}`, "error");
    }
    setPreparing(false);
  };

  const analyze = async () => {
    setAnalyzing(true);
    try {
      const { estimate: est } = await api<{ estimate: FoodEstimate }>("/api/ai/food", {
        body: { images: images.map(({ mediaType, data }) => ({ mediaType, data })), description: description.trim() },
      });
      if (!est.isFood) {
        toast("Sepertinya itu bukan makanan — coba foto ulang atau perjelas keterangannya.", "error");
      } else {
        setEstimate(est);
        setEstNutrients(est.nutrients);
        setName(est.name);
        setEaten(1);
        toast("Gizi makanan berhasil diperkirakan — periksa lalu simpan", "success");
      }
    } catch (e) {
      toast(`Analisis gagal: ${(e as Error).message}`, "error");
    }
    setAnalyzing(false);
  };

  const save = async () => {
    if (saving) return;
    if (!valid || !preview) {
      toast("Lengkapi data yang ditandai merah dulu.", "error");
      return;
    }
    setSaving(true);
    const takenAt = customTime ? zonedToUtc(editing ? entryDate : date, time, tz).toISOString() : undefined;
    const freeFood = (productName: string, portions: number) => ({
      productId: null,
      kind: "makan",
      productName,
      portions,
      fluidMl: Math.round(preview.fluidMl),
      nutrients: preview.nutrients,
      takenAt,
      note,
    });
    let ok: unknown;
    if (editing) {
      const body = editProduct
        ? { productId: editProduct.id, amount: portion, unit: "porsi", takenAt, note }
        : freeFood(name.trim(), portion!);
      ok = await run(() => api(`/api/intakes/${editing.id}`, { method: "PUT", body }), "Catatan makan diperbarui");
    } else if (!usingAi) {
      ok = await run(
        () => api("/api/intakes", { body: { productId: savedProduct!.id, amount: portion, unit: "porsi", takenAt, note } }),
        "Makan tercatat 🥣",
      );
    } else if (saveFavorite && estimate) {
      ok = await run(async () => {
        const { product } = await api<{ product: Product }>("/api/products", {
          body: {
            name: name.trim(),
            brand: "",
            form: "makanan",
            servingLabel: estimate.portionDescription,
            servingVolumeMl: null,
            servingGrams: estimate.totalGrams || null,
            fluidMl: Math.round(estimate.fluidMl),
            preparation: "",
            nutrients: estNutrients,
            notes: ["Perkiraan AI dari foto/keterangan makanan.", ...estimate.assumptions].join("\n"),
            source: "estimasi",
            active: true,
          },
        });
        return api("/api/intakes", { body: { productId: product.id, amount: eaten, unit: "porsi", takenAt, note } });
      }, "Makan tercatat & disimpan ke daftar makanan 🥣");
    } else {
      ok = await run(() => api("/api/intakes", { body: freeFood(name.trim(), eaten) }), "Makan tercatat 🥣");
    }
    setSaving(false);
    if (ok) onClose();
  };

  const remove = async () => {
    if (!editing || !confirm(`Hapus catatan ${editing.productName}?`)) return;
    const ok = await execRemove(() => api(`/api/intakes/${editing.id}`, { method: "DELETE" }), "Catatan makan dihapus", "Gagal menghapus");
    if (ok) onClose();
  };

  return (
    <Sheet title={editing ? "Ubah catatan makan" : "Catat makan"} onClose={onClose}>
      {editing && (
        <p className="small muted" style={{ marginTop: -4 }}>
          Dicatat oleh {editing.loggedByName ?? "?"}. Ubah yang perlu, lalu simpan.
        </p>
      )}

      {!editing && (
        <Field label="Makanan">
          <div className="chips">
            <button type="button" className={`chip ${choice === AI ? "active" : ""}`} onClick={() => setChoice(AI)}>
              📷 Foto / ketik (AI)
            </button>
            {savedFoods.map((p) => (
              <button
                key={p.id}
                type="button"
                className={`chip ${choice === p.id ? "active" : ""}`}
                onClick={() => {
                  setChoice(p.id);
                  setPortion(1);
                }}
              >
                {p.name}
              </button>
            ))}
          </div>
        </Field>
      )}

      {editing && !editProduct && (
        <Field label="Nama makanan" required error={errors.name}>
          <input type="text" value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
      )}
      {savedProduct && (
        <p className="small secondary">
          {editing ? <strong>{savedProduct.name}</strong> : null} 1 porsi = {savedProduct.servingLabel || "–"}
          {savedProduct.source === "estimasi" && " (perkiraan AI)"}
        </p>
      )}

      {(editing || !usingAi) && (
        <>
          <Field label="Jumlah porsi" required error={errors.portion}>
            <NumberInput value={portion} onChange={setPortion} />
          </Field>
          <div className="chips" style={{ marginBottom: 12 }}>
            {PORTIONS.map((v) => (
              <button key={v} type="button" className={`chip ${portion === v ? "active" : ""}`} onClick={() => setPortion(v)}>
                {fmt(v, 2)} porsi
              </button>
            ))}
          </div>
        </>
      )}

      {usingAi && (
        <>
          <input
            ref={fileInput}
            type="file"
            accept="image/*"
            multiple
            hidden
            onChange={(e) => {
              addPhotos(e.target.files);
              e.target.value = "";
            }}
          />
          {images.length > 0 && (
            <>
              <div className="photo-grid">
                {images.map((img, i) => (
                  <img
                    key={i}
                    src={img.previewUrl}
                    alt={`Foto makanan ${i + 1}`}
                    onClick={() => {
                      setImages(images.filter((_, j) => j !== i));
                      setEstimate(null);
                    }}
                  />
                ))}
              </div>
              <p className="tiny muted">Ketuk foto untuk menghapus.</p>
            </>
          )}
          {images.length < 3 && (
            <ActionButton
              type="button"
              className="btn block"
              style={{ marginBottom: 10 }}
              busy={preparing}
              busyText="Memproses foto…"
              onClick={() => fileInput.current?.click()}
            >
              {images.length ? "+ Tambah foto" : "📷 Foto makanan"}
            </ActionButton>
          )}
          <Field label="Keterangan (opsional bila ada foto)" hint="mis. “bubur ayam tanpa kerupuk, setengah mangkuk”, “nasi tim ikan + sup wortel”">
            <textarea
              value={description}
              onChange={(e) => {
                setDescription(e.target.value);
                setEstimate(null);
              }}
              style={{ minHeight: 56 }}
            />
          </Field>
          {!estimate && (
            <>
              <ActionButton
                type="button"
                className="btn primary block"
                busy={analyzing}
                busyText="AI menganalisis makanan…"
                attention={canAnalyze}
                disabled={!canAnalyze || !boot.ai.ready}
                onClick={() => setConfirmAi(true)}
              >
                Analisis gizi dengan AI
              </ActionButton>
              {errors.source && <p className="field-error">{errors.source}</p>}
              <p className="tiny muted" style={{ marginTop: 6 }}>
                Tips: foto dari atas, seluruh piring/mangkuk terlihat, ada sendok sebagai pembanding ukuran.
              </p>
            </>
          )}
        </>
      )}

      {usingAi && estimate && (
        <div className={`banner ${estimate.confidence === "rendah" ? "warning" : "info"}`}>
          <div className="row spread" style={{ alignItems: "flex-start" }}>
            <strong>{estimate.portionDescription || "Perkiraan porsi"}</strong>
            <StatusPill status={FIT[estimate.dietFit.status].status} label={FIT[estimate.dietFit.status].label} />
          </div>
          {estimate.dietFit.notes.length > 0 && (
            <ul className="small">
              {estimate.dietFit.notes.map((n, i) => (
                <li key={i}>{n}</li>
              ))}
            </ul>
          )}
          {estimate.items.length > 0 && (
            <table className="nutrients" style={{ marginTop: 6 }}>
              <thead>
                <tr>
                  <th>Komponen</th>
                  <th>Berat</th>
                  <th>kkal</th>
                  <th>Protein</th>
                </tr>
              </thead>
              <tbody>
                {estimate.items.map((it, i) => (
                  <tr key={i}>
                    <td>{it.name}</td>
                    <td>{fmt(it.grams)} g</td>
                    <td>{fmt(it.energyKcal)}</td>
                    <td>{fmt(it.proteinG, 1)} g</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <div className="tiny muted" style={{ marginTop: 6 }}>
            Perkiraan AI (keyakinan {estimate.confidence})
            {estimate.assumptions.length > 0 && ` · ${estimate.assumptions.join("; ")}`}
          </div>
          <details style={{ marginTop: 6 }}>
            <summary className="small">Koreksi angka (untuk seluruh porsi di foto)</summary>
            <div className="grid-2" style={{ marginTop: 6 }}>
              {EDITABLE.map((f) => (
                <Field key={f.key} label={`${f.label} (${f.unit})`}>
                  <NumberInput
                    value={estNutrients[f.key] ?? null}
                    onChange={(v) => {
                      const next = { ...estNutrients };
                      if (v === null) delete next[f.key];
                      else next[f.key] = v;
                      setEstNutrients(next);
                    }}
                  />
                </Field>
              ))}
            </div>
          </details>
        </div>
      )}

      {usingAi && estimate && (
        <>
          <Field label="Nama makanan" required error={errors.name}>
            <input type="text" value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field label="Berapa yang dihabiskan?">
            <div className="segmented" role="radiogroup">
              {EATEN.map((o) => (
                <button
                  key={o.value}
                  type="button"
                  role="radio"
                  aria-checked={eaten === o.value}
                  className={eaten === o.value ? "active" : ""}
                  onClick={() => setEaten(o.value)}
                >
                  {o.label}
                </button>
              ))}
            </div>
          </Field>
          <label className="check">
            <input type="checkbox" checked={saveFavorite} onChange={(e) => setSaveFavorite(e.target.checked)} />
            <span className="small">Simpan ke daftar makanan agar lain kali tinggal dipilih (tanpa AI)</span>
          </label>
        </>
      )}

      {preview && <Preview nutrients={preview.nutrients} fluidMl={preview.fluidMl} />}

      {editing ? (
        <div className="grid-2">
          <Field label="Tanggal makan" required error={errors.date}>
            <input type="date" value={entryDate} max={todayDate} onChange={(e) => setEntryDate(e.target.value)} />
          </Field>
          <Field label="Jam makan" required error={errors.time}>
            <input type="time" value={time} onChange={(e) => setTime(e.target.value)} />
          </Field>
        </div>
      ) : (
        <>
          <label className="check">
            <input type="checkbox" checked={!customTime} disabled={!isToday} onChange={(e) => setCustomTime(!e.target.checked)} />
            <span>Dimakan sekarang{!isToday && " (tidak tersedia — tanggal yang dibuka bukan hari ini)"}</span>
          </label>
          {customTime && (
            <Field label={`Jam makan (${date})`} required error={errors.time}>
              <input type="time" value={time} onChange={(e) => setTime(e.target.value)} />
            </Field>
          )}
        </>
      )}
      <Field label="Catatan (opsional)">
        <input type="text" value={note} placeholder="mis. agak mual setelahnya" onChange={(e) => setNote(e.target.value)} />
      </Field>

      <div className="row">
        <ActionButton className="btn primary grow" busy={saving} attention={valid} onClick={save}>
          {editing ? "Simpan perubahan" : "Simpan"}
        </ActionButton>
        {editing && (
          <ActionButton className="btn danger" busy={removing} busyText="Menghapus…" onClick={remove}>
            Hapus
          </ActionButton>
        )}
      </div>
      {!valid && <p className="field-error" style={{ textAlign: "center" }}>Lengkapi data yang ditandai merah.</p>}

      {confirmAi && (
        <ConfirmDialog
          title="Analisis makanan dengan AI?"
          onCancel={() => setConfirmAi(false)}
          onConfirm={() => {
            setConfirmAi(false);
            analyze();
          }}
        >
          <p>
            {images.length ? `${images.length} foto` : "Keterangan"}
            {images.length && description.trim() ? " dan keterangan" : ""} akan dikirim ke AI untuk memperkirakan kalori dan gizinya.
          </p>
          <p>Hasilnya perkiraan — porsi dari foto bisa meleset. Periksa dan koreksi bila perlu.</p>
        </ConfirmDialog>
      )}
    </Sheet>
  );
}
