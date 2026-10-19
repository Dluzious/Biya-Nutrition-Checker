import { useMemo, useState } from "react";
import { expectedFraction, suggestNext, sumIntakes } from "../../shared/intake";
import { addDays, localParts, timeToMinutes } from "../../shared/time";
import { RED_FLAGS } from "../../shared/types";
import { api } from "../api";
import { EvaluationCard } from "../components/EvaluationCard";
import { LogIntakeSheet, SymptomSheet, type IntakePrefill } from "../components/sheets";
import { ConfirmDialog, Meter, Spinner, fmt, fmtDate, fmtIn, fmtTime, minutesAgo } from "../components/ui";
import { useApp } from "../store";

export function TodayPage({ goTo }: { goTo: (tab: "pasien" | "produk" | "jadwal") => void }) {
  const { boot, day, date, setDate, isToday, todayDate, targets, run, toast } = useApp();
  const tz = boot.profile.timezone;
  const [sheet, setSheet] = useState<null | { kind: "intake"; prefill?: IntakePrefill } | { kind: "symptom" }>(() =>
    new URLSearchParams(location.search).has("log") ? { kind: "intake" } : null,
  );
  const [aiBusy, setAiBusy] = useState<null | "saran" | "evaluasi">(null);
  const [confirmAi, setConfirmAi] = useState<null | "saran" | "evaluasi">(null);

  const intakes = day?.intakes ?? [];
  const totals = useMemo(() => sumIntakes(intakes), [intakes]);
  const nowMinutes = isToday ? localParts(new Date(), tz).minutes : date < todayDate ? 24 * 60 : 0;
  const expected = isToday ? expectedFraction(nowMinutes, boot.schedule) : null;
  const intakeMinutes = intakes.map((i) => localParts(new Date(i.takenAt), tz).minutes);

  const next = useMemo(
    () =>
      suggestNext({
        nowMinutes,
        schedule: boot.schedule,
        products: boot.products,
        totals,
        targets,
        intakeMinutes,
        maxVolumeMl: boot.profile.maxVolumePerSittingMl,
        fluidRestricted: Boolean(boot.profile.conditions.fluidRestrictionMl),
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [nowMinutes, boot.schedule, boot.products, totals, targets, intakes],
  );

  const redFlags = (day?.symptoms ?? []).flatMap((s) => s.redFlags);
  const latestEval = day?.evaluations[0];

  // Info untuk dialog konfirmasi: kapan terakhir dibuat & apakah ada data baru sejak itu.
  const lastAi = (kind: "saran" | "evaluasi") => {
    const last = day?.evaluations.find((e) => e.kind === kind);
    if (!last) return null;
    const since = Date.parse(last.createdAt);
    const newData =
      intakes.filter((i) => Date.parse(i.takenAt) > since).length +
      (day?.symptoms ?? []).filter((s) => Date.parse(s.at) > since).length;
    return { last, newData };
  };

  const askAi = async (kind: "saran" | "evaluasi") => {
    if (!boot.ai.ready) {
      toast("API key Anthropic belum diatur di server.", "error");
      return;
    }
    setAiBusy(kind);
    await run(() => api(kind === "saran" ? "/api/ai/suggest" : "/api/ai/evaluate", { body: { date } }));
    setAiBusy(null);
  };

  const remove = (id: string, name: string) => {
    if (confirm(`Hapus catatan ${name}?`)) run(() => api(`/api/intakes/${id}`, { method: "DELETE" }), "Catatan dihapus");
  };

  const profileIncomplete = !boot.profile.heightCm || targets.weightKg === null;

  return (
    <>
      <div className="row spread">
        <button className="btn ghost" aria-label="Hari sebelumnya" onClick={() => setDate(addDays(date, -1))}>
          ‹
        </button>
        <div style={{ textAlign: "center" }}>
          <div className="small muted">{isToday ? "Hari ini" : date < todayDate ? "Riwayat" : "Mendatang"}</div>
          <strong>{fmtDate(date)}</strong>
        </div>
        <button className="btn ghost" aria-label="Hari berikutnya" disabled={date >= todayDate} onClick={() => setDate(addDays(date, 1))}>
          ›
        </button>
      </div>
      {!isToday && (
        <div style={{ textAlign: "center", margin: "4px 0 10px" }}>
          <button className="btn sm" onClick={() => setDate(todayDate)}>
            Kembali ke hari ini
          </button>
        </div>
      )}

      {redFlags.length > 0 && (
        <div className="banner critical">
          <strong>⚠️ Tanda bahaya tercatat — segera hubungi dokter / IGD (119)</strong>
          <ul>
            {[...new Set(redFlags)].map((k) => (
              <li key={k}>{RED_FLAGS.find((f) => f.key === k)?.label ?? k}</li>
            ))}
          </ul>
        </div>
      )}

      {profileIncomplete && (
        <div className="banner warning">
          <strong>Data pasien belum lengkap</strong>
          Isi tinggi dan berat badan agar target kalori, protein, dan cairan bisa dihitung.
          <div style={{ marginTop: 8 }}>
            <button className="btn sm" onClick={() => goTo("pasien")}>
              Lengkapi data pasien
            </button>
          </div>
        </div>
      )}

      <div className="card">
        <div className="card-header">
          <h2>Kecukupan {isToday ? "hari ini" : "hari itu"}</h2>
          {!day && <Spinner />}
        </div>
        <Meter
          label="Energi"
          value={totals.nutrients.energy_kcal ?? 0}
          target={targets.energy?.target}
          unit="kkal"
          expected={expected}
          sub={
            targets.refeeding.rampActive ? (
              <div className="tiny muted" style={{ marginTop: 2 }}>
                Target dinaikkan bertahap (risiko refeeding) — hari ke-{targets.refeeding.day}.
              </div>
            ) : null
          }
        />
        <Meter label="Protein" value={totals.nutrients.protein_g ?? 0} target={targets.protein?.target} unit="g" expected={expected} />
        <Meter label="Cairan" value={totals.volumeMl} target={targets.fluid?.target} unit="ml" expected={expected} />
        <div className="grid-2 small" style={{ marginTop: 6 }}>
          <div>
            <span className="muted">Karbohidrat</span>
            <div>
              {fmt(totals.nutrients.carb_g)} / {fmt(targets.carbG)} g
            </div>
          </div>
          <div>
            <span className="muted">Lemak</span>
            <div>
              {fmt(totals.nutrients.fat_g)} / {fmt(targets.fatG)} g
            </div>
          </div>
        </div>
        {(targets.energy?.source === "dokter" || targets.protein?.source === "dokter") && (
          <div className="tiny muted" style={{ marginTop: 8 }}>
            Memakai target dari dokter.
          </div>
        )}
      </div>

      {isToday && (
        <div className="card">
          <div className="card-header">
            <h2>Minum berikutnya</h2>
            {next.time && <span className="status">{next.time}</span>}
          </div>
          {next.done ? (
            <p>
              <strong>Target energi & protein hari ini tercapai.</strong>
            </p>
          ) : next.product && next.amount ? (
            <>
              <p style={{ fontSize: "1.05rem" }}>
                <strong>
                  {next.product.name} {fmt(next.amount, 2)} {next.unit}
                </strong>
                <span className="secondary">
                  {" "}
                  ≈ {fmt(next.energyKcal)} kkal · {fmt(next.proteinG, 1)} g protein
                </span>
              </p>
              {next.slot && (
                <p className="small secondary">
                  Jadwal {next.slot.time}
                  {next.slot.label ? ` (${next.slot.label})` : ""} — {fmtIn(timeToMinutes(next.slot.time) - nowMinutes)}
                </p>
              )}
            </>
          ) : null}
          {next.notes.length > 0 && (
            <ul className="small secondary" style={{ paddingLeft: 18, margin: "4px 0 10px" }}>
              {next.notes.map((n, i) => (
                <li key={i}>{n}</li>
              ))}
            </ul>
          )}
          <div className="small muted" style={{ marginBottom: 10 }}>
            Sisa target: {fmt(next.remaining.energyKcal)} kkal · {fmt(next.remaining.proteinG)} g protein ·{" "}
            {fmt(next.remaining.fluidMl)} ml cairan
          </div>
          <div className="row wrap">
            {next.product && next.amount && (
              <button
                className="btn primary"
                onClick={() =>
                  setSheet({ kind: "intake", prefill: { productId: next.product!.id, amount: next.amount!, unit: next.unit } })
                }
              >
                Catat sesuai saran
              </button>
            )}
            {boot.schedule.length === 0 && (
              <button className="btn" onClick={() => goTo("jadwal")}>
                Atur jadwal & pengingat
              </button>
            )}
          </div>
        </div>
      )}

      <div className="grid-2" style={{ marginBottom: 12 }}>
        <button className="btn primary" onClick={() => setSheet({ kind: "intake" })}>
          + Catat minum
        </button>
        <button className="btn" onClick={() => setSheet({ kind: "symptom" })}>
          Catat gejala
        </button>
      </div>

      <div className="card">
        <div className="card-header">
          <h2>Asisten AI</h2>
          {!boot.ai.ready && <span className="tiny muted">belum aktif</span>}
        </div>
        <div className="grid-2">
          <button className="btn" disabled={aiBusy !== null || !isToday} onClick={() => setConfirmAi("saran")}>
            {aiBusy === "saran" ? <Spinner /> : "Saran berikutnya"}
          </button>
          <button className="btn" disabled={aiBusy !== null} onClick={() => setConfirmAi("evaluasi")}>
            {aiBusy === "evaluasi" ? <Spinner /> : "Evaluasi kecukupan"}
          </button>
        </div>
        {aiBusy && <p className="tiny muted" style={{ marginTop: 8 }}>AI sedang menganalisis, biasanya 10–40 detik…</p>}
      </div>
      {latestEval && <EvaluationCard evaluation={latestEval} />}

      <div className="card">
        <div className="card-header">
          <h2>Catatan minum</h2>
          <span className="small muted">
            {intakes.length}× · {fmt(totals.volumeMl)} ml
          </span>
        </div>
        {intakes.length === 0 ? (
          <div className="empty">Belum ada catatan.</div>
        ) : (
          <ul className="list">
            {[...intakes].reverse().map((i) => (
              <li key={i.id}>
                <span className="time-badge">{fmtTime(i.takenAt, tz)}</span>
                <div className="grow">
                  <div>
                    {i.productName} · {fmt(i.unit === "ml" ? i.amount : i.volumeMl || i.amount, 2)} {i.unit === "ml" || i.volumeMl ? "ml" : "porsi"}
                  </div>
                  <div className="small muted">
                    {i.nutrients.energy_kcal ? `${fmt(i.nutrients.energy_kcal)} kkal · ${fmt(i.nutrients.protein_g, 1)} g protein · ` : ""}
                    {i.loggedByName ?? ""}
                    {i.note ? ` · ${i.note}` : ""}
                  </div>
                </div>
                <button className="btn ghost small" aria-label="Hapus" onClick={() => remove(i.id, i.productName)}>
                  ✕
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {(day?.symptoms.length ?? 0) > 0 && (
        <div className="card">
          <h2>Gejala</h2>
          <ul className="list">
            {day!.symptoms.map((s) => (
              <li key={s.id}>
                <span className="time-badge">{fmtTime(s.at, tz)}</span>
                <div className="grow small">
                  {[
                    s.nausea && `mual ${s.nausea}`,
                    s.vomiting && `muntah ${s.vomiting}`,
                    s.bloating && `begah ${s.bloating}`,
                    s.diarrhea && `diare ${s.diarrhea}`,
                    s.pain && `nyeri ${s.pain}`,
                  ]
                    .filter(Boolean)
                    .join(" · ") || "Tidak ada keluhan"}
                  {s.redFlags.length > 0 && <div style={{ color: "var(--critical)" }}>⚠️ {s.redFlags.length} tanda bahaya</div>}
                  <div className="muted">
                    {s.loggedByName}
                    {s.note ? ` · ${s.note}` : ""}
                  </div>
                </div>
                <button
                  className="btn ghost small"
                  aria-label="Hapus"
                  onClick={() => confirm("Hapus catatan gejala ini?") && run(() => api(`/api/symptoms/${s.id}`, { method: "DELETE" }))}
                >
                  ✕
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {(day?.reminders.length ?? 0) > 0 && (
        <div className="card">
          <h2>Pengingat tambahan</h2>
          <ul className="list">
            {day!.reminders.map((r) => (
              <li key={r.id}>
                <span className="time-badge">{fmtTime(r.dueAt, tz)}</span>
                <span className="grow small">{r.message}</span>
                <button className="btn ghost small" onClick={() => run(() => api(`/api/reminders/${r.id}`, { method: "DELETE" }), "Pengingat dibatalkan")}>
                  Batal
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {sheet?.kind === "intake" && (
        <LogIntakeSheet
          prefill={sheet.prefill}
          onClose={() => {
            setSheet(null);
            if (location.search) history.replaceState(null, "", location.pathname);
          }}
        />
      )}
      {sheet?.kind === "symptom" && <SymptomSheet onClose={() => setSheet(null)} />}
      {confirmAi &&
        (() => {
          const info = lastAi(confirmAi);
          const what = confirmAi === "evaluasi" ? "evaluasi kecukupan" : "saran minum berikutnya";
          return (
            <ConfirmDialog
              title={confirmAi === "evaluasi" ? "Minta evaluasi AI?" : "Minta saran AI?"}
              onCancel={() => setConfirmAi(null)}
              onConfirm={() => {
                const kind = confirmAi;
                setConfirmAi(null);
                askAi(kind);
              }}
            >
              <p>
                Data {isToday ? "hari ini" : fmtDate(date)} akan dikirim ke AI untuk {what}.
              </p>
              {info ? (
                <p>
                  Terakhir dibuat <strong>{minutesAgo(info.last.createdAt)}</strong> oleh {info.last.createdByName ?? "anggota lain"}.{" "}
                  {info.newData === 0 ? (
                    <strong style={{ color: "var(--ink)" }}>
                      Belum ada catatan minum/gejala baru sejak itu — hasilnya kemungkinan sama. Lihat hasil terakhir di bawah.
                    </strong>
                  ) : (
                    `Sejak itu ada ${info.newData} catatan baru.`
                  )}
                </p>
              ) : (
                <p>Belum ada {what} untuk tanggal ini.</p>
              )}
            </ConfirmDialog>
          );
        })()}
    </>
  );
}
