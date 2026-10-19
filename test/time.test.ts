import { describe, expect, it } from "vitest";
import { addDays, localParts, zonedToUtc } from "../src/shared/time";

describe("time", () => {
  it("mengonversi waktu lokal WIB ke UTC dan sebaliknya", () => {
    const utc = zonedToUtc("2026-10-19", "07:30", "Asia/Jakarta");
    expect(utc.toISOString()).toBe("2026-10-19T00:30:00.000Z");
    expect(localParts(new Date("2026-10-18T18:00:00Z"), "Asia/Jakarta")).toEqual({
      date: "2026-10-19",
      time: "01:00",
      minutes: 60,
    });
  });
  it("menambah hari melewati batas bulan", () => {
    expect(addDays("2026-10-31", 1)).toBe("2026-11-01");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
  });
});
