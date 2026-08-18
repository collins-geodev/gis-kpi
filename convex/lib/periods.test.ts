import { describe, expect, it } from "vitest";
import {
  LAGOS_OFFSET_MS,
  lagosDayKeyOf,
  lagosWeekKeyOf,
  lagosWeekLabelOf,
  lagosWeekStartOf,
} from "./periods";

/** Epoch for a Lagos wall-clock instant. */
const atLagos = (y: number, m1: number, d: number, hour = 12) =>
  Date.UTC(y, m1 - 1, d, hour) - LAGOS_OFFSET_MS;

describe("lagosDayKeyOf", () => {
  it("uses the Lagos calendar day, not UTC", () => {
    // 23:30 UTC on Aug 17 is 00:30 Aug 18 in Lagos (UTC+1).
    expect(lagosDayKeyOf(Date.UTC(2026, 7, 17, 23, 30))).toBe("2026-08-18");
    expect(lagosDayKeyOf(atLagos(2026, 8, 18))).toBe("2026-08-18");
  });
});

describe("lagosWeekKeyOf / lagosWeekStartOf", () => {
  it("groups Mon–Sun into one ISO week", () => {
    // 2026-08-17 is a Monday.
    const monday = atLagos(2026, 8, 17);
    const sunday = atLagos(2026, 8, 23);
    expect(lagosWeekKeyOf(monday)).toBe(lagosWeekKeyOf(sunday));
    expect(lagosWeekStartOf(sunday)).toBe(atLagos(2026, 8, 17, 0));
    // Next Monday starts a new week.
    expect(lagosWeekKeyOf(atLagos(2026, 8, 24))).not.toBe(lagosWeekKeyOf(sunday));
  });
  it("computes ISO week numbers (2026-01-01 is a Thursday → W01)", () => {
    expect(lagosWeekKeyOf(atLagos(2026, 1, 1))).toBe("2026-W01");
    // Monday 2025-12-29 belongs to ISO 2026-W01.
    expect(lagosWeekKeyOf(atLagos(2025, 12, 29))).toBe("2026-W01");
    expect(lagosWeekKeyOf(atLagos(2026, 8, 18))).toBe("2026-W34");
  });
  it("labels the week by its Lagos Monday–Sunday span", () => {
    expect(lagosWeekLabelOf(atLagos(2026, 8, 18))).toBe("Mon 17 Aug – Sun 23 Aug");
  });
});
