import { useCallback, useEffect, useMemo, useState } from "react";
import { adherence, dailySlots, daysUntil, type DoseSlot } from "../../shared/meds";
import { weekStart } from "../../shared/progress";
import { addDays, localParts } from "../../shared/time";
import type { MedKind, Medication } from "../../shared/types";
import { api, type MedsData } from "../api";
import { ActionButton, Field, NumberInput, Segmented, Sheet, Spinner, fmtDate, fmtShortDate, fmtTime, rangeError, requiredError } from "../components/ui";
import { useAction, useApp } from "../store";

const HISTORY_DAYS = 180;

function countdown(today: string, date: string): { text: string; urgent: boolean } {
  const d = daysUntil(today, date);
  if (d < 0) return { text: `Lewat ${-d} hari`, urgent: true };
  if (d === 0) return { text: "Hari ini", urgent: true };
  if (d === 1) return { text: "Besok", urgent: true };
  if (d <= 2) return { text: `${d} hari lagi`, urgent: true };
  if (d <= 7) return { text: `${d} hari lagi`, urgent: false };
  return { text: `dalam ${d} hari`, urgent: false };
}

const STATE_LABEL: Record<DoseSlot["state"], { text: string; color: string }> = {
  diminum: { text: "✓ Diminum", color: "var(--good-text)" },
  dilewati: { text: "Dilewati", color: "var(--muted)" },
  terlewat: { text: "Terlewat", color: "var(--critical)" },
  sekarang: { text: "Sekarang", color: "var(--accent)" },
  nanti: { text: "Nanti", color: "var(--muted)" },
};

function DoseRow({ slot, date, onChange }: { slot: DoseSlot; date: string; onChange: () => Promise<void> }) {
  const { boot, run } = useApp();
  const [busy, setBusy] = useState<null | "diminum" | "dilewati" | "undo">(null);
  const label = STATE_LABEL[slot.state];
  const act = async (status: "diminum" | "dilewati") => {
    setBusy(status);
    await run(
      () => api(`/api/meds/${slot.med.id}/logs`, { body: { scheduledDate: date, scheduledTime: slot.time, status } }),
      status === "diminum" ? `${slot.med.name} ${slot.time} tercatat diminum 💊` : `${slot.med.name} ${slot.time} ditandai dilewati`,
    );
    await onChange();
    setBusy(null);
  };
  const undo = async () => {
    if (!slot.log || !confirm("Batalkan catatan obat ini?")) return;
    setBusy("undo");
    await run(() => api(`/api/meds/logs/${slot.log!.id}`, { method: "DELETE" }), "Catatan obat dibatalkan", "Gagal membatalkan");
    await onChange();
    setBusy(null);
  };
  return (
    <li style={{ alignItems: "flex-start" }}>
      <span className="time-badge">{slot.time}</span>
      <div className="grow">
        <div>
          <strong>{slot.med.name}</strong> {slot.med.dose && <span className="secondary">· {slot.med.dose}</span>}
        </div>
        {slot.med.instructions && <div className="small muted">{slot.med.instructions}</div>}
        <div className="small" style={{ color: label.color, fontWeight: 600 }}>
          {label.text}
          {slot.log && (
            <span className="muted" style={{ fontWeight: 400 }}>
              {" "}
              · {fmtTime(slot.log.takenAt, boot.profile.timezone)} oleh {slot.log.loggedByName ?? "?"}
            </span>
          )}
        </div>
        {!slot.log && (
          <div className="row" style={{ marginTop: 6 }}>
            <ActionButton
              className="btn primary sm"
              busy={busy === "diminum"}
              busyText="…"
              attention={slot.state === "sekarang" || slot.state === "terlewat"}
              disabled={busy !== null}
              onClick={() => act("diminum")}
            >
              ✓ Sudah diminum
            </ActionButton>
            <ActionButton className="btn sm ghost" busy={busy === "dilewati"} busyText="…" disabled={busy !== null} onClick={() => act("dilewati")}>
              Lewati
            </ActionButton>
          </div>
        )}
      </div>
      {slot.log && (
        <button className="btn ghost small" aria-label="Batalkan" disabled={busy !== null} onClick={undo}>
          ✕
        </button>
      )}
    </li>
  );
}

