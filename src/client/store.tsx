import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { computeTargets, type Targets } from "../shared/targets";
import { localParts } from "../shared/time";
import { api, type Bootstrap, type DayData } from "./api";

interface Toast {
  message: string;
  kind: ToastKind;
}

export type ToastKind = "info" | "success" | "error";

interface AppState {
  boot: Bootstrap;
  day: DayData | null;
  date: string;
  todayDate: string;
  isToday: boolean;
  targets: Targets;
  setDate: (d: string) => void;
  refresh: () => Promise<void>;
  toast: (message: string, kind?: ToastKind) => void;
  /**
   * Menjalankan aksi ke server lalu memuat ulang data. Berhasil → notifikasi
   * hijau `success`; gagal → notifikasi merah "`failure`: alasan".
   * Mengembalikan undefined bila gagal.
   */
  run: <T>(fn: () => Promise<T>, success?: string, failure?: string) => Promise<T | undefined>;
  logout: () => void;
}

const Ctx = createContext<AppState | null>(null);

export function useApp(): AppState {
  const v = useContext(Ctx);
  if (!v) throw new Error("useApp di luar AppProvider");
  return v;
}

const POLL_MS = 20_000;

export function AppProvider({
  initial,
  onLogout,
  children,
}: {
  initial: Bootstrap;
  onLogout: () => void;
  children: ReactNode;
}) {
  const [boot, setBoot] = useState(initial);
  const tz = boot.profile.timezone;
  const [todayDate, setTodayDate] = useState(() => localParts(new Date(), tz).date);
  const [date, setDate] = useState(todayDate);
  const [day, setDay] = useState<DayData | null>(null);
  const [toastState, setToastState] = useState<Toast | null>(null);
  const toastTimer = useRef<number>();
  const dateRef = useRef(date);
  dateRef.current = date;

  const toast = useCallback((message: string, kind: ToastKind = "info") => {
    setToastState({ message, kind });
    window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToastState(null), kind === "error" ? 6000 : 2800);
  }, []);

  const refresh = useCallback(async () => {
    const d = dateRef.current;
    const [b, dd] = await Promise.all([
      api<Bootstrap>("/api/bootstrap"),
      api<DayData>(`/api/day?date=${d}`),
    ]);
    setBoot(b);
    if (dateRef.current === d) setDay(dd);
    setTodayDate(dd.now.date);
  }, []);

  const run = useCallback(
    async <T,>(fn: () => Promise<T>, success?: string, failure = "Gagal menyimpan") => {
      let result: T;
      try {
        result = await fn();
      } catch (e) {
        toast(`${failure}: ${(e as Error).message}`, "error");
        return undefined;
      }
      if (success) toast(success, "success");
      // Data sudah tersimpan; gagal memuat ulang tidak mengubah hasil aksi.
      await refresh().catch(() => {});
      return result;
    },
    [refresh, toast],
  );

  useEffect(() => {
    setDay(null);
    refresh().catch((e) => toast((e as Error).message, "error"));
  }, [date, refresh, toast]);

  // Sinkronisasi antar-HP: muat ulang berkala selama aplikasi terbuka.
  useEffect(() => {
    const tick = () => {
      if (document.visibilityState === "visible") refresh().catch(() => {});
    };
    const id = window.setInterval(tick, POLL_MS);
    document.addEventListener("visibilitychange", tick);
    return () => {
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [refresh]);

  const targets = useMemo(
    () => computeTargets({ profile: boot.profile, weights: boot.weights, labs: boot.labs, today: date }),
    [boot.profile, boot.weights, boot.labs, date],
  );

  const value: AppState = {
    boot,
    day,
    date,
    todayDate,
    isToday: date === todayDate,
    targets,
    setDate,
    refresh,
    toast,
    run,
    logout: onLogout,
  };

  return (
    <Ctx.Provider value={value}>
      {children}
      {toastState && (
        <div
          key={toastState.message + toastState.kind}
          className={`toast ${toastState.kind}`}
          role={toastState.kind === "error" ? "alert" : "status"}
          onClick={() => setToastState(null)}
        >
          {toastState.kind !== "info" && (
            <span className="toast-icon" aria-hidden>
              {toastState.kind === "success" ? "✓" : "✕"}
            </span>
          )}
          <span>{toastState.message}</span>
        </div>
      )}
    </Ctx.Provider>
  );
}

/**
 * Status "sedang diproses" untuk satu tombol: `exec` menolak klik kedua
 * selama aksi sebelumnya belum selesai.
 */
export function useAction() {
  const { run } = useApp();
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const exec = useCallback(
    async <T,>(fn: () => Promise<T>, success?: string, failure?: string) => {
      if (busyRef.current) return undefined;
      busyRef.current = true;
      setBusy(true);
      try {
        return await run(fn, success, failure);
      } finally {
        busyRef.current = false;
        setBusy(false);
      }
    },
    [run],
  );
  return [busy, exec] as const;
}
