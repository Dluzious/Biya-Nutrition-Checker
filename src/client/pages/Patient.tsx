import { useEffect, useRef, useState } from "react";
import type { TargetLine } from "../../shared/targets";
import { LAB_FIELDS, type LabKey, type PatientProfile, type Role } from "../../shared/types";
import { api } from "../api";
import { ActionButton, Field, NumberInput, Segmented, fmt, fmtDate, fmtDateTime, rangeError, requiredError } from "../components/ui";
import { missingPatientData, refeedingNeedsStartDate, scrollToField } from "../completeness";
import { useAction, useApp } from "../store";

const SOURCE_LABEL = { dokter: "dari dokter", rumus: "dari rumus", batasan: "batasan dokter" } as const;
const REFEEDING_LABEL = { rendah: "Rendah", sedang: "Sedang", tinggi: "Tinggi", sangat_tinggi: "Sangat tinggi" } as const;

function TargetRow({ label, line, unit }: { label: string; line: TargetLine | null; unit: string }) {
  if (!line) {
    return (
      <div className="row spread" style={{ padding: "6px 0" }}>
        <span>{label}</span>
        <span className="muted">belum bisa dihitung</span>
      </div>
    );
  }
  return (
    <details style={{ padding: "4px 0", borderTop: "1px solid var(--hairline)" }}>
      <summary className="row spread" style={{ display: "flex" }}>
        <span>{label}</span>
        <span>
          {fmt(line.target)} {unit} <span className="tiny muted">({SOURCE_LABEL[line.source]})</span>
        </span>
      </summary>
      <div className="small secondary" style={{ padding: "4px 0 6px" }}>
        {line.min !== null && line.max !== null && (
          <div>
            Rentang: {fmt(line.min)}–{fmt(line.max)} {unit}
          </div>
        )}
        {line.basis.map((b, i) => (
          <div key={i}>{b}</div>
        ))}
      </div>
    </details>
  );
}

