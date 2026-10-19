import { useRef, useState } from "react";
import { NUTRIENTS, type NutrientKey, type NutrientMap } from "../../shared/nutrients";
import type { Product } from "../../shared/types";
import { api } from "../api";
import { ConfirmDialog, Field, NumberInput, Segmented, Sheet, Spinner, fmt } from "../components/ui";
import { prepareImage, type PreparedImage } from "../image";
import { useApp } from "../store";

type ProductDraft = Omit<Product, "id" | "updatedAt"> & { id?: string };

interface AiDraft {
  name: string;
  brand: string;
  form: Product["form"];
  servingLabel: string;
  servingVolumeMl: number | null;
  servingGrams: number | null;
  preparation: string;
  nutrients: NutrientMap;
  notes: string[];
  confidence: "tinggi" | "sedang" | "rendah";
  isNutritionLabel: boolean;
}

const EMPTY: ProductDraft = {
  name: "",
  brand: "",
  form: "cair",
  servingLabel: "",
  servingVolumeMl: null,
  servingGrams: null,
  preparation: "",
  nutrients: {},
  notes: "",
  source: "manual",
  active: true,
};

function ProductEditor({
  initial,
  aiNotes,
  confidence,
  onClose,
}: {
  initial: ProductDraft;
  aiNotes?: string[];
  confidence?: AiDraft["confidence"];
  onClose: () => void;
}) {
  const { run } = useApp();
  const [p, setP] = useState(initial);
  const setNutrient = (key: NutrientKey, v: number | null) => {
    const next = { ...p.nutrients };
    if (v === null) delete next[key];
    else next[key] = v;
    setP({ ...p, nutrients: next });
  };

  const save = async () => {
    if (!p.name.trim()) return;
    const { id, ...body } = p;
    const ok = await run(
      () => (id ? api(`/api/products/${id}`, { method: "PUT", body }) : api("/api/products", { body })),
      "Produk disimpan",
    );
    if (ok) onClose();
  };

  const remove = async () => {
    if (!p.id || !confirm(`Hapus ${p.name}? Riwayat minum tetap tersimpan.`)) return;
    const ok = await run(() => api(`/api/products/${p.id}`, { method: "DELETE" }), "Produk dihapus");
    if (ok) onClose();
  };

  const group = (g: "makro" | "vitamin" | "mineral") =>
    NUTRIENTS.filter((n) => n.group === g).map((n) => (
      <Field key={n.key} label={`${n.label} (${n.unit})`}>
        <NumberInput value={p.nutrients[n.key as NutrientKey] ?? null} onChange={(v) => setNutrient(n.key as NutrientKey, v)} />
      </Field>
    ));

  return (
    <Sheet title={p.id ? "Ubah produk" : "Produk baru"} onClose={onClose}>
      {aiNotes && (
        <div className={`banner ${confidence === "tinggi" ? "info" : "warning"}`}>
          <strong>
            Hasil baca AI — keyakinan {confidence}. Cocokkan dengan label sebelum menyimpan.
          </strong>
          {aiNotes.length > 0 && (
            <ul>
              {aiNotes.map((n, i) => (
                <li key={i}>{n}</li>
              ))}
            </ul>
          )}
        </div>
      )}
      <Field label="Nama produk">
        <input type="text" value={p.name} placeholder="mis. Fresubin 2 kcal Vanilla" onChange={(e) => setP({ ...p, name: e.target.value })} />
      </Field>
      <Field label="Merek / produsen">
        <input type="text" value={p.brand} onChange={(e) => setP({ ...p, brand: e.target.value })} />
      </Field>
      <Field label="Bentuk">
        <Segmented
          value={p.form}
          onChange={(form) => setP({ ...p, form })}
          options={[
            { value: "cair", label: "Cair siap minum" },
            { value: "bubuk", label: "Bubuk" },
            { value: "lainnya", label: "Lainnya" },
          ]}
        />
      </Field>
      <Field label="Takaran saji (seperti di label)">
        <input type="text" value={p.servingLabel} placeholder="mis. 1 botol 200 ml / 6 sendok takar" onChange={(e) => setP({ ...p, servingLabel: e.target.value })} />
      </Field>
      <div className="grid-2">
        <Field label="Volume siap minum (ml)" hint={p.form === "bubuk" ? "Setelah dilarutkan" : undefined}>
          <NumberInput value={p.servingVolumeMl} onChange={(v) => setP({ ...p, servingVolumeMl: v })} />
        </Field>
        <Field label="Berat bubuk (g)">
          <NumberInput value={p.servingGrams} onChange={(v) => setP({ ...p, servingGrams: v })} />
        </Field>
      </div>
      {p.form === "bubuk" && (
        <Field label="Cara penyajian">
          <textarea value={p.preparation} onChange={(e) => setP({ ...p, preparation: e.target.value })} />
        </Field>
      )}
      <h3>Kandungan per 1 takaran saji</h3>
      {group("makro")}
      <details>
        <summary>Vitamin</summary>
        {group("vitamin")}
      </details>
      <details>
        <summary>Mineral</summary>
        {group("mineral")}
      </details>
      <Field label="Catatan">
        <textarea value={p.notes} onChange={(e) => setP({ ...p, notes: e.target.value })} />
      </Field>
      <label className="check">
        <input type="checkbox" checked={p.active} onChange={(e) => setP({ ...p, active: e.target.checked })} />
        <span>Sedang dipakai (tampil saat mencatat minum)</span>
      </label>
      <div className="row" style={{ marginTop: 8 }}>
        <button className="btn primary grow" disabled={!p.name.trim()} onClick={save}>
          Simpan
        </button>
        {p.id && (
          <button className="btn danger" onClick={remove}>
            Hapus
          </button>
        )}
      </div>
    </Sheet>
  );
}

