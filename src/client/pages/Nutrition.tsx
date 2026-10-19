import { useEffect, useMemo, useState } from "react";
import { adequacyStatus, sumIntakes } from "../../shared/intake";
import { NUTRIENTS, NUTRIENT_BY_KEY, type NutrientKey } from "../../shared/nutrients";
import { MET_THRESHOLD, summarizePeriods, type DayPoint, type PeriodSummary } from "../../shared/progress";
import { computeTargets } from "../../shared/targets";
import type { Evaluation } from "../../shared/types";
import { api, type HistoryDay } from "../api";
import { LineChart } from "../components/charts";
import { EvaluationCard } from "../components/EvaluationCard";
import { Segmented, StatusPill, fmt, fmtDate, fmtShortDate } from "../components/ui";
import { useApp } from "../store";

interface Row {
  label: string;
  unit: string;
  /** null = tidak tercantum di label produk yang diminum. */
  value: number | null;
  target: number | null;
  note?: string;
}

function NutrientTable({ rows }: { rows: Row[] }) {
  return (
    <table className="nutrients">
      <thead>
        <tr>
          <th>Zat gizi</th>
          <th>Masuk</th>
          <th>Target</th>
          <th style={{ width: 90 }}>%</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => {
          const pct = r.target && r.value !== null ? (r.value / r.target) * 100 : null;
          return (
            <tr key={r.label}>
              <td>
                {r.label}
                {r.note && <div className="tiny muted">{r.note}</div>}
              </td>
              <td>
                {r.value === null ? (
                  <span className="muted" title="Tidak tercantum di label">
                    ?
                  </span>
                ) : (
                  <>
                    {fmt(r.value, r.value < 10 ? 1 : 0)} <span className="muted">{r.unit}</span>
                  </>
                )}
              </td>
              <td className="secondary">{r.target ? fmt(r.target, r.target < 10 ? 1 : 0) : "–"}</td>
              <td>
                {pct === null ? (
                  <span className="muted">–</span>
                ) : (
                  <div className="row" style={{ gap: 6, justifyContent: "flex-end" }}>
                    <div className="mini-bar grow">
                      <i style={{ width: `${Math.min(pct, 100)}%` }} />
                    </div>
                    <span style={{ minWidth: 34 }}>{fmt(pct)}</span>
                  </div>
                )}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

type ProgressMode = "harian" | "mingguan" | "bulanan";

const PERIOD_WORDS = {
  mingguan: { current: "Minggu ini", previous: "minggu lalu", count: 12, days: 84 },
  bulanan: { current: "Bulan ini", previous: "bulan lalu", count: 6, days: 186 },
} as const;

function useDayPoints(days: number, to: string): DayPoint[] | null {
  const { boot, day } = useApp();
  const [history, setHistory] = useState<HistoryDay[] | null>(null);
  useEffect(() => {
    setHistory(null);
    api<{ days: HistoryDay[] }>(`/api/history?days=${days}&to=${to}`)
      .then((r) => setHistory(r.days))
      .catch(() => setHistory([]));
  }, [days, to, day?.intakes.length]);
  return useMemo(() => {
    if (!history) return null;
    return history.map((d) => {
      const t = computeTargets({ profile: boot.profile, weights: boot.weights, labs: boot.labs, today: d.date });
      const pct = (v: number | undefined, target: number | undefined) => (target ? ((v ?? 0) / target) * 100 : null);
      return {
        date: d.date,
        count: d.count,
        energyPct: pct(d.nutrients.energy_kcal, t.energy?.target),
        proteinPct: pct(d.nutrients.protein_g, t.protein?.target),
        fluidPct: pct(d.volumeMl, t.fluid?.target),
        energyKcal: d.nutrients.energy_kcal ?? 0,
        proteinG: d.nutrients.protein_g ?? 0,
      };
    });
  }, [history, boot.profile, boot.weights, boot.labs]);
}

/** Kalimat ringkas + penyemangat dari perbandingan periode ini dengan sebelumnya. */
function progressMessage(current: PeriodSummary | undefined, previous: PeriodSummary | undefined, mode: "mingguan" | "bulanan") {
  const words = PERIOD_WORDS[mode];
  if (!current || current.daysLogged === 0) {
    return { text: `${words.current} belum ada catatan minum.`, cheer: "Yuk mulai catat setiap kali minum — sedikit pun berarti. 💪" };
  }
  const e = current.avgEnergyPct;
  const p = current.avgProteinPct;
  const parts = [
    `${words.current} rata-rata energi ${e === null ? "–" : `${fmt(e)}%`}, protein ${p === null ? "–" : `${fmt(p)}%`} dari target`,
  ];
  let delta: number | null = null;
  if (previous && previous.daysLogged > 0 && e !== null && previous.avgEnergyPct !== null) {
    delta = e - previous.avgEnergyPct;
    parts.push(`(${delta >= 0 ? "naik" : "turun"} ${fmt(Math.abs(delta))} poin dari ${words.previous})`);
  }
  let cheer: string;
  if (e !== null && e >= MET_THRESHOLD && (p ?? 0) >= MET_THRESHOLD) cheer = "Luar biasa, target terpenuhi! Pertahankan ya 🎉";
  else if (delta !== null && delta >= 3) cheer = "Ada kemajuan nyata — terus semangat, sedikit demi sedikit! 💪";
  else if (delta !== null && delta <= -3) cheer = "Tidak apa-apa, hari yang berat itu wajar. Ayo kita naikkan pelan-pelan lagi. 🤍";
  else cheer = "Setiap tegukan berarti — semangat terus! 💪";
  return { text: `${parts.join(" ")}.`, cheer };
}

function PeriodProgress({ mode }: { mode: "mingguan" | "bulanan" }) {
  const { todayDate } = useApp();
  const words = PERIOD_WORDS[mode];
  const points = useDayPoints(words.days, todayDate);
  const [view, setView] = useState<"grafik" | "tabel">("grafik");
  const periods = useMemo(
    () => (points ? summarizePeriods(points, mode === "mingguan" ? "week" : "month", todayDate).slice(-words.count) : null),
    [points, mode, todayDate, words.count],
  );
  if (!periods) return <div className="empty">Memuat…</div>;
  const logged = periods.filter((p) => p.daysLogged > 0);
  if (!logged.length) return <div className="empty">Belum ada catatan minum pada periode ini.</div>;
  const current = periods[periods.length - 1];
  const previous = periods[periods.length - 2];
  const msg = progressMessage(current, previous, mode);
  const label = (p: PeriodSummary) => `${p.label}${p.partial ? "*" : ""}`;
  return (
    <>
      <p className="small">{msg.text}</p>
      <p className="cheer small">{msg.cheer}</p>
      <div className="row spread" style={{ margin: "8px 0 6px" }}>
        <div className="legend">
          <span>
            <i style={{ background: "var(--series-1)" }} />
            Energi
          </span>
          <span>
            <i style={{ background: "var(--series-2)" }} />
            Protein
          </span>
        </div>
        <Segmented
          value={view}
          onChange={setView}
          options={[
            { value: "grafik", label: "Grafik" },
            { value: "tabel", label: "Tabel" },
          ]}
        />
      </div>
      {view === "grafik" ? (
        <LineChart
          series={[
            { key: "e", label: "Energi", color: "var(--series-1)", values: periods.map((p) => (p.daysLogged ? p.avgEnergyPct : null)) },
            { key: "p", label: "Protein", color: "var(--series-2)", values: periods.map((p) => (p.daysLogged ? p.avgProteinPct : null)) },
          ]}
          xLabels={periods.map(label)}
          tooltipTitles={periods.map(
            (p) => `${p.label}${p.partial ? " (berjalan)" : ""} · ${p.daysLogged} hari tercatat`,
          )}
          unit="%"
          refLine={{ value: 100, label: "Target 100%" }}
          yMaxHint={120}
        />
      ) : (
        <table className="nutrients">
          <thead>
            <tr>
              <th>{mode === "mingguan" ? "Minggu" : "Bulan"}</th>
              <th>Energi</th>
              <th>Protein</th>
              <th>Hari tercapai</th>
            </tr>
          </thead>
          <tbody>
            {[...periods].reverse().map((p) => (
              <tr key={p.key}>
                <td>{label(p)}</td>
                <td>
                  {p.avgEnergyPct === null ? "–" : `${fmt(p.avgEnergyPct)}%`}
                  <div className="tiny muted">{p.avgEnergyKcal === null ? "" : `${fmt(p.avgEnergyKcal)} kkal/hr`}</div>
                </td>
                <td>
                  {p.avgProteinPct === null ? "–" : `${fmt(p.avgProteinPct)}%`}
                  <div className="tiny muted">{p.avgProteinG === null ? "" : `${fmt(p.avgProteinG)} g/hr`}</div>
                </td>
                <td>
                  {p.daysEnergyMet}/{p.daysLogged}
                  <div className="tiny muted">hari</div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <p className="tiny muted" style={{ marginTop: 6 }}>
        Rata-rata per hari dari hari yang ada catatannya. "Hari tercapai" = energi ≥{MET_THRESHOLD}% target. * = periode masih berjalan.
      </p>
    </>
  );
}

export function NutritionPage() {
  const { boot, day, date, targets } = useApp();
  const [history, setHistory] = useState<HistoryDay[] | null>(null);
  const [evaluations, setEvaluations] = useState<Evaluation[] | null>(null);
  const [range, setRange] = useState<"7" | "14" | "30">("14");
  const [historyView, setHistoryView] = useState<"grafik" | "tabel">("grafik");
  const [progressMode, setProgressMode] = useState<ProgressMode>("harian");

  useEffect(() => {
    api<{ days: HistoryDay[] }>(`/api/history?days=${range}&to=${date}`)
      .then((r) => setHistory(r.days))
      .catch(() => setHistory([]));
  }, [range, date, day?.intakes.length]);

  useEffect(() => {
    api<{ evaluations: Evaluation[] }>("/api/evaluations?limit=10")
      .then((r) => setEvaluations(r.evaluations))
      .catch(() => setEvaluations([]));
  }, [day?.evaluations.length]);

  const totals = useMemo(() => sumIntakes(day?.intakes ?? []), [day?.intakes]);
  const n = totals.nutrients;

  const macroRows: Row[] = [
    { label: "Energi", unit: "kkal", value: n.energy_kcal ?? 0, target: targets.energy?.target ?? null },
    { label: "Protein", unit: "g", value: n.protein_g ?? 0, target: targets.protein?.target ?? null },
    { label: "Karbohidrat", unit: "g", value: n.carb_g ?? 0, target: targets.carbG, note: "perkiraan dari target energi" },
    { label: "Lemak", unit: "g", value: n.fat_g ?? 0, target: targets.fatG, note: "perkiraan dari target energi" },
    { label: "Cairan", unit: "ml", value: totals.volumeMl, target: targets.fluid?.target ?? null },
    { label: "Serat", unit: "g", value: n.fiber_g ?? 0, target: null },
    { label: "Omega-3 (EPA+DHA)", unit: "mg", value: n.omega3_mg ?? 0, target: null },
  ];
  const microRows = (group: "vitamin" | "mineral"): Row[] =>
    NUTRIENTS.filter((x) => x.group === group).map((x) => ({
      label: x.label,
      unit: x.unit,
      value: n[x.key as NutrientKey] ?? ((day?.intakes.length ?? 0) > 0 ? null : 0),
      target: targets.micros[x.key as NutrientKey] ?? null,
    }));

  const lowMicros = Object.entries(targets.micros)
    .filter(([k, t]) => t && n[k as NutrientKey] !== undefined && (n[k as NutrientKey]! / t) * 100 < 50 && k !== "sodium_mg")
    .map(([k]) => NUTRIENT_BY_KEY[k as NutrientKey].label);

  const chart = useMemo(() => {
    if (!history) return null;
    const energy: (number | null)[] = [];
    const protein: (number | null)[] = [];
    for (const d of history) {
      const t = computeTargets({ profile: boot.profile, weights: boot.weights, labs: boot.labs, today: d.date });
      energy.push(t.energy && d.count ? ((d.nutrients.energy_kcal ?? 0) / t.energy.target) * 100 : d.count ? 0 : null);
      protein.push(t.protein && d.count ? ((d.nutrients.protein_g ?? 0) / t.protein.target) * 100 : d.count ? 0 : null);
    }
    return { energy, protein };
  }, [history, boot.profile, boot.weights, boot.labs]);

  const weights = boot.weights.slice(-20);
  const energyPct = targets.energy ? ((n.energy_kcal ?? 0) / targets.energy.target) * 100 : null;

  return (
    <>
      <h1>Nutrisi</h1>
      <div className="card">
        <div className="card-header">
          <h2>{fmtDate(date)}</h2>
          {energyPct !== null && <StatusPill status={adequacyStatus(energyPct)} />}
        </div>
        <NutrientTable rows={macroRows} />
        <h3>Vitamin</h3>
        <NutrientTable rows={microRows("vitamin")} />
        <h3>Mineral</h3>
        <NutrientTable rows={microRows("mineral")} />
        <p className="tiny muted" style={{ marginTop: 8 }}>
          Target vitamin & mineral: {targets.akgLabel}. Natrium & kalium mengikuti arahan dokter bila ada gangguan ginjal/jantung.
          Tanda "?" berarti zat itu tidak tercantum di label produk yang diminum.
        </p>
        {lowMicros.length > 0 && (day?.intakes.length ?? 0) > 0 && (
          <p className="small secondary">Di bawah 50% AKG: {lowMicros.join(", ")}.</p>
        )}
      </div>

      <div className="card">
        <h2>Riwayat kecukupan</h2>
        <div style={{ margin: "8px 0 10px" }}>
          <Segmented
            value={progressMode}
            onChange={setProgressMode}
            options={[
              { value: "harian", label: "Harian" },
              { value: "mingguan", label: "Mingguan" },
              { value: "bulanan", label: "Bulanan" },
            ]}
          />
        </div>
        {progressMode !== "harian" ? (
          <PeriodProgress key={progressMode} mode={progressMode} />
        ) : (
        <>
        <div className="row spread">
          <p className="small muted" style={{ margin: 0 }}>Persentase dari target harian.</p>
          <Segmented
            value={range}
            onChange={setRange}
            options={[
              { value: "7", label: "7 h" },
              { value: "14", label: "14 h" },
              { value: "30", label: "30 h" },
            ]}
          />
        </div>
        <div className="row spread" style={{ margin: "8px 0 6px" }}>
          <div className="legend">
            <span>
              <i style={{ background: "var(--series-1)" }} />
              Energi
            </span>
            <span>
              <i style={{ background: "var(--series-2)" }} />
              Protein
            </span>
          </div>
          <Segmented
            value={historyView}
            onChange={setHistoryView}
            options={[
              { value: "grafik", label: "Grafik" },
              { value: "tabel", label: "Tabel" },
            ]}
          />
        </div>
        {!history || !chart ? (
          <div className="empty">Memuat…</div>
        ) : historyView === "grafik" ? (
          <LineChart
            series={[
              { key: "e", label: "Energi", color: "var(--series-1)", values: chart.energy },
              { key: "p", label: "Protein", color: "var(--series-2)", values: chart.protein },
            ]}
            xLabels={history.map((d) => fmtShortDate(d.date))}
            tooltipTitles={history.map((d) => fmtDate(d.date))}
            unit="%"
            refLine={{ value: 100, label: "Target 100%" }}
            yMaxHint={120}
          />
        ) : (
          <table className="nutrients">
            <thead>
              <tr>
                <th>Tanggal</th>
                <th>Energi</th>
                <th>Protein</th>
                <th>Cairan</th>
              </tr>
            </thead>
            <tbody>
              {history.map((d, i) => (
                <tr key={d.date}>
                  <td>
                    {fmtShortDate(d.date)}
                    {d.redFlags && " ⚠️"}
                  </td>
                  <td>
                    {fmt(d.nutrients.energy_kcal)} <span className="muted">({chart.energy[i] === null ? "–" : `${fmt(chart.energy[i])}%`})</span>
                  </td>
                  <td>
                    {fmt(d.nutrients.protein_g)} g <span className="muted">({chart.protein[i] === null ? "–" : `${fmt(chart.protein[i])}%`})</span>
                  </td>
                  <td>{fmt(d.volumeMl)} ml</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        </>
        )}
      </div>

      <div className="card">
        <h2>Berat badan (kg)</h2>
        {weights.length < 2 ? (
          <div className="empty">Catat berat badan minimal 2 kali di menu Pasien untuk melihat tren.</div>
        ) : (
          <LineChart
            series={[{ key: "w", label: "Berat badan", color: "var(--series-1)", values: weights.map((w) => w.kg) }]}
            xLabels={weights.map((w) => fmtShortDate(w.date))}
            tooltipTitles={weights.map((w) => fmtDate(w.date))}
            unit="kg"
            height={150}
            yMin={Math.floor(Math.min(...weights.map((w) => w.kg)) / 5) * 5 - 5}
          />
        )}
        {targets.weightLoss.pct1m !== null && (
          <p className="small secondary" style={{ marginTop: 6 }}>
            Perubahan 1 bulan: {fmt(-targets.weightLoss.pct1m, 1)}%
          </p>
        )}
      </div>

      <h2 style={{ marginTop: 16 }}>Riwayat evaluasi AI</h2>
      {evaluations === null ? (
        <div className="empty">Memuat…</div>
      ) : evaluations.length === 0 ? (
        <div className="empty">Belum ada evaluasi. Tekan "Evaluasi kecukupan" di halaman Hari Ini.</div>
      ) : (
        evaluations.map((e) => <EvaluationCard key={e.id} evaluation={e} />)
      )}
    </>
  );
}
