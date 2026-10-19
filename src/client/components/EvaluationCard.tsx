import { useState, type ReactNode } from "react";
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

function Cheer({ text }: { text?: string }) {
  if (!text) return null;
  return (
    <p className="cheer">
      <span aria-hidden>💪</span> {text}
    </p>
  );
}

/** Kartu yang bisa dibuka/ditutup: ringkasan selalu tampil, rincian di dalam. */
function Collapsible({
  title,
  badge,
  summary,
  children,
  defaultOpen,
}: {
  title: string;
  badge?: ReactNode;
  summary: ReactNode;
  children: ReactNode;
  defaultOpen: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="card ai-card">
      <button type="button" className="collapse-head" aria-expanded={open} onClick={() => setOpen(!open)}>
        <h2>{title}</h2>
        <span className="row" style={{ gap: 6 }}>
          {badge}
          <span className={`chevron${open ? " open" : ""}`} aria-hidden>
            ▾
          </span>
        </span>
      </button>
      {summary}
      <div className={`collapse-body${open ? " open" : ""}`}>
        <div>{children}</div>
      </div>
      <button type="button" className="btn ghost sm collapse-toggle" onClick={() => setOpen(!open)}>
        {open ? "Tutup rincian ▴" : "Lihat rincian ▾"}
      </button>
    </div>
  );
}

export function EvaluationCard({ evaluation, defaultOpen = false }: { evaluation: Evaluation; defaultOpen?: boolean }) {
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
      <Collapsible
        title="Saran ahli gizi AI"
        defaultOpen={defaultOpen}
        summary={
          <>
            <p>
              <strong>{o.saran_utama}</strong>
            </p>
            <Cheer text={o.semangat} />
          </>
        }
      >
        <List title="Rincian" items={o.rincian} />
        <List title="Perhatikan" items={o.catatan} />
        {meta}
      </Collapsible>
    );
  }

  const o = evaluation.output as EvaluationOutput;
  const s = EVAL_STATUS[o.status] ?? EVAL_STATUS.kurang;
  return (
    <Collapsible
      title="Evaluasi ahli gizi AI"
      defaultOpen={defaultOpen}
      badge={<StatusPill status={s.status} label={s.label} />}
      summary={
        <>
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
          <Cheer text={o.semangat} />
        </>
      }
    >
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
    </Collapsible>
  );
}
