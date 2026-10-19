import { useCallback, useEffect, useState } from "react";
import type { Role } from "../shared/types";
import { api, getToken, setToken, setUnauthorizedHandler, type Bootstrap } from "./api";
import { ActionButton, Field, Icon, Segmented, Spinner, requiredError } from "./components/ui";
import { hasUsableProduct, missingPatientData } from "./completeness";
import { NutritionPage } from "./pages/Nutrition";
import { PatientPage } from "./pages/Patient";
import { ProductsPage } from "./pages/Products";
import { SchedulePage } from "./pages/Schedule";
import { TodayPage } from "./pages/Today";
import { isIos, isStandalone } from "./push";
import { AppProvider, useApp } from "./store";

type Tab = "hari" | "nutrisi" | "jadwal" | "produk" | "pasien";

const TABS: { key: Tab; label: string; icon: Parameters<typeof Icon>[0]["name"] }[] = [
  { key: "hari", label: "Hari Ini", icon: "today" },
  { key: "nutrisi", label: "Nutrisi", icon: "chart" },
  { key: "jadwal", label: "Jadwal", icon: "clock" },
  { key: "produk", label: "Produk", icon: "bottle" },
  { key: "pasien", label: "Pasien", icon: "user" },
];

function Login({ onLogin }: { onLogin: () => void }) {
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [role, setRole] = useState<Role>("pendamping");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [tried, setTried] = useState(false);
  const errors = {
    name: requiredError(name, "Isi nama Anda"),
    password: requiredError(password, "Isi kata sandi keluarga"),
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setTried(true);
    if (errors.name || errors.password) {
      setError("Lengkapi data yang ditandai merah.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ token: string }>("/api/login", { body: { password, name: name.trim(), role } });
      setToken(r.token);
      onLogin();
    } catch (err) {
      setError((err as Error).message);
    }
    setBusy(false);
  };

  return (
    <form className="login" onSubmit={submit}>
      <img src="/icons/icon-192.png" alt="" width={64} height={64} style={{ borderRadius: 16 }} />
      <h1>Biya Nutrisi</h1>
      <p className="secondary">Pemantau kecukupan nutrisi diet cair untuk keluarga.</p>
      {isIos() && !isStandalone() && (
        <div className="banner info small">
          Agar bisa menerima pengingat, pasang dulu: tombol <b>Bagikan</b> → <b>Tambahkan ke Layar Utama</b>, lalu buka dari ikon itu dan
          masuk di sana.
        </div>
      )}
      <Field label="Nama Anda" required error={tried ? errors.name : null}>
        <input type="text" autoComplete="nickname" value={name} onChange={(e) => setName(e.target.value)} />
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
      <Field label="Kata sandi keluarga" required error={tried ? errors.password : null}>
        <input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
      </Field>
      {error && (
        <div className="banner critical small" role="alert">
          {error}
        </div>
      )}
      <ActionButton type="submit" className="btn primary block" busy={busy} busyText="Memeriksa…" attention={!errors.name && !errors.password}>
        Masuk
      </ActionButton>
    </form>
  );
}

/** Titik merah di tab yang datanya wajib dilengkapi. */
function TabBar({ tab, setTab }: { tab: Tab; setTab: (t: Tab) => void }) {
  const { boot, targets } = useApp();
  const needs: Partial<Record<Tab, string>> = {};
  const missing = missingPatientData(boot, targets);
  if (missing.length) needs.pasien = `${missing.length} data wajib belum diisi`;
  if (!hasUsableProduct(boot)) needs.produk = "Belum ada produk dengan kandungan gizi";
  return (
    <nav className="tabbar" aria-label="Menu utama">
      <div className="tabbar-inner">
        {TABS.map((t) => (
          <button
            key={t.key}
            className={tab === t.key ? "active" : ""}
            aria-current={tab === t.key}
            aria-label={needs[t.key] ? `${t.label} — ${needs[t.key]}` : undefined}
            onClick={() => setTab(t.key)}
          >
            {needs[t.key] && <span className="tab-dot" aria-hidden />}
            <Icon name={t.icon} />
            {t.label}
          </button>
        ))}
      </div>
    </nav>
  );
}

export function App() {
  const [boot, setBoot] = useState<Bootstrap | null>(null);
  const [state, setState] = useState<"loading" | "login" | "ready" | "error">(getToken() ? "loading" : "login");
  const [error, setError] = useState("");
  const [tab, setTab] = useState<Tab>("hari");

  const logout = useCallback(() => {
    setToken(null);
    setBoot(null);
    setState("login");
  }, []);

  const load = useCallback(async () => {
    setState("loading");
    try {
      setBoot(await api<Bootstrap>("/api/bootstrap"));
      setState("ready");
    } catch (e) {
      if (!getToken()) return;
      setError((e as Error).message);
      setState("error");
    }
  }, []);

  useEffect(() => {
    setUnauthorizedHandler(logout);
    if (getToken()) load();
  }, [load, logout]);

  useEffect(() => {
    window.scrollTo(0, 0);
  }, [tab]);

  if (state === "login") return <Login onLogin={load} />;
  if (state === "error")
    return (
      <div className="login">
        <h1>Tidak bisa memuat</h1>
        <p>{error}</p>
        <button className="btn primary" onClick={load}>
          Coba lagi
        </button>
      </div>
    );
  if (state === "loading" || !boot)
    return (
      <div className="login" style={{ textAlign: "center" }}>
        <Spinner />
      </div>
    );

  return (
    <AppProvider initial={boot} onLogout={logout}>
      <main className="app">
        {tab === "hari" && <TodayPage goTo={(t) => setTab(t)} />}
        {tab === "nutrisi" && <NutritionPage />}
        {tab === "jadwal" && <SchedulePage />}
        {tab === "produk" && <ProductsPage />}
        {tab === "pasien" && <PatientPage />}
      </main>
      <TabBar tab={tab} setTab={setTab} />
    </AppProvider>
  );
}
