import { useMemo, useState } from "react";
import { intakeFromProduct } from "../../shared/intake";
import { scaleNutrients, type NutrientKey, type NutrientMap } from "../../shared/nutrients";
import { localParts, zonedToUtc } from "../../shared/time";
import { RED_FLAGS, type Intake, type IntakeUnit, type Product, type RedFlagKey } from "../../shared/types";
import { api } from "../api";
import { useAction, useApp } from "../store";
import { ActionButton, ConfirmDialog, Field, NumberInput, Segmented, Sheet, fmt, requiredError } from "./ui";

interface DrinkEstimate {
  /** true = kandungan diambil dari catatan lama (mode edit), bukan dari AI. */
  fromRecord?: boolean;
  isLiquid: boolean;
  name: string;
  volumeMl: number;
  nutrients: NutrientMap;
  assumptions: string[];
  cautions: string[];
  confidence: "tinggi" | "sedang" | "rendah";
}

const EDITABLE: { key: NutrientKey; label: string; unit: string }[] = [
  { key: "energy_kcal", label: "Energi", unit: "kkal" },
  { key: "protein_g", label: "Protein", unit: "g" },
  { key: "carb_g", label: "Karbohidrat", unit: "g" },
  { key: "fat_g", label: "Lemak", unit: "g" },
  { key: "sugar_g", label: "Gula", unit: "g" },
];

export interface IntakePrefill {
  productId: string;
  amount: number;
  unit: IntakeUnit;
}

const OTHER = "__other__";

/**
 * Form catat minum. Dengan `editing`, form mengubah catatan yang sudah ada
 * (produk, jumlah, tanggal & jam, catatan) lalu menyimpannya kembali.
 */