function PeriodicCard({ med, today, onEdit, onChange }: { med: Medication; today: string; onEdit: () => void; onChange: () => Promise<void> }) {
  const [done, exec] = useAction();
  const cd = med.nextDate ? countdown(today, med.nextDate) : null;
  const markDone = async () => {
    const scheduledDate = med.nextDate && med.nextDate <= today ? med.nextDate : today;
    const nextMsg = med.intervalDays ? ` Jadwal berikutnya: ${fmtShortDate(addDays(scheduledDate, med.intervalDays))}.` : " Atur tanggal jadwal berikutnya.";
    if (!confirm(`Tandai ${med.name} sudah dilakukan (${fmtShortDate(scheduledDate)})?${nextMsg}`)) return;
    const ok = await exec(
      () => api(`/api/meds/${med.id}/logs`, { body: { scheduledDate, scheduledTime: null, status: "diminum", advance: true } }),
      `${med.name} tercatat sudah dilakukan 💊`,
    );
    await onChange();
    if (ok && !med.intervalDays) onEdit();
  };
  return (
    <div className="card" style={{ marginBottom: 10 }}>
      <div className="card-header">
        <h2>{med.name}</h2>
        {cd && (
          <span className="status" style={cd.urgent ? { background: "var(--critical-wash)", color: "var(--critical)" } : undefined}>
            {cd.text}
          </span>
        )}
      </div>
      {med.dose && <p className="small secondary">{med.dose}</p>}
      <p>
        {med.nextDate ? (
          <>
            📅 <strong>{fmtDate(med.nextDate)}</strong>
            {med.nextTime && ` · ${med.nextTime}`}
            {med.location && <span className="secondary"> · {med.location}</span>}
          </>
        ) : (
          <span className="field-error">Tanggal jadwal berikutnya belum diisi</span>
        )}
      </p>
      <p className="tiny muted">
        {med.intervalDays ? `Tiap ${med.intervalDays} hari. ` : ""}Pengingat otomatis H-7, H-2, dan hari H pukul 08.00.
        {med.instructions ? ` ${med.instructions}` : ""}
      </p>
      <div className="row">
        <ActionButton
          className="btn primary sm"
          busy={done}
          attention={Boolean(cd && cd.urgent)}
          disabled={!med.nextDate}
          onClick={markDone}
        >
          ✓ Sudah dilakukan
        </ActionButton>
        <button className="btn sm" onClick={onEdit}>
          Ubah jadwal
        </button>
      </div>
    </div>
  );
}

type Draft = Omit<Medication, "id" | "startDate" | "updatedAt"> & { id?: string };

const EMPTY: Draft = {
  name: "",
  dose: "",
  kind: "harian",
  times: ["08:00"],
  instructions: "",
  nextDate: null,
  nextTime: null,
  intervalDays: 28,
  location: "",
  active: true,
  notes: "",
};

const TIME_PRESETS = [
  { label: "1×/hari", times: ["08:00"] },
  { label: "2×/hari", times: ["08:00", "20:00"] },
  { label: "3×/hari", times: ["07:00", "13:00", "19:00"] },
];

