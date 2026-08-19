import { describe, expect, it } from "vitest";
import { buildScoreTrend, periodLabel } from "./trend";

const snap = (
  scopeRef: string,
  periodKey: string,
  normalizedScore: number,
  createdAt = 1,
  evidenceCompletionPct = 100,
) => ({ scopeRef, periodKey, normalizedScore, evidenceCompletionPct, createdAt });

describe("buildScoreTrend", () => {
  it("orders monthly points and averages across employees with sample size", () => {
    const trend = buildScoreTrend([
      snap("a", "2026-M08", 80),
      snap("b", "2026-M08", 60),
      snap("a", "2026-M07", 50),
    ]);
    expect(trend.map((t) => t.periodKey)).toEqual(["2026-M07", "2026-M08"]);
    expect(trend[1]).toMatchObject({ label: "Aug 2026", score: 70, employees: 2 });
    expect(trend[0]).toMatchObject({ label: "Jul 2026", score: 50, employees: 1 });
  });

  it("only the latest snapshot per employee+period counts (re-approvals supersede)", () => {
    const trend = buildScoreTrend([
      snap("a", "2026-M08", 40, 1),
      snap("a", "2026-M08", 90, 5), // re-approval
    ]);
    expect(trend).toHaveLength(1);
    expect(trend[0]!.score).toBe(90);
  });

  it("keeps one grain: quarters are ignored when months exist, used otherwise", () => {
    const mixed = buildScoreTrend([
      snap("a", "2026-M08", 80),
      snap("a", "2026-Q3", 55),
      snap("a", "2026", 99), // year buckets never trend
    ]);
    expect(mixed.map((t) => t.periodKey)).toEqual(["2026-M08"]);

    const quarterly = buildScoreTrend([
      snap("a", "2026-Q2", 50),
      snap("a", "2026-Q3", 70),
      snap("a", "2026", 99),
    ]);
    expect(quarterly.map((t) => t.label)).toEqual(["Q2 2026", "Q3 2026"]);
  });

  it("averages evidence completeness alongside the score", () => {
    const trend = buildScoreTrend([
      snap("a", "2026-M08", 80, 1, 100),
      snap("b", "2026-M08", 80, 1, 50),
    ]);
    expect(trend[0]!.evidence).toBe(75);
  });

  it("is empty when no snapshots exist (dormant until approvals land)", () => {
    expect(buildScoreTrend([])).toEqual([]);
  });
});

describe("periodLabel", () => {
  it("formats months, quarters and passes unknowns through", () => {
    expect(periodLabel("2026-M01")).toBe("Jan 2026");
    expect(periodLabel("2026-Q4")).toBe("Q4 2026");
    expect(periodLabel("2026")).toBe("2026");
  });
});
