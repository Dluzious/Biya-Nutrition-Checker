import { useMemo, useState } from "react";
import { intakeFromProduct } from "../../shared/intake";
import { localParts, zonedToUtc } from "../../shared/time";
import { RED_FLAGS, type IntakeUnit, type RedFlagKey } from "../../shared/types";
import { api } from "../api";
import { useApp } from "../store";
import { Field, NumberInput, Segmented, Sheet, fmt } from "./ui";

export interface IntakePrefill {
  productId: string;
  amount: number;
  unit: IntakeUnit;
}

const OTHER = "__other__";

export function LogIntakeSheet({ prefill, onClose }: { prefill?: IntakePrefill; onClose: () => void }) {
  const { boot, date, isToday, run } = useApp();
  const tz = boot.profile.timezone;
  const products = boot.products.filter((p) => p.active);
  const first = prefill ? products.find((p) => p.id === prefill.productId) : products[0];

  const [productId, setProductId] = useState<string>(first?.id ?? OTHER);
  const product = products.find((p) => p.id === productId);
  const [unit, setUnit] = useState<IntakeUnit>(prefill?.unit ?? (first?.servingVolumeMl ? "ml" : "porsi"));
  const [amount, setAmount] = useState<number | null>(
    prefill?.amount ?? (first?.servingVolumeMl ? first.servingVolumeMl : 1),
  );
  const [otherName, setOtherName] = useState("Air putih");
  const [customTime, setCustomTime] = useState(!isToday);
  const [time, setTime] = useState(() => (isToday ? localParts(new Date(), tz).time : "12:00"));
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const preview = useMemo(() => {
    if (!product || !amount) return null;
    try {
      return intakeFromProduct(product, amount, unit);
    } catch {
      return null;
    }
  }, [product, amount, unit]);

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

  const quickMl = product?.servingVolumeMl
    ? [...new Set([50, 100, 150, 200, product.servingVolumeMl].filter((v) => v <= product.servingVolumeMl! * 1.5))].sort((a, b) => a - b)
    : [50, 100, 150, 200, 250];

  const save = async () => {
    if (!amount) return;
    setSaving(true);
    const takenAt = customTime ? zonedToUtc(date, time, tz).toISOString() : undefined;
    const ok = await run(
      () =>
        api("/api/intakes", {
          body:
            productId === OTHER
              ? { productId: null, productName: otherName || "Cairan lain", volumeMl: amount, takenAt, note }
              : { productId, amount, unit, takenAt, note },
        }),
      "Asupan tercatat",
    );
    setSaving(false);
    if (ok) setSaved(true);
  };

  const remind = async (minutes: number) => {
    await run(() => api("/api/reminders", { body: { minutes } }), `Pengingat diatur ${minutes / 60} jam lagi`);
    onClose();
  };

  if (saved) {
    return (
      <Sheet title="Tercatat ✓" onClose={onClose}>
        <p>Ingatkan untuk minum lagi?</p>
        <div className="grid-2" style={{ marginBottom: 8 }}>
          {[60, 120, 180, 240].map((m) => (
            <button key={m} className="btn" onClick={() => remind(m)}>
              {m / 60} jam lagi
            </button>
          ))}
        </div>
        <button className="btn block ghost" onClick={onClose}>
          Tidak perlu (ikuti jadwal)
        </button>
      </Sheet>
    );
  }

  return (
    <Sheet title="Catat minum" onClose={onClose}>
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
        <Field label="Nama cairan" hint="Dihitung sebagai cairan saja (tanpa kalori).">
          <input type="text" value={otherName} onChange={(e) => setOtherName(e.target.value)} />
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

      <label className="check">
        <input type="checkbox" checked={!customTime} disabled={!isToday} onChange={(e) => setCustomTime(!e.target.checked)} />
        <span>Diminum sekarang{!isToday && " (tidak tersedia — tanggal yang dibuka bukan hari ini)"}</span>
      </label>
      {customTime && (
        <Field label={`Jam minum (${date})`}>
          <input type="time" value={time} onChange={(e) => setTime(e.target.value)} />
        </Field>
      )}
      <Field label="Catatan (opsional)">
        <input type="text" value={note} placeholder="mis. sisa sedikit, agak mual" onChange={(e) => setNote(e.target.value)} />
      </Field>
      <button className="btn primary block" disabled={saving || !amount} onClick={save}>
        {saving ? "Menyimpan…" : "Simpan"}
      </button>
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
      <button className="btn primary block" disabled={saving} onClick={save}>
        {saving ? "Menyimpan…" : "Simpan"}
      </button>
    </Sheet>
  );
}