function PhotoSheet({ onDraft, onClose }: { onDraft: (d: AiDraft) => void; onClose: () => void }) {
  const { boot, toast } = useApp();
  const [images, setImages] = useState<PreparedImage[]>([]);
  const [busy, setBusy] = useState<"prep" | "ai" | null>(null);
  const [confirming, setConfirming] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  const add = async (files: FileList | null) => {
    if (!files?.length) return;
    setBusy("prep");
    try {
      const prepared = await Promise.all([...files].slice(0, 4 - images.length).map(prepareImage));
      setImages([...images, ...prepared].slice(0, 4));
    } catch (e) {
      toast((e as Error).message, "error");
    }
    setBusy(null);
  };

  const read = async () => {
    setBusy("ai");
    try {
      const { draft } = await api<{ draft: AiDraft }>("/api/ai/label", {
        body: { images: images.map(({ mediaType, data }) => ({ mediaType, data })) },
      });
      if (!draft.isNutritionLabel) {
        toast("Tabel nilai gizi tidak terlihat di foto. Foto bagian belakang kemasan.", "error");
      } else {
        onDraft(draft);
      }
    } catch (e) {
      toast((e as Error).message, "error");
    }
    setBusy(null);
  };

  return (
    <Sheet title="Foto label produk" onClose={onClose}>
      <p className="small secondary">
        Foto tabel <b>Informasi Nilai Gizi</b> di kemasan (dan petunjuk penyajian untuk produk bubuk). Pastikan terang, tidak silau, dan
        angkanya terbaca. Maksimal 4 foto.
      </p>
      {!boot.ai.ready && <div className="banner warning">API key Anthropic belum diatur di server — fitur ini belum bisa dipakai.</div>}
      <input
        ref={input}
        type="file"
        accept="image/*"
        multiple
        hidden
        onChange={(e) => {
          add(e.target.files);
          e.target.value = "";
        }}
      />
      {images.length > 0 && (
        <div className="photo-grid">
          {images.map((img, i) => (
            <img key={i} src={img.previewUrl} alt={`Foto ${i + 1}`} onClick={() => setImages(images.filter((_, j) => j !== i))} />
          ))}
        </div>
      )}
      {images.length > 0 && <p className="tiny muted">Ketuk foto untuk menghapus.</p>}
      <div className="stack">
        {images.length < 4 && (
          <button className="btn block" disabled={busy !== null} onClick={() => input.current?.click()}>
            {busy === "prep" ? <Spinner /> : images.length ? "+ Tambah foto" : "Ambil / pilih foto"}
          </button>
        )}
        <button className="btn primary block" disabled={!images.length || busy !== null || !boot.ai.ready} onClick={() => setConfirming(true)}>
          {busy === "ai" ? (
            <>
              <Spinner /> Membaca label…
            </>
          ) : (
            "Baca dengan AI"
          )}
        </button>
      </div>
      {confirming && (
        <ConfirmDialog
          title="Baca label dengan AI?"
          onCancel={() => setConfirming(false)}
          onConfirm={() => {
            setConfirming(false);
            read();
          }}
        >
          <p>
            {images.length} foto akan dikirim ke AI (perkiraan biaya USD 0,03–0,07). Pastikan tabel gizinya tajam dan terbaca — foto buram
            membuang biaya dan hasilnya kurang akurat.
          </p>
          <p>Produk yang sudah tersimpan tidak perlu difoto ulang kecuali kemasannya berubah.</p>
        </ConfirmDialog>
      )}
    </Sheet>
  );
}