export function LogIntakeSheet({
  prefill,
  editing,
  onClose,
}: {
  prefill?: IntakePrefill;
  editing?: Intake;
  onClose: () => void;
}) {
  const { boot, date, isToday, todayDate, run, toast } = useApp();
  const tz = boot.profile.timezone;
  const editProduct = editing?.productId ? boot.products.find((p) => p.id === editing.productId) : undefined;
  // Produk catatan lama tetap bisa dipilih walau sudah tidak "sedang dipakai".
  const products = boot.products.filter((p) => p.active || p.id === editProduct?.id);
  const first = editing ? editProduct : prefill ? products.find((p) => p.id === prefill.productId) : products[0];
  // Catatan tanpa produk (atau produknya sudah dihapus): kandungan lama dipakai dan diskalakan.
  const recordEstimate: DrinkEstimate | null =
    editing && !editProduct && Object.keys(editing.nutrients).length > 0 && editing.volumeMl > 0
      ? {
          fromRecord: true,
          isLiquid: true,
          name: editing.productName,
          volumeMl: editing.volumeMl,
          nutrients: editing.nutrients,
          assumptions: [],
          cautions: [],
          confidence: "tinggi",
        }
      : null;

  const [productId, setProductId] = useState<string>(first?.id ?? OTHER);
  const product = products.find((p) => p.id === productId);
  const [unit, setUnit] = useState<IntakeUnit>(
    editing ? (editProduct ? editing.unit : "ml") : (prefill?.unit ?? (first?.servingVolumeMl ? "ml" : "porsi")),
  );
  const [amount, setAmount] = useState<number | null>(
    editing
      ? editProduct
        ? editing.amount
        : Math.round(editing.volumeMl || editing.amount)
      : (prefill?.amount ?? (first?.servingVolumeMl ? first.servingVolumeMl : 1)),
  );
  const [otherName, setOtherName] = useState(editing && !editProduct ? editing.productName : "Air putih");
  const [customTime, setCustomTime] = useState(Boolean(editing) || !isToday);
  const [entryDate, setEntryDate] = useState(editing?.localDate ?? date);
  const [time, setTime] = useState(() =>
    editing ? localParts(new Date(editing.takenAt), tz).time : isToday ? localParts(new Date(), tz).time : "12:00",
  );
  const [note, setNote] = useState(editing?.note ?? "");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [removing, execRemove] = useAction();
  // Perkiraan AI untuk minuman di luar daftar produk; kandungannya untuk estimate.volumeMl.
  const [estimate, setEstimate] = useState<DrinkEstimate | null>(recordEstimate);
  const [estNutrients, setEstNutrients] = useState<NutrientMap>(recordEstimate?.nutrients ?? {});
  const [estimating, setEstimating] = useState(false);
  const [saveAsProduct, setSaveAsProduct] = useState(true);
  const [confirmEstimate, setConfirmEstimate] = useState(false);
  // Produk tersimpan yang namanya mirip, supaya tidak perlu memanggil AI lagi.
  const similar = useMemo(() => {
    const key = otherName.trim().toLowerCase().split(/\s+/).slice(0, 2).join(" ");
    if (key.length < 3) return [];
    return products.filter((p) => p.name.toLowerCase().includes(key));
  }, [otherName, products]);

  const preview = useMemo(() => {
    if (!amount) return null;
    if (productId === OTHER) {
      return estimate ? { volumeMl: amount, nutrients: scaleNutrients(estNutrients, amount / estimate.volumeMl) } : null;
    }
    if (!product) return null;
    try {
      return intakeFromProduct(product, amount, unit);
    } catch {
      return null;
    }
  }, [product, productId, amount, unit, estimate, estNutrients]);

  const runEstimate = async () => {
    if (!amount || otherName.trim().length < 2) return;
    setEstimating(true);
    try {
      const r = await api<{ estimate: DrinkEstimate }>("/api/ai/estimate", {
        body: { description: otherName.trim(), volumeMl: amount },
      });
      setEstimate(r.estimate);
      setEstNutrients(r.estimate.nutrients);
      if (!r.estimate.isLiquid) toast("Sepertinya itu bukan minuman/makanan cair — periksa lagi.", "error");
    } catch (e) {
      toast((e as Error).message, "error");
    }
    setEstimating(false);
  };

  const choose = (id: string) => {
    setProductId(id);
    const p = products.find((x) => x.id === id);
    if (!p) {
      setUnit("ml");
      setAmount(200);
      return;
    }
    if (p.servingVolumeMl) {
      setUnit("ml");
      setAmount(p.servingVolumeMl);
    } else {
      setUnit("porsi");
      setAmount(1);
    }
  };

  // Data wajib: jumlah, nama minuman (bila bukan produk), dan jam bila diisi manual.
  const errors = {
    amount: !amount || amount <= 0 ? "Isi jumlah yang diminum" : null,
    otherName: productId === OTHER ? requiredError(otherName, "Isi nama minuman") : null,
    time: customTime ? requiredError(time, "Isi jam minum") : null,
    date: editing ? (requiredError(entryDate, "Isi tanggal") ?? (entryDate > todayDate ? "Tidak boleh di masa depan" : null)) : null,
  };
  const valid = !errors.amount && !errors.otherName && !errors.time && !errors.date;
  const [reminding, remindExec] = useAction();

  const quickMl = product?.servingVolumeMl
    ? [...new Set([50, 100, 150, 200, product.servingVolumeMl].filter((v) => v <= product.servingVolumeMl! * 1.5))].sort((a, b) => a - b)
    : [50, 100, 150, 200, 250];

  const save = async () => {
    if (saving) return;
    if (!valid || !amount) {
      toast("Lengkapi data yang ditandai merah dulu.", "error");
      return;
    }
    setSaving(true);
    const takenAt = customTime ? zonedToUtc(editing ? entryDate : date, time, tz).toISOString() : undefined;
    if (editing) {
      const body =
        productId !== OTHER
          ? { productId, amount, unit, takenAt, note }
          : {
              productId: null,
              productName: estimate && !estimate.fromRecord ? estimate.name : otherName.trim() || "Cairan lain",
              volumeMl: amount,
              nutrients: preview?.nutrients ?? {},
              takenAt,
              note,
            };
      const ok = await run(() => api(`/api/intakes/${editing.id}`, { method: "PUT", body }), "Catatan minum diperbarui");
      setSaving(false);
      if (ok) onClose();
      return;
    }
    const ok = await run(async () => {
      if (productId !== OTHER) {
        return api("/api/intakes", { body: { productId, amount, unit, takenAt, note } });
      }
      if (estimate && saveAsProduct) {
        const { product: created } = await api<{ product: Product }>("/api/products", {
          body: {
            name: estimate.name,
            brand: "",
            form: "cair",
            servingLabel: `${estimate.volumeMl} ml (perkiraan)`,
            servingVolumeMl: estimate.volumeMl,
            servingGrams: null,
            preparation: "",
            nutrients: estNutrients,
            notes: ["Perkiraan AI dari nama minuman, bukan dari label.", ...estimate.assumptions].join("\n"),
            source: "estimasi",
            active: true,
          },
        });
        return api("/api/intakes", { body: { productId: created.id, amount, unit: "ml", takenAt, note } });
      }
      return api("/api/intakes", {
        body: {
          productId: null,
          productName: estimate?.name ?? (otherName.trim() || "Cairan lain"),
          volumeMl: amount,
          nutrients: preview?.nutrients,
          takenAt,
          note,
        },
      });
    }, "Asupan tercatat");
    setSaving(false);
    if (ok) setSaved(true);
  };

  const remind = async (minutes: number) => {
    const ok = await remindExec(
      () => api("/api/reminders", { body: { minutes } }),
      `Pengingat diatur ${minutes / 60} jam lagi`,
      "Pengingat gagal diatur",
    );
    if (ok) onClose();
  };

  const remove = async () => {
    if (!editing || !confirm(`Hapus catatan ${editing.productName}?`)) return;
    const ok = await execRemove(() => api(`/api/intakes/${editing.id}`, { method: "DELETE" }), "Catatan minum dihapus", "Gagal menghapus");
    if (ok) onClose();
  };

  if (saved) {
    return (
      <Sheet title="Tercatat ✓" onClose={onClose}>
        <p>Ingatkan untuk minum lagi?</p>
        <div className="grid-2" style={{ marginBottom: 8 }}>
          {[60, 120, 180, 240].map((m) => (
            <ActionButton key={m} className="btn" busy={reminding} busyText="Mengatur…" onClick={() => remind(m)}>
              {m / 60} jam lagi
            </ActionButton>
          ))}
        </div>
        <button className="btn block ghost" onClick={onClose}>
          Tidak perlu (ikuti jadwal)
        </button>
      </Sheet>
    );
  }

  return (
    <Sheet title={editing ? "Ubah catatan minum" : "Catat minum"} onClose={onClose}>
      {editing && (
        <p className="small muted" style={{ marginTop: -4 }}>
          Dicatat oleh {editing.loggedByName ?? "?"}. Ubah yang perlu, lalu simpan.
        </p>
      )}
      <Field label="Produk">
        <div className="chips">
          {products.map((p) => (
            <button key={p.id} type="button" className={`chip ${productId === p.id ? "active" : ""}`} onClick={() => choose(p.id)}>
              {p.name}
            </button>
          ))}
          <button type="button" className={`chip ${productId === OTHER ? "active" : ""}`} onClick={() => choose(OTHER)}>
            Air / cairan lain
          </button>
        </div>
      </Field>
      {products.length === 0 && (
        <p className="small muted">Belum ada produk. Tambahkan Nutrican/Fresubin di menu Produk (bisa dari foto label).</p>
      )}

      {productId === OTHER && (
        <Field
          label="Nama minuman"
          required
          error={errors.otherName}
          hint="Sebutkan cara buatnya bila perlu, mis. “jus mangga tanpa gula”, “air kelapa muda”, “kaldu ayam”."
        >
          <input
            type="text"
            value={otherName}
            onChange={(e) => {
              setOtherName(e.target.value);
              // Kandungan dari catatan lama tetap dipakai walau namanya diubah.
              if (!estimate?.fromRecord) setEstimate(null);
            }}
          />
        </Field>
      )}

      {product && product.servingVolumeMl && (
        <div style={{ marginBottom: 10 }}>
          <Segmented
            value={unit}
            onChange={(u) => {
              setUnit(u);
              setAmount(u === "ml" ? product.servingVolumeMl : 1);
            }}
            options={[
              { value: "ml", label: "Mililiter (ml)" },
              { value: "porsi", label: "Porsi/takaran" },
            ]}
          />
        </div>
      )}

      <Field
        label={unit === "ml" || productId === OTHER ? "Jumlah yang diminum (ml)" : "Jumlah porsi"}
        required
        error={errors.amount}
        hint={
          product
            ? `1 takaran saji: ${product.servingLabel || "–"}${
                product.servingVolumeMl && !product.servingLabel.includes(`${product.servingVolumeMl}`) ? ` (${product.servingVolumeMl} ml)` : ""
              }`
            : undefined
        }
      >
        <NumberInput value={amount} onChange={setAmount} />
      </Field>
      <div className="chips" style={{ marginBottom: 12 }}>
        {(unit === "ml" || productId === OTHER ? quickMl : [0.25, 0.5, 0.75, 1, 1.5]).map((v) => (
          <button key={v} type="button" className={`chip ${amount === v ? "active" : ""}`} onClick={() => setAmount(v)}>
            {unit === "ml" || productId === OTHER ? `${v} ml` : `${fmt(v, 2)} porsi`}
          </button>
        ))}
      </div>

      {productId === OTHER && !estimate && (
        <div style={{ marginBottom: 12 }}>
          <ActionButton
            type="button"
            className="btn block"
            busy={estimating}
            busyText="AI sedang menghitung…"
            disabled={!amount || otherName.trim().length < 2 || !boot.ai.ready}
            onClick={() => setConfirmEstimate(true)}
          >
            Hitung kalori & gizi dengan AI
          </ActionButton>
          <p className="tiny muted" style={{ marginTop: 6 }}>
            Tanpa dihitung, minuman ini dicatat sebagai cairan saja (0 kkal) — cocok untuk air putih atau teh tawar.
          </p>
        </div>
      )}

      {confirmEstimate && (
        <ConfirmDialog
          title="Hitung gizi dengan AI?"
          confirmLabel={similar.length ? "Tetap hitung" : "Kirim ke AI"}
          onCancel={() => setConfirmEstimate(false)}
          onConfirm={() => {
            setConfirmEstimate(false);
            runEstimate();
          }}
        >
          <p>
            “{otherName.trim()}” {amount} ml akan diperkirakan oleh AI.
          </p>
          {similar.length > 0 && (
            <>
              <p>
                <strong style={{ color: "var(--ink)" }}>Sudah ada di daftar produk — pilih saja tanpa AI:</strong>
              </p>
              <div className="chips">
                {similar.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    className="chip"
                    onClick={() => {
                      setConfirmEstimate(false);
                      const keep = amount;
                      choose(p.id);
                      if (keep && p.servingVolumeMl) setAmount(keep);
                    }}
                  >
                    {p.name}
                  </button>
                ))}
              </div>
            </>
          )}
        </ConfirmDialog>
      )}

      {productId === OTHER && estimate && (
        <div className={`banner ${estimate.confidence === "tinggi" ? "info" : "warning"}`}>
          <strong>
            {estimate.fromRecord
              ? `Kandungan dari catatan sebelumnya (untuk ${fmt(estimate.volumeMl)} ml), disesuaikan dengan jumlah baru`
              : `${estimate.name} — perkiraan AI (keyakinan ${estimate.confidence})`}
          </strong>
          {estimate.assumptions.length > 0 && <div className="small secondary">Asumsi: {estimate.assumptions.join("; ")}</div>}
          {estimate.cautions.length > 0 && (
            <ul className="small">
              {estimate.cautions.map((c, i) => (
                <li key={i}>{c}</li>
              ))}
            </ul>
          )}
          <details style={{ marginTop: 6 }}>
            <summary className="small">Koreksi angka (untuk {estimate.volumeMl} ml)</summary>
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
          {!editing && (
            <label className="check">
              <input type="checkbox" checked={saveAsProduct} onChange={(e) => setSaveAsProduct(e.target.checked)} />
              <span className="small">Simpan sebagai produk agar lain kali tinggal dipilih (tanpa AI)</span>
            </label>
          )}
        </div>
      )}

      {preview && (
        <div className="card" style={{ background: "var(--surface-2)" }}>
          <div className="row spread small">
            <span>Energi</span>
            <strong>{fmt(preview.nutrients.energy_kcal)} kkal</strong>
          </div>
          <div className="row spread small">
            <span>Protein</span>
            <strong>{fmt(preview.nutrients.protein_g, 1)} g</strong>
          </div>
          <div className="row spread small">
            <span>Karbohidrat · Lemak</span>
            <span>
              {fmt(preview.nutrients.carb_g, 1)} g · {fmt(preview.nutrients.fat_g, 1)} g
            </span>
          </div>
          <div className="row spread small">
            <span>Cairan</span>
            <span>{fmt(preview.volumeMl)} ml</span>
          </div>
        </div>
      )}

      {editing ? (
        <div className="grid-2">
          <Field label="Tanggal minum" required error={errors.date}>
            <input type="date" value={entryDate} max={todayDate} onChange={(e) => setEntryDate(e.target.value)} />
          </Field>
          <Field label="Jam minum" required error={errors.time}>
            <input type="time" value={time} onChange={(e) => setTime(e.target.value)} />
          </Field>
        </div>
      ) : (
        <>
          <label className="check">
            <input type="checkbox" checked={!customTime} disabled={!isToday} onChange={(e) => setCustomTime(!e.target.checked)} />
            <span>Diminum sekarang{!isToday && " (tidak tersedia — tanggal yang dibuka bukan hari ini)"}</span>
          </label>
          {customTime && (
            <Field label={`Jam minum (${date})`} required error={errors.time}>
              <input type="time" value={time} onChange={(e) => setTime(e.target.value)} />
            </Field>
          )}
        </>
      )}
      <Field label="Catatan (opsional)">
        <input type="text" value={note} placeholder="mis. sisa sedikit, agak mual" onChange={(e) => setNote(e.target.value)} />
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
    </Sheet>
  );
}