function MedSheet({ initial, onClose }: { initial: Draft; onClose: () => void }) {
  const { toast } = useApp();
  const [saving, exec] = useAction();
  const [removing, execRemove] = useAction();
  const [m, setM] = useState(initial);
  const errors = {
    name: requiredError(m.name, "Isi nama obat"),
    times: m.kind === "harian" && m.times.length === 0 ? "Tambahkan minimal 1 jam minum" : null,
    timeEmpty: m.kind === "harian" && m.times.some((t) => !t) ? "Isi semua jam" : null,
    nextDate: m.kind === "berkala" ? requiredError(m.nextDate, "Isi tanggal jadwal berikutnya") : null,
    interval: m.kind === "berkala" ? rangeError(m.intervalDays, 1, 365, "hari") : null,
  };
  const valid = Object.values(errors).every((e) => !e);

  const save = async () => {
    if (!valid) {
      toast("Lengkapi data yang ditandai merah dulu.", "error");
      return;
    }
    const { id, ...body } = m;
    const payload = {
      ...body,
      times: m.kind === "harian" ? m.times : [],
      nextDate: m.kind === "berkala" ? m.nextDate : null,
      nextTime: m.kind === "berkala" ? m.nextTime || null : null,
      intervalDays: m.kind === "berkala" ? m.intervalDays : null,
    };
    const ok = await exec(
      () => (id ? api(`/api/meds/${id}`, { method: "PUT", body: payload }) : api("/api/meds", { body: payload })),
      `Obat “${m.name.trim()}” disimpan`,
    );
    if (ok) onClose();
  };

  const remove = async () => {
    if (!m.id || !confirm(`Hapus ${m.name}? Riwayat minum obatnya tetap tersimpan.`)) return;
    const ok = await execRemove(() => api(`/api/meds/${m.id}`, { method: "DELETE" }), "Obat dihapus", "Gagal menghapus");
    if (ok) onClose();
  };

  return (
    <Sheet title={m.id ? "Ubah obat" : "Tambah obat"} onClose={onClose}>
      <Field label="Nama obat" required error={errors.name}>
        <input type="text" value={m.name} placeholder="mis. Ondansetron / Imunoterapi" onChange={(e) => setM({ ...m, name: e.target.value })} />
      </Field>
      <Field label="Jenis">
        <Segmented<MedKind>
          value={m.kind}
          onChange={(kind) => setM({ ...m, kind })}
          options={[
            { value: "harian", label: "Harian" },
            { value: "berkala", label: "Berkala / bulanan" },
          ]}
        />
      </Field>
      <div className="grid-2">
        <Field label="Dosis">
          <input type="text" value={m.dose} placeholder="mis. 1 tablet 8 mg" onChange={(e) => setM({ ...m, dose: e.target.value })} />
        </Field>
        <Field label="Aturan pakai">
          <input type="text" value={m.instructions} placeholder="mis. sesudah makan" onChange={(e) => setM({ ...m, instructions: e.target.value })} />
        </Field>
      </div>

      {m.kind === "harian" ? (
        <>
          <Field label="Jam minum" required error={errors.times ?? errors.timeEmpty}>
            <div className="stack">
              {m.times.map((t, i) => (
                <div key={i} className="row">
                  <input
                    type="time"
                    value={t}
                    onChange={(e) => setM({ ...m, times: m.times.map((x, j) => (j === i ? e.target.value : x)) })}
                  />
                  <button type="button" className="btn ghost small" aria-label="Hapus jam" onClick={() => setM({ ...m, times: m.times.filter((_, j) => j !== i) })}>
                    ✕
                  </button>
                </div>
              ))}
            </div>
          </Field>
          <div className="chips" style={{ marginBottom: 12 }}>
            <button type="button" className="chip" onClick={() => setM({ ...m, times: [...m.times, "12:00"] })}>
              + Tambah jam
            </button>
            {TIME_PRESETS.map((p) => (
              <button key={p.label} type="button" className="chip" onClick={() => setM({ ...m, times: p.times })}>
                {p.label}
              </button>
            ))}
          </div>
        </>
      ) : (
        <>
          <div className="grid-2">
            <Field label="Tanggal berikutnya" required error={errors.nextDate}>
              <input type="date" value={m.nextDate ?? ""} onChange={(e) => setM({ ...m, nextDate: e.target.value || null })} />
            </Field>
            <Field label="Jam (opsional)">
              <input type="time" value={m.nextTime ?? ""} onChange={(e) => setM({ ...m, nextTime: e.target.value || null })} />
            </Field>
          </div>
          <Field label="Jarak antar jadwal (hari)" error={errors.interval} hint="Untuk menghitung jadwal berikutnya otomatis. Kosongkan bila tidak tetap.">
            <NumberInput value={m.intervalDays} onChange={(v) => setM({ ...m, intervalDays: v === null ? null : Math.round(v) })} />
          </Field>
          <div className="chips" style={{ marginBottom: 12 }}>
            {[7, 14, 21, 28, 30, 42].map((d) => (
              <button key={d} type="button" className={`chip ${m.intervalDays === d ? "active" : ""}`} onClick={() => setM({ ...m, intervalDays: d })}>
                {d === 30 ? "Bulanan (30)" : `${d} hari`}
              </button>
            ))}
          </div>
          <Field label="Tempat (opsional)">
            <input type="text" value={m.location} placeholder="mis. RS … poli onkologi" onChange={(e) => setM({ ...m, location: e.target.value })} />
          </Field>
          <p className="tiny muted">Pengingat dikirim H-7, H-2, dan pagi hari H (pukul 08.00).</p>
        </>
      )}

      <Field label="Catatan">
        <textarea value={m.notes} onChange={(e) => setM({ ...m, notes: e.target.value })} />
      </Field>
      <label className="check">
        <input type="checkbox" checked={m.active} onChange={(e) => setM({ ...m, active: e.target.checked })} />
        <span>Aktif (tampil & kirim pengingat)</span>
      </label>
      {!valid && <p className="field-error">Lengkapi data yang ditandai merah.</p>}
      <div className="row" style={{ marginTop: 8 }}>
        <ActionButton className="btn primary grow" busy={saving} attention={valid} onClick={save}>
          Simpan
        </ActionButton>
        {m.id && (
          <ActionButton className="btn danger" busy={removing} busyText="Menghapus…" onClick={remove}>
            Hapus
          </ActionButton>
        )}
      </div>
    </Sheet>
  );
}