function TargetsCard() {
  const { targets } = useApp();
  const t = targets;
  return (
    <div className="card">
      <h2>Target harian</h2>
      <div className="grid-2 small" style={{ marginBottom: 10 }}>
        <div>
          <span className="muted">Berat badan</span>
          <div>
            <strong>{fmt(t.weightKg, 1)} kg</strong> {t.weightDate && <span className="tiny muted">({fmtDate(t.weightDate, false)})</span>}
          </div>
        </div>
        <div>
          <span className="muted">IMT</span>
          <div>
            <strong>{fmt(t.bmi, 1)}</strong> {t.bmiCategory && <span className="tiny muted">{t.bmiCategory}</span>}
          </div>
        </div>
        <div>
          <span className="muted">Penurunan BB</span>
          <div>
            {t.weightLoss.pct1m !== null && `1 bln ${fmt(t.weightLoss.pct1m, 1)}% · `}
            {t.weightLoss.pct3m !== null && `3 bln ${fmt(t.weightLoss.pct3m, 1)}% · `}
            {t.weightLoss.pct6m !== null && `6 bln ${fmt(t.weightLoss.pct6m, 1)}% · `}
            {t.weightLoss.fromUsualPct !== null ? `dari BB biasa ${fmt(t.weightLoss.fromUsualPct, 1)}%` : "–"}
          </div>
        </div>
        <div>
          <span className="muted">Risiko refeeding</span>
          <div>
            <strong>{REFEEDING_LABEL[t.refeeding.level]}</strong>
            {t.refeeding.reasons.length > 0 && <div className="tiny muted">{t.refeeding.reasons.join("; ")}</div>}
          </div>
        </div>
      </div>
      <TargetRow label="Energi" line={t.energy} unit="kkal" />
      <TargetRow label="Protein" line={t.protein} unit="g" />
      <TargetRow label="Cairan" line={t.fluid} unit="ml" />
      <p className="tiny muted" style={{ marginTop: 8 }}>
        Ketuk untuk melihat dasar perhitungan. Rumus: ESPEN 2021 (pasien kanker), NICE CG32 (refeeding), AKG 2019. Bila dokter/ahli gizi
        memberi target, isi di bawah — angka dokter selalu dipakai.
      </p>
      {t.warnings.length > 0 && (
        <div className="banner warning" style={{ marginTop: 8, marginBottom: 0 }}>
          <ul style={{ margin: 0 }}>
            {t.warnings.map((w, i) => (
              <li key={i} className="small">
                {w}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function ProfileForm() {
  const { boot, targets, toast } = useApp();
  const [saving, exec] = useAction();
  const [p, setP] = useState<PatientProfile>(boot.profile);
  const dirty = JSON.stringify(p) !== JSON.stringify(boot.profile);
  // Ikuti perubahan dari HP lain selama form ini belum diedit di HP ini.
  const lastSynced = useRef(boot.profile);
  useEffect(() => {
    if (JSON.stringify(p) === JSON.stringify(lastSynced.current)) setP(boot.profile);
    lastSynced.current = boot.profile;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [boot.profile]);
  const set = <K extends keyof PatientProfile>(k: K, v: PatientProfile[K]) => setP({ ...p, [k]: v });
  const setC = <K extends keyof PatientProfile["conditions"]>(k: K, v: PatientProfile["conditions"][K]) =>
    setP({ ...p, conditions: { ...p.conditions, [k]: v } });
  const setD = <K extends keyof PatientProfile["doctorTargets"]>(k: K, v: PatientProfile["doctorTargets"][K]) =>
    setP({ ...p, doctorTargets: { ...p.doctorTargets, [k]: v } });
  const setF = <K extends keyof PatientProfile["factorOverrides"]>(k: K, v: PatientProfile["factorOverrides"][K]) =>
    setP({ ...p, factorOverrides: { ...p.factorOverrides, [k]: v } });

  // Merah = wajib diisi atau angkanya di luar rentang wajar.
  const errors = {
    name: requiredError(p.name, "Isi nama pasien"),
    age: requiredError(p.age, "Isi usia — dipakai untuk target cairan & AKG") ?? rangeError(p.age, 1, 120, "tahun"),
    height: requiredError(p.heightCm, "Isi tinggi badan — dipakai untuk IMT") ?? rangeError(p.heightCm, 80, 230, "cm"),
    usualWeight: rangeError(p.usualWeightKg, 20, 250, "kg"),
    maxVolume: rangeError(p.maxVolumePerSittingMl, 20, 1000, "ml"),
    fluidRestriction: rangeError(p.conditions.fluidRestrictionMl, 300, 6000, "ml"),
    lowIntakeDays: rangeError(p.conditions.lowIntakeDays, 0, 365, "hari"),
    startDate:
      refeedingNeedsStartDate({ ...boot, profile: p }, targets) ? "Wajib diisi karena risiko refeeding tinggi" : null,
    energy: rangeError(p.doctorTargets.energyKcal, 200, 5000, "kkal"),
    protein: rangeError(p.doctorTargets.proteinG, 5, 300, "g"),
    fluid: rangeError(p.doctorTargets.fluidMl, 300, 6000, "ml"),
    kcalPerKg: rangeError(p.factorOverrides.kcalPerKg, 5, 50),
    proteinPerKg: rangeError(p.factorOverrides.proteinPerKg, 0.3, 3),
  };
  // Angka di luar rentang ditolak server; kolom wajib yang kosong tetap boleh disimpan sebagian.
  const blocking = Object.entries(errors).filter(
    ([k, v]) => v && !["name", "startDate"].includes(k) && !(k === "age" && p.age === null) && !(k === "height" && p.heightCm === null),
  );
  const incomplete = Object.values(errors).some(Boolean);

  const save = async () => {
    if (blocking.length) {
      toast("Perbaiki angka yang ditandai merah dulu.", "error");
      return;
    }
    const ok = await exec(
      () => api("/api/profile", { method: "PUT", body: p }),
      incomplete ? "Tersimpan — masih ada data wajib yang kosong (tanda merah)" : "Data pasien disimpan",
    );
    return ok;
  };

  return (
    <div className="card">
      <div className="card-header">
        <h2>Data & kondisi pasien</h2>
      </div>
      {boot.profileMeta && (
        <p className="tiny muted">
          Terakhir diubah {fmtDateTime(boot.profileMeta.updatedAt, boot.profile.timezone)}
          {boot.profileMeta.updatedByName ? ` oleh ${boot.profileMeta.updatedByName}` : ""}
        </p>
      )}
      <Field label="Nama pasien" id="field-name" required error={errors.name}>
        <input type="text" value={p.name} onChange={(e) => set("name", e.target.value)} />
      </Field>
      <Field label="Diagnosis">
        <input type="text" value={p.diagnosis} onChange={(e) => set("diagnosis", e.target.value)} />
      </Field>
      <Field label="Instruksi diet dari dokter">
        <input type="text" value={p.dietOrder} onChange={(e) => set("dietOrder", e.target.value)} />
      </Field>
      <div className="grid-2">
        <Field label="Usia (tahun)" id="field-age" required error={errors.age}>
          <NumberInput value={p.age} onChange={(v) => set("age", v === null ? null : Math.round(v))} />
        </Field>
        <Field label="Tinggi badan (cm)" id="field-height" required error={errors.height}>
          <NumberInput value={p.heightCm} onChange={(v) => set("heightCm", v)} />
        </Field>
      </div>
      <Field label="BB biasa sebelum sakit (kg)" error={errors.usualWeight} hint="Untuk menghitung persentase penurunan berat badan.">
        <NumberInput value={p.usualWeightKg} onChange={(v) => set("usualWeightKg", v)} />
      </Field>
      <Field label="Aktivitas sehari-hari">
        <Segmented
          value={p.activity}
          onChange={(v) => set("activity", v)}
          options={[
            { value: "baring", label: "Banyak berbaring" },
            { value: "terbatas", label: "Terbatas" },
            { value: "aktif", label: "Aktif" },
          ]}
        />
      </Field>
      <Field label="Volume maksimal sekali minum (ml)" error={errors.maxVolume} hint="Berapa banyak yang sanggup diminum tanpa mual/begah.">
        <NumberInput value={p.maxVolumePerSittingMl} onChange={(v) => set("maxVolumePerSittingMl", v)} />
      </Field>

      <h3>Kondisi medis</h3>
      <Field label="Fungsi ginjal">
        <select value={p.conditions.kidney} onChange={(e) => setC("kidney", e.target.value as PatientProfile["conditions"]["kidney"])}>
          <option value="normal">Normal / tidak diketahui ada gangguan</option>
          <option value="ckd">Gangguan ginjal (belum cuci darah)</option>
          <option value="dialisis">Cuci darah (dialisis)</option>
        </select>
      </Field>
      <label className="check">
        <input type="checkbox" checked={p.conditions.diabetes} onChange={(e) => setC("diabetes", e.target.checked)} />
        <span>Diabetes / gula darah tinggi</span>
      </label>
      <Field label="Batas cairan dari dokter (ml/hari)" error={errors.fluidRestriction} hint="Isi bila ada bengkak, cairan di perut, atau gangguan jantung.">
        <NumberInput value={p.conditions.fluidRestrictionMl} onChange={(v) => setC("fluidRestrictionMl", v)} placeholder="tidak ada" />
      </Field>
      <Field label="Terapi yang sedang dijalani">
        <input
          type="text"
          value={p.conditions.therapy}
          placeholder="mis. imunoterapi, kemoterapi, radiasi"
          onChange={(e) => setC("therapy", e.target.value)}
        />
      </Field>
      <Field label="Kondisi / keluhan lain">
        <textarea value={p.conditions.notes} onChange={(e) => setC("notes", e.target.value)} />
      </Field>

      <h3>Risiko refeeding</h3>
      <Field label="Berapa hari makan/minum sangat sedikit sebelum nutrisi dimulai?" error={errors.lowIntakeDays}>
        <NumberInput
          value={p.conditions.lowIntakeDays}
          onChange={(v) => setC("lowIntakeDays", v === null ? null : Math.round(v))}
          placeholder="0"
        />
      </Field>
      <Field
        label="Tanggal mulai nutrisi penuh"
        id="field-startdate"
        required={Boolean(errors.startDate)}
        error={errors.startDate}
        hint="Untuk menaikkan target bertahap bila risikonya tinggi."
      >
        <input
          type="date"
          value={p.conditions.nutritionStartDate ?? ""}
          onChange={(e) => setC("nutritionStartDate", e.target.value || null)}
        />
      </Field>
      <label className="check">
        <input type="checkbox" checked={p.conditions.riskMedication} onChange={(e) => setC("riskMedication", e.target.checked)} />
        <span>Memakai insulin, kemoterapi, antasida, atau diuretik</span>
      </label>
      <Field label="Penilaian risiko">
        <select value={p.conditions.refeeding} onChange={(e) => setC("refeeding", e.target.value as PatientProfile["conditions"]["refeeding"])}>
          <option value="auto">Otomatis dari data (disarankan)</option>
          <option value="rendah">Rendah (ditetapkan dokter)</option>
          <option value="sedang">Sedang (ditetapkan dokter)</option>
          <option value="tinggi">Tinggi (ditetapkan dokter)</option>
          <option value="sangat_tinggi">Sangat tinggi (ditetapkan dokter)</option>
        </select>
      </Field>

      <h3>Target dari dokter / ahli gizi</h3>
      <p className="tiny muted">Bila diisi, menggantikan hasil rumus.</p>
      <div className="grid-2">
        <Field label="Energi (kkal/hari)" error={errors.energy}>
          <NumberInput value={p.doctorTargets.energyKcal} onChange={(v) => setD("energyKcal", v)} />
        </Field>
        <Field label="Protein (g/hari)" error={errors.protein}>
          <NumberInput value={p.doctorTargets.proteinG} onChange={(v) => setD("proteinG", v)} />
        </Field>
      </div>
      <Field label="Cairan (ml/hari)" error={errors.fluid}>
        <NumberInput value={p.doctorTargets.fluidMl} onChange={(v) => setD("fluidMl", v)} />
      </Field>
      <Field label="Catatan dokter">
        <textarea value={p.doctorTargets.note} onChange={(e) => setD("note", e.target.value)} />
      </Field>

      <details>
        <summary>Pengaturan lanjutan</summary>
        <div className="grid-2" style={{ marginTop: 8 }}>
          <Field label="Faktor energi (kkal/kg)" error={errors.kcalPerKg} hint="Kosong = otomatis 25–30">
            <NumberInput value={p.factorOverrides.kcalPerKg} onChange={(v) => setF("kcalPerKg", v)} />
          </Field>
          <Field label="Faktor protein (g/kg)" error={errors.proteinPerKg} hint="Kosong = otomatis">
            <NumberInput value={p.factorOverrides.proteinPerKg} onChange={(v) => setF("proteinPerKg", v)} />
          </Field>
        </div>
        <Field label="Zona waktu">
          <select value={p.timezone} onChange={(e) => set("timezone", e.target.value)}>
            <option value="Asia/Jakarta">WIB (Asia/Jakarta)</option>
            <option value="Asia/Makassar">WITA (Asia/Makassar)</option>
            <option value="Asia/Jayapura">WIT (Asia/Jayapura)</option>
          </select>
        </Field>
      </details>

      {blocking.length > 0 && <p className="field-error">Ada angka di luar rentang wajar (tanda merah).</p>}
      <ActionButton
        className="btn primary block"
        style={{
          marginTop: 12,
          ...(dirty ? { position: "sticky", bottom: "calc(var(--tabbar-h) + env(safe-area-inset-bottom) + 8px)", zIndex: 5 } : {}),
        }}
        busy={saving}
        attention={dirty && blocking.length === 0}
        disabled={!dirty}
        onClick={save}
      >
        {dirty ? "Simpan perubahan" : "Tersimpan ✓"}
      </ActionButton>
    </div>
  );
}

function WeightsCard() {
  const { boot, todayDate, run, toast } = useApp();
  const [saving, exec] = useAction();
  const [date, setDate] = useState(todayDate);
  const [kg, setKg] = useState<number | null>(null);
  const [tried, setTried] = useState(false);
  const errors = {
    date: requiredError(date, "Isi tanggal"),
    kg: requiredError(kg, "Isi berat (kg)") ?? rangeError(kg, 20, 250, "kg"),
  };
  const valid = !errors.date && !errors.kg;
  const add = async () => {
    setTried(true);
    if (!valid) {
      toast("Lengkapi data yang ditandai merah dulu.", "error");
      return;
    }
    const ok = await exec(() => api("/api/weights", { body: { date, kg } }), "Berat badan tercatat");
    if (ok) {
      setKg(null);
      setTried(false);
    }
  };
  const noWeight = boot.weights.length === 0;
  return (
    <div className="card" id="card-weights">
      <h2>
        Berat badan{noWeight && <span className="req">*</span>}
      </h2>
      {noWeight && (
        <p className="field-error" role="alert" style={{ marginBottom: 8 }}>
          Wajib: belum ada catatan berat badan, jadi target kalori & protein belum bisa dihitung.
        </p>
      )}
      <p className="small muted">Timbang 1–2 kali seminggu, pagi hari sebelum minum. Boleh juga isi BB lama (1–6 bulan lalu).</p>
      <div className="row" style={{ alignItems: "flex-start" }}>
        <div style={{ flex: 1.2 }}>
          <Field label="Tanggal" error={tried ? errors.date : null}>
            <input type="date" value={date} max={todayDate} onChange={(e) => setDate(e.target.value)} />
          </Field>
        </div>
        <div style={{ flex: 1 }}>
          <Field label="Berat (kg)" required error={tried || kg !== null ? errors.kg : null}>
            <NumberInput value={kg} onChange={setKg} placeholder="kg" />
          </Field>
        </div>
        <ActionButton className="btn primary" style={{ marginTop: 26 }} busy={saving} busyText="" attention={valid} onClick={add} aria-label="Tambah berat badan">
          +
        </ActionButton>
      </div>
      {boot.weights.length > 0 && (
        <ul className="list" style={{ marginTop: 8 }}>
          {[...boot.weights].reverse().slice(0, 12).map((w) => (
            <li key={w.id}>
              <span className="grow">{fmtDate(w.date)}</span>
              <strong>{fmt(w.kg, 1)} kg</strong>
              <button
                className="btn ghost small"
                aria-label="Hapus"
                onClick={() =>
                  confirm("Hapus catatan berat ini?") &&
                  run(() => api(`/api/weights/${w.id}`, { method: "DELETE" }), "Catatan berat dihapus", "Gagal menghapus")
                }
              >
                ✕
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function LabsCard() {
  const { boot, todayDate, run, toast } = useApp();
  const [saving, exec] = useAction();
  const [open, setOpen] = useState(false);
  const [date, setDate] = useState(todayDate);
  const [values, setValues] = useState<Partial<Record<LabKey, number>>>({});
  const [tried, setTried] = useState(false);
  const clean = Object.fromEntries(Object.entries(values).filter(([, v]) => v !== null && v !== undefined));
  const errors = {
    date: requiredError(date, "Isi tanggal pemeriksaan"),
    values: Object.keys(clean).length === 0 ? "Isi minimal satu hasil lab" : null,
  };
  const add = async () => {
    setTried(true);
    if (errors.date || errors.values) {
      toast("Lengkapi data yang ditandai merah dulu.", "error");
      return;
    }
    const ok = await exec(() => api("/api/labs", { body: { date, values: clean } }), "Hasil lab tersimpan");
    if (ok) {
      setValues({});
      setOpen(false);
      setTried(false);
    }
  };
  return (
    <div className="card">
      <div className="card-header">
        <h2>Hasil lab</h2>
        <button className="btn sm" onClick={() => setOpen(!open)}>
          {open ? "Tutup" : "+ Tambah"}
        </button>
      </div>
      {open && (
        <>
          <Field label="Tanggal pemeriksaan" required error={tried ? errors.date : null}>
            <input type="date" value={date} max={todayDate} onChange={(e) => setDate(e.target.value)} />
          </Field>
          {tried && errors.values && (
            <p className="field-error" role="alert">
              {errors.values}
            </p>
          )}
          <div className={`grid-2${tried && errors.values ? " invalid-group" : ""}`}>
            {LAB_FIELDS.map((f) => (
              <Field key={f.key} label={`${f.label} (${f.unit})`}>
                <NumberInput
                  value={values[f.key] ?? null}
                  onChange={(v) => setValues({ ...values, [f.key]: v === null ? undefined : v })}
                />
              </Field>
            ))}
          </div>
          <ActionButton className="btn primary block" busy={saving} attention={!errors.values} onClick={add}>
            Simpan hasil lab
          </ActionButton>
        </>
      )}
      {boot.labs.length === 0 && !open && <div className="empty">Belum ada. Kalium, fosfat, dan magnesium penting untuk menilai risiko refeeding.</div>}
      {boot.labs.slice(0, 5).map((l) => (
        <div key={l.id} style={{ borderTop: "1px solid var(--hairline)", padding: "8px 0" }}>
          <div className="row spread">
            <strong className="small">{fmtDate(l.date)}</strong>
            <button
              className="btn ghost small"
              aria-label="Hapus"
              onClick={() =>
                confirm("Hapus hasil lab ini?") &&
                run(() => api(`/api/labs/${l.id}`, { method: "DELETE" }), "Hasil lab dihapus", "Gagal menghapus")
              }
            >
              ✕
            </button>
          </div>
          <div className="small secondary">
            {LAB_FIELDS.filter((f) => l.values[f.key] !== undefined)
              .map((f) => `${f.label} ${fmt(l.values[f.key], 2)}`)
              .join(" · ")}
          </div>
        </div>
      ))}
    </div>
  );
}

function AccountCard() {
  const { boot, logout } = useApp();
  const [saving, exec] = useAction();
  const [name, setName] = useState(boot.me.name);
  const [role, setRole] = useState<Role>(boot.me.role);
  return (
    <div className="card">
      <h2>Anggota keluarga</h2>
      <ul className="list small">
        {boot.members.map((m) => (
          <li key={m.id}>
            <span className="grow">
              {m.name}
              {m.id === boot.me.id && " (Anda)"}
            </span>
            <span className="muted">{m.role}</span>
          </li>
        ))}
      </ul>
      <p className="tiny muted">Anggota lain cukup membuka alamat aplikasi yang sama dan masuk dengan kata sandi keluarga.</p>
      <div className="divider" />
      <Field label="Nama Anda" required error={requiredError(name, "Isi nama Anda")}>
        <input type="text" value={name} onChange={(e) => setName(e.target.value)} />
      </Field>
      <Field label="Peran">
        <Segmented
          value={role}
          onChange={setRole}
          options={[
            { value: "pasien", label: "Pasien" },
            { value: "pendamping", label: "Pendamping" },
          ]}
        />
      </Field>
      <div className="row">
        <ActionButton
          className="btn primary grow"
          busy={saving}
          attention={Boolean(name.trim()) && (name.trim() !== boot.me.name || role !== boot.me.role)}
          disabled={!name.trim() || (name.trim() === boot.me.name && role === boot.me.role)}
          onClick={() => exec(() => api("/api/me", { method: "PUT", body: { name: name.trim(), role } }), "Akun Anda disimpan")}
        >
          Simpan
        </ActionButton>
        <button className="btn danger" onClick={() => confirm("Keluar dari aplikasi di HP ini?") && logout()}>
          Keluar
        </button>
      </div>
    </div>
  );
}

function MissingDataBanner() {
  const { boot, targets } = useApp();
  const missing = missingPatientData(boot, targets);
  if (!missing.length) return null;
  return (
    <div className="banner critical" role="alert">
      <strong>Data wajib belum lengkap ({missing.length})</strong>
      Ketuk untuk langsung ke kolomnya:
      <div className="chips" style={{ marginTop: 8 }}>
        {missing.map((m) => (
          <button key={m.id} type="button" className="chip" onClick={() => scrollToField(m.id)}>
            {m.label}
          </button>
        ))}
      </div>
    </div>
  );
}

export function PatientPage() {
  return (
    <>
      <h1>Pasien</h1>
      <MissingDataBanner />
      <TargetsCard />
      <WeightsCard />
      <ProfileForm />
      <LabsCard />
      <AccountCard />
      <p className="tiny muted" style={{ textAlign: "center", margin: "16px 8px" }}>
        Aplikasi ini membantu pemantauan, bukan pengganti dokter. Data dan foto yang dianalisis AI dikirim ke Anthropic.
      </p>
    </>
  );
}
