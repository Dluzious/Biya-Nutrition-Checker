import type {
  Evaluation,
  Intake,
  LabEntry,
  Member,
  PatientProfile,
  Product,
  PushPrefs,
  ScheduleItem,
  SymptomEntry,
  WeightEntry,
} from "../shared/types";
import type { LocalParts } from "../shared/time";
import type { NutrientMap } from "../shared/nutrients";

const TOKEN_KEY = "biya.token";

export function getToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setToken(token: string | null) {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    // Penyimpanan diblokir (mode privat): sesi hanya bertahan selama halaman terbuka.
  }
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

let onUnauthorized: () => void = () => {};
export function setUnauthorizedHandler(fn: () => void) {
  onUnauthorized = fn;
}

export async function api<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const token = getToken();
  let res: Response;
  try {
    res = await fetch(path, {
      method: init.method ?? (init.body ? "POST" : "GET"),
      headers: {
        ...(init.body !== undefined ? { "Content-Type": "application/json" } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
    });
  } catch {
    throw new ApiError(0, "Tidak ada koneksi internet.");
  }
  const data = (await res.json().catch(() => ({}))) as { error?: string };
  if (!res.ok) {
    if (res.status === 401 && path !== "/api/login") onUnauthorized();
    throw new ApiError(res.status, data.error ?? `Gagal (${res.status}).`);
  }
  return data as T;
}

export interface Bootstrap {
  me: Member;
  members: Member[];
  profile: PatientProfile;
  profileMeta: { updatedAt: string; updatedByName: string | null } | null;
  products: Product[];
  schedule: ScheduleItem[];
  weights: WeightEntry[];
  labs: LabEntry[];
  vapidPublicKey: string;
  ai: { ready: boolean; model: string };
  /** Waktu terakhir server memeriksa jadwal pengingat (ISO), null bila belum pernah. */
  cronHeartbeat: string | null;
  serverTime: string;
}

export interface PendingReminder {
  id: string;
  dueAt: string;
  message: string;
  createdByName: string | null;
}

export interface DayData {
  date: string;
  now: LocalParts;
  intakes: Intake[];
  symptoms: SymptomEntry[];
  evaluations: Evaluation[];
  reminders: PendingReminder[];
}

export interface HistoryDay {
  date: string;
  count: number;
  volumeMl: number;
  nutrients: NutrientMap;
  maxSymptom: number;
  redFlags: boolean;
}

export interface Device {
  endpoint: string;
  device: string;
  prefs: PushPrefs;
  memberName: string;
}