export function ProductsPage() {
  const { boot } = useApp();
  const [editing, setEditing] = useState<{ draft: ProductDraft; aiNotes?: string[]; confidence?: AiDraft["confidence"] } | null>(null);
  const [photo, setPhoto] = useState(false);

  return (
    <>
      <h1>Produk</h1>
      <div className="grid-2" style={{ marginBottom: 12 }}>
        <button className="btn primary" onClick={() => setPhoto(true)}>
          Foto label (AI)
        </button>
        <button className="btn" onClick={() => setEditing({ draft: EMPTY })}>
          Isi manual
        </button>
      </div>
      {boot.products.length === 0 && (
        <div className="card empty">
          Belum ada produk. Foto label Nutrican dan Fresubin yang sedang dipakai — kandungannya dibaca otomatis lalu bisa Anda periksa.
        </div>
      )}
      {boot.products.map((p) => {
        const kcalPerMl = p.servingVolumeMl && p.nutrients.energy_kcal ? p.nutrients.energy_kcal / p.servingVolumeMl : null;
        return (
          <div
            key={p.id}
            className="card"
            style={{ cursor: "pointer", opacity: p.active ? 1 : 0.55 }}
            onClick={() => {
              const { id, updatedAt: _u, ...rest } = p;
              setEditing({ draft: { ...rest, id } });
            }}
          >
            <div className="card-header">
              <h2>{p.name}</h2>
              <span className="tiny muted">{p.active ? (p.source === "ai" ? "dari foto" : p.source === "estimasi" ? "perkiraan AI" : "manual") : "tidak dipakai"}</span>
            </div>
            <div className="small secondary">
              {[p.brand, p.servingLabel || (p.servingVolumeMl ? `${p.servingVolumeMl} ml` : null)].filter(Boolean).join(" · ")}
            </div>
            <div className="row wrap small" style={{ marginTop: 6, gap: 12 }}>
              <span>
                <strong>{fmt(p.nutrients.energy_kcal)}</strong> kkal
              </span>
              <span>
                <strong>{fmt(p.nutrients.protein_g, 1)}</strong> g protein
              </span>
              <span>
                {fmt(p.nutrients.carb_g, 1)} g karbo · {fmt(p.nutrients.fat_g, 1)} g lemak
              </span>
              {kcalPerMl !== null && <span className="muted">{fmt(kcalPerMl, 2)} kkal/ml</span>}
            </div>
            {!p.servingVolumeMl && p.active && (
              <div className="tiny" style={{ color: "var(--critical)", marginTop: 6 }}>
                Volume siap minum belum diisi — hanya bisa dicatat per porsi.
              </div>
            )}
          </div>
        );
      })}

      {photo && (
        <PhotoSheet
          onClose={() => setPhoto(false)}
          onDraft={(d) => {
            setPhoto(false);
            setEditing({
              draft: {
                ...EMPTY,
                name: d.name,
                brand: d.brand,
                form: d.form,
                servingLabel: d.servingLabel,
                servingVolumeMl: d.servingVolumeMl,
                servingGrams: d.servingGrams,
                preparation: d.preparation,
                nutrients: d.nutrients,
                notes: d.notes.join("\n"),
                source: "ai",
              },
              aiNotes: d.notes,
              confidence: d.confidence,
            });
          }}
        />
      )}
      {editing && (
        <ProductEditor initial={editing.draft} aiNotes={editing.aiNotes} confidence={editing.confidence} onClose={() => setEditing(null)} />
      )}
    </>
  );
}