function AdherenceHistory({ data, today, nowMinutes }: { data: MedsData; today: string; nowMinutes: number }) {
  const [mode, setMode] = useState<"harian" | "mingguan" | "bulanan">("harian");
  const daily = data.medications.filter((m) => m.kind === "harian");
  const periodicLogs = data.logs.filter((l) => l.scheduledTime === null).reverse();
  if (!daily.length && !periodicLogs.length) return null;

  const rows: { label: string; a: ReturnType<typeof adherence> }[] = [];
  if (mode === "harian") {
    for (let i = 0; i < 7; i++) {
      const d = addDays(today, -i);
      rows.push({ label: i === 0 ? "Hari ini" : fmtDate(d), a: adherence(daily, data.logs, d, d, today, nowMinutes) });
    }
  } else if (mode === "mingguan") {
    for (let i = 0; i < 8; i++) {
      const start = addDays(weekStart(today), -7 * i);
      const end = addDays(start, 6);
      rows.push({ label: `${fmtShortDate(start)}–${fmtShortDate(end)}`, a: adherence(daily, data.logs, start, end, today, nowMinutes) });
    }
  } else {
    let monthStart = `${today.slice(0, 7)}-01`;
    for (let i = 0; i < 6; i++) {
      const next = addDays(monthStart, 32).slice(0, 7) + "-01";
      const end = addDays(next, -1);
      const [y, mo] = monthStart.split("-");
      const label = new Intl.DateTimeFormat("id-ID", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(Date.UTC(+y, +mo - 1, 1)));
      rows.push({ label, a: adherence(daily, data.logs, monthStart, end, today, nowMinutes) });
      monthStart = addDays(monthStart, -1).slice(0, 7) + "-01";
    }
  }
  const last7 = adherence(daily, data.logs, addDays(today, -6), today, today, nowMinutes);
  const last30 = adherence(daily, data.logs, addDays(today, -29), today, today, nowMinutes);

  return (
    <div className="card">
      <h2>Riwayat & kepatuhan</h2>
      {daily.length > 0 && (
        <>
          <div className="grid-2" style={{ margin: "6px 0 10px" }}>
            {[
              { label: "7 hari terakhir", a: last7 },
              { label: "30 hari terakhir", a: last30 },
            ].map(({ label, a }) => (
              <div key={label} className="card" style={{ margin: 0, background: "var(--surface-2)" }}>
                <div className="small muted">{label}</div>
                <div style={{ fontSize: "1.6rem", fontWeight: 650 }}>{a.pct === null ? "–" : `${a.pct}%`}</div>
                <div className="tiny muted">
                  {a.taken}/{a.due} dosis diminum{a.missed ? ` · ${a.missed} terlewat` : ""}
                </div>
              </div>
            ))}
          </div>
          <Segmented
            value={mode}
            onChange={setMode}
            options={[
              { value: "harian", label: "Harian" },
              { value: "mingguan", label: "Mingguan" },
              { value: "bulanan", label: "Bulanan" },
            ]}
          />
          <table className="nutrients" style={{ marginTop: 8 }}>
            <thead>
              <tr>
                <th>{mode === "harian" ? "Tanggal" : mode === "mingguan" ? "Minggu" : "Bulan"}</th>
                <th>Diminum</th>
                <th>Terlewat</th>
                <th>%</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ label, a }) => (
                <tr key={label}>
                  <td>{label}</td>
                  <td>
                    {a.taken}/{a.due}
                  </td>
                  <td style={a.missed ? { color: "var(--critical)", fontWeight: 600 } : undefined}>{a.missed || "–"}</td>
                  <td>{a.pct === null ? "–" : `${a.pct}%`}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="tiny muted" style={{ marginTop: 6 }}>
            Obat harian saja. "Terlewat" = dosis yang sudah lewat waktunya tanpa catatan; "Lewati" yang disengaja tidak dihitung terlewat.
          </p>
        </>
      )}
      {periodicLogs.length > 0 && (
        <>
          <h3>Riwayat obat berkala</h3>
          <ul className="list small">
            {periodicLogs.slice(0, 12).map((l) => (
              <li key={l.id}>
                <span className="grow">
                  {fmtDate(l.scheduledDate)} — <strong>{l.medName}</strong>
                </span>
                <span className="muted">{l.status === "diminum" ? "✓ dilakukan" : "dilewati"}</span>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

export function MedsPage() {
  const { boot, todayDate, refresh } = useApp();
  const tz = boot.profile.timezone;
  const [data, setData] = useState<MedsData | null>(null);
  const [date, setDate] = useState(todayDate);
  const [editing, setEditing] = useState<Draft | null>(null);

  const load = useCallback(async () => {
    try {
      setData(await api<MedsData>(`/api/meds?from=${addDays(todayDate, -HISTORY_DAYS)}&to=${todayDate}`));
    } catch {
      setData((d) => d ?? { medications: [], logs: [], now: localParts(new Date(), tz) });
    }
  }, [todayDate, tz]);
  useEffect(() => {
    load();
  }, [load]);

  const afterChange = useCallback(async () => {
    await load();
    await refresh().catch(() => {});
  }, [load, refresh]);

  const nowMinutes = localParts(new Date(), tz).minutes;
  const dayNow = date === todayDate ? nowMinutes : date < todayDate ? 24 * 60 : -1;
  const slots = useMemo(() => (data ? dailySlots(data.medications, data.logs, date, dayNow) : []), [data, date, dayNow]);
  const periodic = (data?.medications ?? [])
    .filter((m) => m.active && m.kind === "berkala")
    .sort((a, b) => (a.nextDate ?? "9999") < (b.nextDate ?? "9999") ? -1 : 1);
  const inactive = (data?.medications ?? []).filter((m) => !m.active);
  const open = (m: Medication) => {
    const { startDate: _s, updatedAt: _u, ...rest } = m;
    setEditing(rest);
  };

  if (!data) {
    return (
      <>
        <h1>Obat</h1>
        <div className="empty">
          <Spinner />
        </div>
      </>
    );
  }

  const takenToday = slots.filter((s) => s.state === "diminum").length;

  return (
    <>
      <div className="row spread">
        <h1>Obat</h1>
        <button className="btn primary sm" onClick={() => setEditing(EMPTY)}>
          + Tambah obat
        </button>
      </div>

      {data.medications.length === 0 && (
        <div className="card empty">
          Belum ada obat. Tambahkan obat harian (mis. antimual 3×/hari) atau jadwal berkala (mis. imunoterapi tiap 3–4 minggu) — pengingatnya akan
          dikirim ke HP.
        </div>
      )}

      {data.medications.some((m) => m.kind === "harian") && (
        <div className="card">
          <div className="card-header">
            <h2>Obat harian</h2>
            <span className="small muted">
              {takenToday}/{slots.length} diminum
            </span>
          </div>
          <div className="row spread" style={{ marginBottom: 6 }}>
            <button className="btn ghost sm" aria-label="Hari sebelumnya" onClick={() => setDate(addDays(date, -1))}>
              ‹
            </button>
            <strong className="small">{date === todayDate ? "Hari ini" : fmtDate(date)}</strong>
            <button className="btn ghost sm" aria-label="Hari berikutnya" disabled={date >= todayDate} onClick={() => setDate(addDays(date, 1))}>
              ›
            </button>
          </div>
          {slots.length === 0 ? (
            <div className="empty">Tidak ada jadwal obat harian pada tanggal ini.</div>
          ) : (
            <ul className="list">
              {slots.map((s) => (
                <DoseRow key={`${s.med.id}-${s.time}`} slot={s} date={date} onChange={afterChange} />
              ))}
            </ul>
          )}
          <p className="tiny muted" style={{ marginTop: 6 }}>
            Notifikasi dikirim tepat di jam minum; pendamping diberi tahu bila {boot.profile.missedAlertMinutes} menit kemudian belum tercatat.
          </p>
        </div>
      )}

      {periodic.length > 0 && (
        <>
          <h2 style={{ margin: "16px 0 8px" }}>Jadwal berkala / bulanan</h2>
          {periodic.map((m) => (
            <PeriodicCard key={m.id} med={m} today={todayDate} onEdit={() => open(m)} onChange={afterChange} />
          ))}
        </>
      )}

      <AdherenceHistory data={data} today={todayDate} nowMinutes={nowMinutes} />

      {data.medications.filter((m) => m.active).length > 0 && (
        <div className="card">
          <h2>Daftar obat</h2>
          <ul className="list">
            {data.medications
              .filter((m) => m.active)
              .map((m) => (
                <li key={m.id} className="intake-row" onClick={() => open(m)}>
                  <div className="grow">
                    <div>
                      <strong>{m.name}</strong> {m.dose && <span className="secondary">· {m.dose}</span>}
                    </div>
                    <div className="small muted">
                      {m.kind === "harian" ? `Harian · ${m.times.join(", ")}` : `Berkala · ${m.nextDate ? fmtShortDate(m.nextDate) : "tanggal belum diisi"}`}
                      {m.instructions && ` · ${m.instructions}`}
                    </div>
                  </div>
                  <span className="muted">✎</span>
                </li>
              ))}
          </ul>
          {inactive.length > 0 && (
            <details style={{ marginTop: 8 }}>
              <summary className="small">Tidak aktif ({inactive.length})</summary>
              <ul className="list small">
                {inactive.map((m) => (
                  <li key={m.id} className="intake-row" onClick={() => open(m)}>
                    <span className="grow muted">{m.name}</span>
                    <span className="muted">✎</span>
                  </li>
                ))}
              </ul>
            </details>
          )}
        </div>
      )}

      <p className="tiny muted" style={{ textAlign: "center", margin: "12px 8px" }}>
        Aplikasi hanya mengingatkan & mencatat. Dosis dan jadwal obat mengikuti resep dokter.
      </p>

      {editing && (
        <MedSheet
          initial={editing}
          onClose={() => {
            setEditing(null);
            afterChange();
          }}
        />
      )}
    </>
  );
}