const SYMPTOMS = [
  { key: "nausea", label: "Mual" },
  { key: "vomiting", label: "Muntah" },
  { key: "bloating", label: "Begah / cepat kenyang" },
  { key: "diarrhea", label: "Diare" },
  { key: "pain", label: "Nyeri perut" },
] as const;

type SymptomKey = (typeof SYMPTOMS)[number]["key"];

export function SymptomSheet({ onClose }: { onClose: () => void }) {
  const { run } = useApp();
  const [levels, setLevels] = useState<Record<SymptomKey, number>>({ nausea: 0, vomiting: 0, bloating: 0, diarrhea: 0, pain: 0 });
  const [flags, setFlags] = useState<RedFlagKey[]>([]);
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);

  const save = async () => {
    if (saving) return;
    setSaving(true);
    const ok = await run(() => api("/api/symptoms", { body: { ...levels, redFlags: flags, note } }), "Gejala tercatat");
    setSaving(false);
    if (ok) onClose();
  };

  return (
    <Sheet title="Catat gejala" onClose={onClose}>
      <p className="small muted">0 = tidak ada · 1 = ringan · 2 = sedang · 3 = berat</p>
      {SYMPTOMS.map((s) => (
        <div key={s.key} style={{ marginBottom: 10 }}>
          <div className="small" style={{ marginBottom: 4 }}>
            {s.label}
          </div>
          <Segmented
            value={String(levels[s.key])}
            onChange={(v) => setLevels({ ...levels, [s.key]: Number(v) })}
            options={["0", "1", "2", "3"].map((v) => ({ value: v, label: v }))}
          />
        </div>
      ))}
      <h3>Tanda bahaya</h3>
      {RED_FLAGS.map((f) => (
        <label key={f.key} className="check">
          <input
            type="checkbox"
            checked={flags.includes(f.key)}
            onChange={(e) => setFlags(e.target.checked ? [...flags, f.key] : flags.filter((x) => x !== f.key))}
          />
          <span>{f.label}</span>
        </label>
      ))}
      {flags.length > 0 && (
        <div className="banner critical">
          <strong>Segera hubungi dokter atau ke IGD.</strong>
          Gawat darurat: telepon <a href="tel:119">119</a>. Anggota keluarga lain akan menerima notifikasi.
        </div>
      )}
      <Field label="Catatan (opsional)">
        <textarea value={note} onChange={(e) => setNote(e.target.value)} />
      </Field>
      <ActionButton className="btn primary block" busy={saving} attention onClick={save}>
        Simpan
      </ActionButton>
    </Sheet>
  );
}
