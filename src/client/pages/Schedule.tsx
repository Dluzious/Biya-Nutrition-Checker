import { useCallback, useEffect, useState } from "react";
import { slotDone } from "../../shared/intake";
import { localParts, minutesToTime, timeToMinutes } from "../../shared/time";
import type { PushPrefs, ScheduleItem } from "../../shared/types";
import { api, type Device } from "../api";
import { Field, NumberInput, Sheet, Spinner, fmt } from "../components/ui";
import { currentSubscription, deviceName, pushSupport, subscribePush, subscriptionBody } from "../push";
import { useApp } from "../store";

const PREF_LABELS: { key: keyof PushPrefs; label: string; hint: string }[] = [
  { key: "reminders", label: "Pengingat jadwal minum", hint: "Muncul tepat di jam jadwal" },
  { key: "missed", label: "Jadwal terlewat", hint: "Bila belum ada catatan minum setelah jadwal" },
  { key: "alerts", label: "Tanda bahaya", hint: "Bila ada gejala berbahaya yang dicatat" },
  { key: "activity", label: "Aktivitas minum", hint: "Setiap ada catatan minum dari anggota lain" },
];

function NotificationCard() {
  const { boot, toast } = useApp();
  const support = pushSupport();
  const [sub, setSub] = useState<PushSubscription | null>(null);
  const [devices, setDevices] = useState<Device[]>([]);
  const [busy, setBusy] = useState(false);
  const [checked, setChecked] = useState(false);

  const load = useCallback(async () => {
    const [s, d] = await Promise.all([
      currentSubscription().catch(() => null),
      api<{ devices: Device[] }>("/api/push/devices").catch(() => ({ devices: [] })),
    ]);
    setSub(s);
    setDevices(d.devices);
    setChecked(true);
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  const mine = sub ? devices.find((d) => d.endpoint === sub.endpoint) : undefined;

  const enable = async () => {
    setBusy(true);
    try {
      const s = await subscribePush(boot.vapidPublicKey);
      await api("/api/push/subscribe", {
        body: { ...subscriptionBody(s), device: `${deviceName()} · ${boot.me.name}`, prefs: mine?.prefs },
      });
      toast("Notifikasi aktif di HP ini");
      await load();
    } catch (e) {
      toast((e as Error).message, "error");
    }
    setBusy(false);
  };

  const disable = async () => {
    if (!sub) return;
    setBusy(true);
    await api("/api/push/unsubscribe", { body: { endpoint: sub.endpoint } }).catch(() => {});
    await sub.unsubscribe().catch(() => {});
    await load();
    setBusy(false);
  };

  const setPref = async (key: keyof PushPrefs, value: boolean) => {
    if (!sub || !mine) return;
    const prefs = { ...mine.prefs, [key]: value };
    try {
      await api("/api/push/prefs", { method: "PUT", body: { endpoint: sub.endpoint, prefs } });
      await load();
    } catch (e) {
      toast((e as Error).message, "error");
    }
  };

  const test = async () => {
    if (!sub) return;
    try {
      const r = await api<{ sent: number }>("/api/push/test", { body: { endpoint: sub.endpoint } });
      toast(r.sent ? "Notifikasi tes dikirim" : "Gagal mengirim, coba aktifkan ulang", r.sent ? "info" : "error");
    } catch (e) {
      toast((e as Error).message, "error");
    }
  };

  return (
    <div className="card">
      <div className="card-header">
        <h2>Notifikasi di HP ini</h2>
        {!checked && <Spinner />}
      </div>
      {support === "need-install" && (
        <div className="banner warning">
          <strong>Pasang aplikasi dulu</strong>
          Di Safari, tekan tombol <b>Bagikan</b> (kotak dengan panah ke atas) → <b>Tambahkan ke Layar Utama</b>. Buka aplikasi dari ikon
          di Layar Utama, masuk lagi, lalu aktifkan notifikasi di sini. (Butuh iOS 16.4 atau lebih baru.)
        </div>
      )}
      {support === "unsupported" && <p className="small">Browser ini tidak mendukung notifikasi push.</p>}
      {support === "ok" && !mine && (
        <>
          <p className="small secondary">Aktifkan agar HP ini menerima pengingat minum dan peringatan.</p>
          <button className="btn primary block" disabled={busy} onClick={enable}>
            {busy ? "Mengaktifkan…" : "Aktifkan notifikasi"}
          </button>
        </>
      )}
      {support === "ok" && mine && (
        <>
          {PREF_LABELS.map((p) => (
            <label key={p.key} className="check">
              <input type="checkbox" checked={mine.prefs[p.key]} onChange={(e) => setPref(p.key, e.target.checked)} />
              <span>
                {p.label}
                <div className="tiny muted">{p.hint}</div>
              </span>
            </label>
          ))}
          <div className="row" style={{ marginTop: 6 }}>
            <button className="btn sm" onClick={test}>
              Kirim tes
            </button>
            <button className="btn sm ghost danger" disabled={busy} onClick={disable}>
              Matikan
            </button>
          </div>
          <p className="tiny muted" style={{ marginTop: 8 }}>
            Pastikan mode Fokus/Jangan Ganggu di iPhone tidak memblokir notifikasi aplikasi ini.
          </p>
        </>
      )}
      {devices.length > 0 && (
        <>
          <div className="divider" />
          <div className="small muted" style={{ marginBottom: 4 }}>
            Perangkat terdaftar
          </div>
          <ul className="list small">
            {devices.map((d) => (
              <li key={d.endpoint}>
                <span className="grow">{d.device || d.memberName}</span>
                <span className="muted tiny">
                  {PREF_LABELS.filter((p) => d.prefs[p.key])
                    .map((p) => p.label.split(" ")[0])
                    .join(", ") || "tidak ada"}
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

type Draft = Omit<ScheduleItem, "id"> & { id?: string };

function ScheduleSheet({ draft, onClose }: { draft: Draft; onClose: () => void }) {
  const { boot, run } = useApp();
  const [d, setD] = useState(draft);
  const products = boot.products.filter((p) => p.active);
  const save = async () => {
    const ok = await run(
      () => (d.id ? api(`/api/schedule/${d.id}`, { method: "PUT", body: d }) : api("/api/schedule", { body: d })),
      "Jadwal disimpan",
    );
    if (ok) onClose();
  };
  return (
    <Sheet title={d.id ? "Ubah jadwal" : "Tambah jadwal"} onClose={onClose}>
      <Field label="Jam">
        <input type="time" value={d.time} onChange={(e) => setD({ ...d, time: e.target.value })} />
      </Field>
      <Field label="Label (opsional)">
        <input type="text" value={d.label} placeholder="mis. Pagi, Sebelum tidur" onChange={(e) => setD({ ...d, label: e.target.value })} />
      </Field>
      <Field label="Produk">
        <select value={d.productId ?? ""} onChange={(e) => setD({ ...d, productId: e.target.value || null })}>
          <option value="">Bebas / disarankan aplikasi</option>
          {products.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Rencana jumlah (ml)">
        <NumberInput value={d.plannedMl} onChange={(v) => setD({ ...d, plannedMl: v })} placeholder="kosongkan bila bebas" />
      </Field>
      <label className="check">
        <input type="checkbox" checked={d.enabled} onChange={(e) => setD({ ...d, enabled: e.target.checked })} />
        <span>Aktif (kirim pengingat)</span>
      </label>
      <div className="row" style={{ marginTop: 8 }}>
        <button className="btn primary grow" onClick={save}>
          Simpan
        </button>
        {d.id && (
          <button
            className="btn danger"
            onClick={async () => {
              if (!confirm("Hapus jadwal ini?")) return;
              const ok = await run(() => api(`/api/schedule/${d.id}`, { method: "DELETE" }), "Jadwal dihapus");
              if (ok) onClose();
            }}
          >
            Hapus
          </button>
        )}
      </div>
    </Sheet>
  );
}

function GeneratorSheet({ onClose }: { onClose: () => void }) {
  const { boot, targets, run } = useApp();
  const products = boot.products.filter((p) => p.active && p.servingVolumeMl && p.nutrients.energy_kcal);
  const [count, setCount] = useState<number | null>(6);
  const [start, setStart] = useState("07:00");
  const [end, setEnd] = useState("21:00");
  const [productId, setProductId] = useState(products[0]?.id ?? "");
  const [replace, setReplace] = useState(boot.schedule.length > 0);
  const product = products.find((p) => p.id === productId);

  const times = (() => {
    const c = Math.max(1, Math.min(count ?? 1, 12));
    const a = timeToMinutes(start);
    const b = timeToMinutes(end);
    if (c === 1 || b <= a) return [start];
    return Array.from({ length: c }, (_, i) => minutesToTime(Math.round((a + ((b - a) * i) / (c - 1)) / 15) * 15));
  })();

  const perSlotMl =
    product && targets.energy
      ? Math.round(targets.energy.target / times.length / (product.nutrients.energy_kcal! / product.servingVolumeMl!) / 10) * 10
      : null;
  const maxVol = boot.profile.maxVolumePerSittingMl ?? 200;

  const generate = async () => {
    const ok = await run(async () => {
      if (replace) for (const s of boot.schedule) await api(`/api/schedule/${s.id}`, { method: "DELETE" });
      for (const t of times) {
        await api("/api/schedule", {
          body: { time: t, label: "", productId: productId || null, plannedMl: perSlotMl, enabled: true },
        });
      }
      return true;
    }, "Jadwal dibuat");
    if (ok) onClose();
  };

  return (
    <Sheet title="Buat jadwal otomatis" onClose={onClose}>
      <div className="grid-2">
        <Field label="Mulai">
          <input type="time" value={start} onChange={(e) => setStart(e.target.value)} />
        </Field>
        <Field label="Selesai">
          <input type="time" value={end} onChange={(e) => setEnd(e.target.value)} />
        </Field>
      </div>
      <Field label="Berapa kali minum per hari">
        <NumberInput value={count} onChange={setCount} />
      </Field>
      <Field label="Produk utama">
        <select value={productId} onChange={(e) => setProductId(e.target.value)}>
          {products.length === 0 && <option value="">Belum ada produk dengan kandungan & volume</option>}
          {products.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </Field>
      <div className="card" style={{ background: "var(--surface-2)" }}>
        <div className="small">
          Jam: <strong>{times.join(", ")}</strong>
        </div>
        {perSlotMl !== null && (
          <div className="small" style={{ marginTop: 4 }}>
            ±<strong>{perSlotMl} ml</strong> tiap kali minum untuk mencapai {fmt(targets.energy?.target)} kkal/hari.
            {perSlotMl > maxVol && (
              <div style={{ color: "var(--critical)", marginTop: 4 }}>
                Melebihi batas {maxVol} ml sekali minum — tambah jumlah jadwal.
              </div>
            )}
          </div>
        )}
      </div>
      {boot.schedule.length > 0 && (
        <label className="check">
          <input type="checkbox" checked={replace} onChange={(e) => setReplace(e.target.checked)} />
          <span>Ganti semua jadwal yang ada ({boot.schedule.length})</span>
        </label>
      )}
      <button className="btn primary block" onClick={generate}>
        Buat {times.length} jadwal
      </button>
    </Sheet>
  );
}

export function SchedulePage() {
  const { boot, day, todayDate, run } = useApp();
  const [editing, setEditing] = useState<Draft | null>(null);
  const todayIntakeMinutes =
    day && day.date === todayDate ? day.intakes.map((i) => localParts(new Date(i.takenAt), boot.profile.timezone).minutes) : null;
  const [generator, setGenerator] = useState(false);
  const [missed, setMissed] = useState<number | null>(boot.profile.missedAlertMinutes);

  const productName = (id: string | null) => boot.products.find((p) => p.id === id)?.name;

  return (
    <>
      <h1>Jadwal & Pengingat</h1>
      <NotificationCard />

      <div className="card">
        <div className="card-header">
          <h2>Jadwal minum</h2>
          <button className="btn sm" onClick={() => setGenerator(true)}>
            Otomatis
          </button>
        </div>
        {boot.schedule.length === 0 ? (
          <div className="empty">Belum ada jadwal. Buat otomatis dari target, atau tambah satu per satu.</div>
        ) : (
          <ul className="list">
            {boot.schedule.map((s) => (
              <li key={s.id} onClick={() => setEditing(s)} style={{ cursor: "pointer", opacity: s.enabled ? 1 : 0.5 }}>
                <span className="time-badge">{s.time}</span>
                <div className="grow">
                  <div>{[productName(s.productId) ?? "Produk bebas", s.plannedMl ? `${s.plannedMl} ml` : null].filter(Boolean).join(" · ")}</div>
                  <div className="small muted">
                    {s.label || " "}
                    {!s.enabled && " (nonaktif)"}
                    {s.enabled && todayIntakeMinutes && slotDone(timeToMinutes(s.time), todayIntakeMinutes) && (
                      <span style={{ color: "var(--good-text)" }}> ✓ sudah diminum hari ini</span>
                    )}
                  </div>
                </div>
                <span className="muted">›</span>
              </li>
            ))}
          </ul>
        )}
        <button
          className="btn block"
          style={{ marginTop: 8 }}
          onClick={() => setEditing({ time: "08:00", label: "", productId: null, plannedMl: null, enabled: true })}
        >
          + Tambah jadwal
        </button>
      </div>

      <div className="card">
        <h2>Peringatan jadwal terlewat</h2>
        <p className="small secondary">
          Pendamping diberi tahu bila belum ada catatan minum sekian menit setelah jam jadwal.
        </p>
        <div className="row">
          <div className="grow">
            <NumberInput value={missed} onChange={setMissed} />
          </div>
          <span>menit</span>
          <button
            className="btn"
            disabled={!missed || missed === boot.profile.missedAlertMinutes}
            onClick={() =>
              run(
                () => api("/api/profile", { method: "PUT", body: { ...boot.profile, missedAlertMinutes: Math.round(missed!) } }),
                "Tersimpan",
              )
            }
          >
            Simpan
          </button>
        </div>
      </div>

      {editing && <ScheduleSheet draft={editing} onClose={() => setEditing(null)} />}
      {generator && <GeneratorSheet onClose={() => setGenerator(false)} />}
    </>
  );
}
