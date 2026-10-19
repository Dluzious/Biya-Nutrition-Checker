import { useEffect, useState, type ButtonHTMLAttributes, type ReactNode } from "react";
import { adequacyStatus, STATUS_LABEL, type AdequacyStatus } from "../../shared/intake";

export const fmt = (n: number | null | undefined, digits = 0) =>
  n === null || n === undefined || !Number.isFinite(n)
    ? "–"
    : n.toLocaleString("id-ID", { maximumFractionDigits: digits });

const DAY_NAMES = ["Minggu", "Senin", "Selasa", "Rabu", "Kamis", "Jumat", "Sabtu"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];

export function fmtDate(date: string, withDay = true): string {
  const [y, m, d] = date.split("-").map(Number);
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return `${withDay ? `${DAY_NAMES[dow]}, ` : ""}${d} ${MONTHS[m - 1]} ${y}`;
}

export function fmtShortDate(date: string): string {
  const [, m, d] = date.split("-").map(Number);
  return `${d} ${MONTHS[m - 1]}`;
}

export function fmtTime(iso: string, tz: string): string {
  return new Intl.DateTimeFormat("id-ID", { timeZone: tz, hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
    .format(new Date(iso))
    .replace(".", ":");
}

export function fmtDateTime(iso: string, tz: string): string {
  return new Intl.DateTimeFormat("id-ID", {
    timeZone: tz,
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(new Date(iso));
}

export function fmtIn(minutes: number): string {
  if (minutes <= 0) return "sekarang";
  if (minutes < 60) return `dalam ${minutes} menit`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `dalam ${h} jam${m ? ` ${m} menit` : ""}`;
}

export function Sheet({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose]);
  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet" role="dialog" aria-modal="true" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <div className="sheet-handle" />
        <div className="sheet-head">
          <h2>{title}</h2>
          <button className="btn ghost" onClick={onClose} aria-label="Tutup">
            Tutup
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

/** Dialog konfirmasi di tengah layar, dipakai sebelum mengirim permintaan ke AI. */
export function ConfirmDialog({
  title,
  children,
  confirmLabel = "Kirim ke AI",
  onConfirm,
  onCancel,
}: {
  title: string;
  children: ReactNode;
  confirmLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopImmediatePropagation();
        onCancel();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onCancel]);
  return (
    <div
      className="dialog-backdrop"
      onClick={(e) => {
        e.stopPropagation();
        onCancel();
      }}
    >
      <div className="dialog" role="alertdialog" aria-modal="true" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <h2>{title}</h2>
        <div className="small secondary stack">{children}</div>
        <div className="grid-2" style={{ marginTop: 16 }}>
          <button className="btn" onClick={onCancel}>
            Batal
          </button>
          <button className="btn primary" onClick={onConfirm}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

export function minutesAgo(iso: string): string {
  const m = Math.round((Date.now() - Date.parse(iso)) / 60_000);
  if (m < 1) return "baru saja";
  if (m < 60) return `${m} menit lalu`;
  const h = Math.floor(m / 60);
  return `${h} jam${m % 60 ? ` ${m % 60} menit` : ""} lalu`;
}

const STATUS_STYLE: Record<AdequacyStatus, { color: string; icon: string }> = {
  kurang: { color: "var(--serious)", icon: "▼" },
  hampir: { color: "var(--warning)", icon: "◐" },
  cukup: { color: "var(--good)", icon: "✓" },
  lebih: { color: "var(--accent)", icon: "▲" },
};

export function StatusPill({ status, label }: { status: AdequacyStatus; label?: string }) {
  const s = STATUS_STYLE[status];
  return (
    <span className="status">
      <span className="dot" style={{ background: s.color }} aria-hidden />
      <span aria-hidden>{s.icon}</span>
      {label ?? STATUS_LABEL[status]}
    </span>
  );
}

/** Meter kecukupan: isi = yang sudah masuk, garis tegak = yang seharusnya tercapai pada jam ini. */
export function Meter({
  label,
  value,
  target,
  unit,
  expected,
  sub,
  celebrate,
}: {
  label: string;
  value: number;
  target: number | null | undefined;
  unit: string;
  expected?: number | null;
  sub?: ReactNode;
  /** Baru saja tercapai: jalankan animasi perayaan. */
  celebrate?: boolean;
}) {
  const pct = target ? (value / target) * 100 : null;
  const stage = pct === null ? null : pct >= 100 ? "done" : pct >= NEAR_PCT ? "near" : null;
  const midDay = expected !== null && expected !== undefined && expected > 0 && expected < 1;
  let pill: ReactNode = null;
  if (pct !== null) {
    const status = adequacyStatus(pct);
    if (!midDay || status === "lebih") pill = <StatusPill status={status} />;
    else if (pct < expected! * 100 * 0.8) pill = <StatusPill status="kurang" label="Tertinggal" />;
    else pill = <StatusPill status="cukup" label="Sesuai jadwal" />;
  }
  return (
    <div className={["meter", stage, celebrate && stage === "done" ? "celebrate" : ""].filter(Boolean).join(" ")}>
      <div className="meter-top">
        <span className="meter-label">{label}</span>
        <span className="meter-value">
          <strong>{fmt(value)}</strong>
          <span className="secondary">
            {" "}
            / {target ? fmt(target) : "–"} {unit}
          </span>
        </span>
      </div>
      <div
        className="meter-track"
        role="meter"
        aria-valuemin={0}
        aria-valuemax={target ?? 0}
        aria-valuenow={value}
        aria-label={`${label} ${fmt(value)} dari ${fmt(target)} ${unit}`}
      >
        <div className="meter-fill" style={{ width: `${Math.min(pct ?? 0, 100)}%` }} />
        {midDay && (
          <div className="meter-expected" style={{ left: `calc(${expected! * 100}% - 1px)` }} title="Target sampai jam ini" />
        )}
      </div>
      <div className="meter-foot">
        <span>
          {pct === null ? "Target belum tersedia" : `${fmt(pct)}% dari target`}
          {midDay && ` · seharusnya ±${fmt(expected! * 100)}% jam ini`}
        </span>
        {pill}
      </div>
      {stage === "near" && (
        <div className="meter-cheer" role="status">
          Sedikit lagi! Tinggal {fmt(target! - value)} {unit} lagi 💪
        </div>
      )}
      {stage === "done" && (
        <div className="meter-cheer" role="status">
          Target {label.toLowerCase()} tercapai — hebat! 🎉
        </div>
      )}
      {sub}
    </div>
  );
}

/** Persentase target yang dianggap "hampir tercapai". */
export const NEAR_PCT = 85;

const CONFETTI_COLORS = ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4", "#6250d6"];

/** Hujan konfeti singkat saat target tercapai. */
export function Confetti() {
  const pieces = Array.from({ length: 48 }, (_, i) => ({
    left: Math.random() * 100,
    delay: Math.random() * 0.6,
    duration: 1.8 + Math.random() * 1.2,
    color: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
    rotate: Math.random() * 360,
  }));
  return (
    <div className="confetti" aria-hidden>
      {pieces.map((p, i) => (
        <i
          key={i}
          style={{
            left: `${p.left}%`,
            background: p.color,
            animationDelay: `${p.delay}s`,
            animationDuration: `${p.duration}s`,
            transform: `rotate(${p.rotate}deg)`,
          }}
        />
      ))}
    </div>
  );
}

export function NumberInput({
  value,
  onChange,
  step,
  placeholder,
  min,
}: {
  value: number | null;
  onChange: (v: number | null) => void;
  step?: number;
  placeholder?: string;
  min?: number;
}) {
  const [text, setText] = useState(value === null ? "" : String(value));
  useEffect(() => {
    const parsed = text.trim() === "" ? null : Number(text.replace(",", "."));
    if (parsed !== value) setText(value === null ? "" : String(value));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);
  return (
    <input
      type="text"
      inputMode="decimal"
      value={text}
      placeholder={placeholder}
      step={step}
      min={min}
      onChange={(e) => {
        const t = e.target.value;
        setText(t);
        if (t.trim() === "") onChange(null);
        else {
          const n = Number(t.replace(",", "."));
          if (Number.isFinite(n)) onChange(n);
        }
      }}
    />
  );
}

/**
 * Kolom isian. `required` memberi tanda * merah; `error` (mis. "Wajib diisi")
 * memberi garis merah dan pesan di bawah kolom.
 */
export function Field({
  label,
  children,
  hint,
  required,
  error,
  id,
}: {
  label: string;
  children: ReactNode;
  hint?: ReactNode;
  required?: boolean;
  error?: string | null;
  id?: string;
}) {
  return (
    <label id={id} className={`field${error ? " invalid" : ""}`}>
      <span>
        {label}
        {required && (
          <span className="req" aria-label="wajib">
            *
          </span>
        )}
      </span>
      {children}
      {error && (
        <div className="field-error" role="alert">
          {error}
        </div>
      )}
      {hint && !error && <div className="tiny muted" style={{ marginTop: 4 }}>{hint}</div>}
    </label>
  );
}

/** Pesan bila angka di luar rentang wajar (null bila kosong atau valid). */
export const rangeError = (value: number | null | undefined, min: number, max: number, unit = "") =>
  value === null || value === undefined || (value >= min && value <= max)
    ? null
    : `Harus antara ${min.toLocaleString("id-ID")}–${max.toLocaleString("id-ID")}${unit ? ` ${unit}` : ""}`;

/** Pesan untuk kolom wajib yang kosong. */
export const requiredError = (value: unknown, message = "Wajib diisi") =>
  value === null || value === undefined || (typeof value === "string" && value.trim() === "") ? message : null;

/**
 * Tombol aksi: berdenyut saat `attention`, menampilkan putaran + `busyText`
 * saat `busy`, dan tidak bisa ditekan dua kali.
 */
export function ActionButton({
  busy,
  busyText = "Menyimpan…",
  attention,
  className = "btn primary",
  children,
  disabled,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { busy?: boolean; busyText?: string; attention?: boolean }) {
  const cls = [className, attention && !busy ? "attention" : "", busy ? "busy" : ""].filter(Boolean).join(" ");
  return (
    <button {...rest} className={cls} disabled={disabled || busy} aria-busy={busy || undefined}>
      {busy ? (
        <>
          <Spinner /> {busyText}
        </>
      ) : (
        children
      )}
    </button>
  );
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
}) {
  return (
    <div className="segmented" role="radiogroup">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          className={value === o.value ? "active" : ""}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Spinner() {
  return <span className="spinner" aria-label="Memuat" />;
}

export function Icon({ name }: { name: "today" | "chart" | "clock" | "bottle" | "user" }) {
  const common = { fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  switch (name) {
    case "today":
      return (
        <svg viewBox="0 0 24 24" aria-hidden>
          <path {...common} d="M4 11.5 12 4l8 7.5V20a1 1 0 0 1-1 1h-5v-6h-4v6H5a1 1 0 0 1-1-1z" />
        </svg>
      );
    case "chart":
      return (
        <svg viewBox="0 0 24 24" aria-hidden>
          <path {...common} d="M4 20h16M7 16v-5M12 16V6M17 16v-8" />
        </svg>
      );
    case "clock":
      return (
        <svg viewBox="0 0 24 24" aria-hidden>
          <circle {...common} cx="12" cy="12" r="8.5" />
          <path {...common} d="M12 7.5V12l3 2" />
        </svg>
      );
    case "bottle":
      return (
        <svg viewBox="0 0 24 24" aria-hidden>
          <path {...common} d="M10 3h4v3l2 3v11a1 1 0 0 1-1 1H9a1 1 0 0 1-1-1V9l2-3z" />
          <path {...common} d="M8 13h8" />
        </svg>
      );
    case "user":
      return (
        <svg viewBox="0 0 24 24" aria-hidden>
          <circle {...common} cx="12" cy="8" r="4" />
          <path {...common} d="M4.5 20c1.2-3.6 4-5.5 7.5-5.5s6.3 1.9 7.5 5.5" />
        </svg>
      );
  }
}
