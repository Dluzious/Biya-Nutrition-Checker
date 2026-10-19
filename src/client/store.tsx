import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { computeTargets, type Targets } from "../shared/targets";
import { localParts } from "../shared/time";
import { api, type Bootstrap, type DayData } from "./api";

interface Toast {
  message: string;
  kind: "info" | "error";
}

interface AppState {
  boot: Bootstrap;
  day: DayData | null;
  date: string;
  todayDate: string;
  isToday: boolean;
  targets: Targets;
  setDate: (d: string) => void;
  refresh: () => Promise<void>;
  toast: (message: string, kind?: Toast["kind"]) => void;
  run: <T>(fn: () => Promise<T>, success?: string) => Promise<T | undefined>;
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

  const toast = useCallback((message: string, kind: Toast["kind"] = "info") => {
    setToastState({ message, kind });
    window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToastState(null), kind === "error" ? 5000 : 2500);
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
    async <T,>(fn: () => Promise<T>, success?: string) => {
      try {
        const result = await fn();
        await refresh();
        if (success) toast(success);
        return result;
      } catch (e) {
        toast((e as Error).message, "error");
        return undefined;
      }
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
        <div className={`toast ${toastState.kind === "error" ? "error" : ""}`} role="status">
          {toastState.message}
        </div>
      )}
    </Ctx.Provider>
  );
}
