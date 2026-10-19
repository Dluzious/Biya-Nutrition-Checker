import { useEffect, useMemo, useState } from "react";
import { adequacyStatus, sumIntakes } from "../../shared/intake";
import { NUTRIENTS, NUTRIENT_BY_KEY, type NutrientKey } from "../../shared/nutrients";
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

export function NutritionPage() {
  const { boot, day, date, targets } = useApp();
  const [history, setHistory] = useState<HistoryDay[] | null>(null);
  const [evaluations, setEvaluations] = useState<Evaluation[] | null>(null);
  const [range, setRange] = useState<"7" | "14" | "30">("14");
  const [historyView, setHistoryView] = useState<"grafik" | "tabel">("grafik");

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
        <div className="card-header">
          <h2>Tren kecukupan</h2>
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
        <p className="small muted">Persentase dari target harian.</p>
        <div className="row spread" style={{ marginBottom: 6 }}>
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
