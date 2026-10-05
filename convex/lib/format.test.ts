import { describe, expect, test } from "vitest";
import { formatDate, formatDateTime, formatDeadline } from "./format";

describe("date formatting (Lagos, unambiguous)", () => {
  test("day-month-year with a month name, never dd/mm/yyyy", () => {
    expect(formatDate(Date.UTC(2026, 9, 5, 9))).toBe("5 Oct 2026");
    // 23:30 UTC on 30 Sep is 00:30 on 1 Oct in Lagos.
    expect(formatDate(Date.UTC(2026, 8, 30, 23, 30))).toBe("1 Oct 2026");
    expect(formatDateTime(Date.UTC(2026, 9, 5, 13, 7))).toBe("5 Oct 2026, 14:07");
  });

  test("a midnight deadline reads as 23:59 the day before", () => {
    // Stored as 00:00 Lagos on 5 Oct → the last moment is 4 Oct, 23:59.
    const startOf5th = Date.UTC(2026, 9, 5) - 60 * 60 * 1000;
    expect(formatDeadline(startOf5th)).toBe("4 Oct 2026, 23:59");
    // An end-of-day deadline is shown as is.
    expect(formatDeadline(Date.UTC(2026, 9, 5, 22, 59, 59, 999))).toBe(
      "5 Oct 2026, 23:59",
    );
  });
});
