import type { Evaluation, EvaluationOutput, SuggestionOutput } from "../../shared/types";
import { useApp } from "../store";
import { StatusPill, fmtDateTime } from "./ui";

const EVAL_STATUS: Record<EvaluationOutput["status"], { status: "kurang" | "hampir" | "cukup" | "lebih"; label: string }> = {
  cukup: { status: "cukup", label: "Cukup" },
  hampir_cukup: { status: "hampir", label: "Hampir cukup" },
  kurang: { status: "kurang", label: "Kurang" },
  berlebih: { status: "lebih", label: "Berlebih" },
  perlu_perhatian: { status: "kurang", label: "Perlu perhatian" },
};

function List({ title, items }: { title: string; items: string[] }) {
  if (!items.length) return null;
  return (
    <>
      <h3>{title}</h3>
      <ul>
        {items.map((t, i) => (
          <li key={i}>{t}</li>
        ))}
      </ul>
    </>
  );
}

export function EvaluationCard({ evaluation }: { evaluation: Evaluation }) {
  const { boot } = useApp();
  const meta = (
    <div className="tiny muted" style={{ marginTop: 6 }}>
      {fmtDateTime(evaluation.createdAt, boot.profile.timezone)} · diminta {evaluation.createdByName ?? "?"} · AI, bukan pengganti
      dokter
    </div>
  );

  if (evaluation.kind === "saran") {
    const o = evaluation.output as SuggestionOutput;
    return (
      <div className="card ai-card">
        <div className="card-header">
          <h2>Saran AI berikutnya</h2>
        </div>
        <p>
          <strong>{o.saran_utama}</strong>
        </p>
        <List title="Rincian" items={o.rincian} />
        <List title="Perhatikan" items={o.catatan} />
        {meta}
      </div>
    );
  }

  const o = evaluation.output as EvaluationOutput;
  const s = EVAL_STATUS[o.status] ?? EVAL_STATUS.kurang;
  return (
    <div className="card ai-card">
      <div className="card-header">
        <h2>Evaluasi AI</h2>
        <StatusPill status={s.status} label={s.label} />
      </div>
      {o.tanda_bahaya.length > 0 && (
        <div className="banner critical">
          <strong>Tanda bahaya</strong>
          <ul>
            {o.tanda_bahaya.map((t, i) => (
              <li key={i}>{t}</li>
            ))}
          </ul>
        </div>
      )}
      <p>{o.ringkasan}</p>
      <List title="Temuan" items={o.temuan} />
      <List title="Saran" items={o.saran} />
      {o.rencana_asupan_berikutnya && (
        <>
          <h3>Rencana asupan berikutnya</h3>
          <p>{o.rencana_asupan_berikutnya}</p>
        </>
      )}
      <List title="Tanyakan ke dokter" items={o.pertanyaan_untuk_dokter} />
      {meta}
    </div>
  );
}
