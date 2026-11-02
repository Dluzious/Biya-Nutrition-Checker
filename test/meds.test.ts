import { describe, expect, it } from "vitest";
import { adherence, dailySlots, nextPeriodicDate, periodicReminderLabel } from "../src/shared/meds";
import type { MedLog, Medication } from "../src/shared/types";

const med = (over: Partial<Medication> = {}): Medication => ({
  id: "m1",
  name: "Ondansetron",
  dose: "1 tablet 8 mg",
  kind: "harian",
  times: ["07:00", "19:00"],
  instructions: "30 menit sebelum makan",
  nextDate: null,
  nextTime: null,
  intervalDays: null,
  location: "",
  startDate: "2026-11-01",
  active: true,
  notes: "",
  updatedAt: "",
  ...over,
});
const log = (date: string, time: string, status: MedLog["status"] = "diminum"): MedLog => ({
  id: `${date}${time}`,
  medicationId: "m1",
  medName: "Ondansetron",
  scheduledDate: date,
  scheduledTime: time,
  status,
  takenAt: "",
  note: "",
  loggedBy: "x",
});

describe("obat harian", () => {
  it("menentukan status tiap dosis", () => {
    const slots = dailySlots([med()], [log("2026-11-02", "07:00")], "2026-11-02", 19 * 60 + 10);
    expect(slots.map((s) => [s.time, s.state])).toEqual([
      ["07:00", "diminum"],
      ["19:00", "sekarang"],
    ]);
    expect(dailySlots([med()], [], "2026-11-02", 21 * 60)[1].state).toBe("terlewat");
    expect(dailySlots([med()], [], "2026-10-31", 24 * 60)).toHaveLength(0); // sebelum mulai
  });

  it("menghitung kepatuhan hanya dari dosis yang sudah waktunya", () => {
    const a = adherence(
      [med()],
      [log("2026-11-01", "07:00"), log("2026-11-01", "19:00", "dilewati"), log("2026-11-02", "07:00")],
      "2026-10-28",
      "2026-11-02",
      "2026-11-02",
      12 * 60,
    );
    expect(a).toEqual({ due: 3, taken: 2, skipped: 1, missed: 0, pct: 67 });
  });
});

describe("obat berkala", () => {
  it("menghitung jadwal berikutnya dan label pengingat", () => {
    expect(nextPeriodicDate("2026-11-02", 21)).toBe("2026-11-23");
    expect(nextPeriodicDate("2026-11-02", null)).toBeNull();
    expect([7, 2, 0, 3].map(periodicReminderLabel)).toEqual(["1 minggu lagi", "2 hari lagi", "Hari ini", null]);
  });
});
