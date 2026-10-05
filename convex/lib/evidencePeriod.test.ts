import { describe, expect, test } from "vitest";
import {
  evidencePeriodOf,
  evidenceSupportsPeriod,
  lagosMonthKeyOf,
} from "./evidencePeriod";

describe("evidence period resolution", () => {
  test("tag wins, then work-date, then upload month (Lagos time)", () => {
    const uploadedAt = Date.UTC(2026, 9, 5, 9); // 5 Oct 2026
    expect(evidencePeriodOf({ periodKey: "2026-M08", uploadedAt })).toEqual({
      periodKey: "2026-M08",
      source: "tagged",
    });
    expect(
      evidencePeriodOf({ activityAt: Date.UTC(2026, 8, 15, 11), uploadedAt }),
    ).toEqual({ periodKey: "2026-M09", source: "activity_date" });
    expect(evidencePeriodOf({ uploadedAt })).toEqual({
      periodKey: "2026-M10",
      source: "upload_date",
    });
    // 23:30 UTC on 30 Sep is already 1 Oct in Lagos.
    expect(lagosMonthKeyOf(Date.UTC(2026, 8, 30, 23, 30))).toBe("2026-M10");
  });

  test("months count toward their quarter/year bucket, never a sibling month", () => {
    const aug = { periodKey: "2026-M08", uploadedAt: 0 };
    expect(evidenceSupportsPeriod("Monthly", aug, "2026-M08")).toBe(true);
    expect(evidenceSupportsPeriod("Monthly", aug, "2026-M09")).toBe(false);
    expect(evidenceSupportsPeriod("Quarterly", aug, "2026-Q3")).toBe(true);
    expect(evidenceSupportsPeriod("Quarterly", aug, "2026-Q4")).toBe(false);
    expect(evidenceSupportsPeriod("Annually", aug, "2026")).toBe(true);
  });
});
