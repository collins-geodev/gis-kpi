import { describe, expect, it } from "vitest";
import {
  aggregateCounts,
  aggregateRatios,
  computeAttainment,
  DEFAULT_CAPS,
  scoreScorecard,
  weightedContribution,
  type ScorecardItem,
} from "./scoring";

describe("computeAttainment — ratio", () => {
  it("computes numerator/denominator vs target", () => {
    const r = computeAttainment({
      mode: "ratio",
      target: 1,
      numerator: 90,
      denominator: 100,
    });
    expect(r.rawActual).toBe(0.9);
    expect(r.attainment).toBe(0.9);
    expect(r.cappedAttainment).toBe(0.9);
    expect(r.status).toBe("watch");
    expect(r.hasData).toBe(true);
  });

  it("treats a zero denominator as no data (never divides by zero)", () => {
    const r = computeAttainment({
      mode: "ratio",
      target: 1,
      numerator: 5,
      denominator: 0,
    });
    expect(r.hasData).toBe(false);
    expect(r.attainment).toBeNull();
    expect(r.cappedAttainment).toBeNull();
    expect(r.status).toBe("no_data");
  });

  it("supports lower-is-better via configured inverse", () => {
    const r = computeAttainment({
      mode: "ratio",
      direction: "lowerIsBetter",
      target: 0.1,
      numerator: 5,
      denominator: 100, // 5% error rate vs 10% target
    });
    expect(r.rawActual).toBe(0.05);
    expect(r.attainment).toBe(2); // 0.1 / 0.05
    expect(r.cappedAttainment).toBe(1); // capped at official 100%
  });

  it("lower-is-better with zero actual is perfect (clamped to cap)", () => {
    const r = computeAttainment({
      mode: "ratio",
      direction: "lowerIsBetter",
      target: 0.1,
      numerator: 0,
      denominator: 100,
    });
    expect(r.cappedAttainment).toBe(1);
    expect(r.status).toBe("on_target");
  });
});

describe("computeAttainment — count", () => {
  it("meets target exactly", () => {
    const r = computeAttainment({ mode: "count", target: 20, actual: 20 });
    expect(r.attainment).toBe(1);
    expect(r.status).toBe("on_target");
  });
  it("under target", () => {
    const r = computeAttainment({ mode: "count", target: 20, actual: 10 });
    expect(r.attainment).toBe(0.5);
    expect(r.status).toBe("critical");
  });
  it("over target is capped officially but visible in stretch", () => {
    const r = computeAttainment({ mode: "count", target: 20, actual: 30 });
    expect(r.attainment).toBe(1.5);
    expect(r.cappedAttainment).toBe(1);
    expect(r.stretchAttainment).toBe(1.2);
  });
});

describe("computeAttainment — reduction", () => {
  it("achieves the target reduction fraction", () => {
    const r = computeAttainment({
      mode: "reduction",
      target: 0.2,
      baseline: 100,
      current: 80,
    });
    expect(r.rawActual).toBe(0.2); // 20% reduction achieved
    expect(r.attainment).toBe(1);
    expect(r.status).toBe("on_target");
  });
  it("partial reduction", () => {
    const r = computeAttainment({
      mode: "reduction",
      target: 0.2,
      baseline: 100,
      current: 90,
    });
    expect(r.rawActual).toBe(0.1);
    expect(r.attainment).toBe(0.5);
  });
  it("zero baseline with zero current is sustained perfection (met)", () => {
    const r = computeAttainment({
      mode: "reduction",
      target: 0.2,
      baseline: 0,
      current: 0,
    });
    expect(r.hasData).toBe(true);
    expect(r.attainment).toBe(1);
    expect(r.cappedAttainment).toBe(1);
    expect(r.status).toBe("on_target");
    expect(r.note).toMatch(/perfection sustained/i);
  });
  it("zero baseline with a nonzero current is no data", () => {
    const r = computeAttainment({
      mode: "reduction",
      target: 0.2,
      baseline: 0,
      current: 3,
    });
    expect(r.hasData).toBe(false);
    expect(r.status).toBe("no_data");
  });
  it("normalizes a percent-encoded target (workbook Number/20 means 20%)", () => {
    const r = computeAttainment({
      mode: "reduction",
      target: 20,
      baseline: 50,
      current: 40,
    });
    expect(r.rawActual).toBe(0.2);
    expect(r.attainment).toBe(1);
    expect(r.status).toBe("on_target");
    expect(r.note).toMatch(/interpreted as a 20% reduction/i);
  });
  it("percent-encoded target still gives linear partial credit", () => {
    const r = computeAttainment({
      mode: "reduction",
      target: 20,
      baseline: 50,
      current: 45,
    });
    expect(r.rawActual).toBe(0.1);
    expect(r.attainment).toBe(0.5);
  });
  it("over-achievement is capped", () => {
    const r = computeAttainment({
      mode: "reduction",
      target: 0.2,
      baseline: 100,
      current: 50,
    });
    expect(r.attainment).toBe(2.5);
    expect(r.cappedAttainment).toBe(1);
  });
});

describe("computeAttainment — durationSla / milestone / binary / rubric", () => {
  it("durationSla ratio within threshold", () => {
    const r = computeAttainment({
      mode: "durationSla",
      target: 1,
      withinThreshold: 8,
      eligible: 10,
    });
    expect(r.attainment).toBe(0.8);
  });
  it("durationSla with no eligible items is no data", () => {
    const r = computeAttainment({
      mode: "durationSla",
      target: 1,
      withinThreshold: 0,
      eligible: 0,
    });
    expect(r.hasData).toBe(false);
  });
  it("milestone", () => {
    const r = computeAttainment({
      mode: "milestone",
      target: 1,
      completed: 3,
      planned: 4,
    });
    expect(r.attainment).toBe(0.75);
    expect(r.status).toBe("at_risk");
  });
  it("binary pass/fail", () => {
    expect(computeAttainment({ mode: "binary", target: 1, pass: true }).attainment).toBe(
      1,
    );
    const fail = computeAttainment({ mode: "binary", target: 1, pass: false });
    expect(fail.attainment).toBe(0);
    expect(fail.status).toBe("critical");
  });
  it("rubric score/max", () => {
    const r = computeAttainment({
      mode: "rubric",
      target: 1,
      score: 4,
      maxScore: 5,
    });
    expect(r.attainment).toBe(0.8);
  });
});

describe("computeAttainment — composite", () => {
  it("weighted average of sub-measures", () => {
    const r = computeAttainment({
      mode: "composite",
      target: 1,
      compositeParts: [
        { label: "healthchecks", attainment: 1, weight: 3 },
        { label: "uptime", attainment: 0.5, weight: 1 },
      ],
    });
    expect(r.attainment).toBe(0.875); // (1*3 + 0.5*1)/4
  });
  it("gate failure caps the composite (zero-downtime rule)", () => {
    const r = computeAttainment({
      mode: "composite",
      target: 1,
      compositeParts: [{ label: "healthchecks", attainment: 1, weight: 1 }],
      gate: { passed: false, failCap: 0.5 },
    });
    expect(r.cappedAttainment).toBe(0.5);
  });
});

describe("caps are configurable", () => {
  it("honours custom official & stretch caps", () => {
    const r = computeAttainment(
      { mode: "count", target: 10, actual: 20 },
      { officialCap: 1.1, stretchCap: 1.5 },
    );
    expect(r.attainment).toBe(2);
    expect(r.cappedAttainment).toBe(1.1);
    expect(r.stretchAttainment).toBe(1.5);
  });
});

describe("weightedContribution", () => {
  it("multiplies capped attainment by weight points", () => {
    expect(weightedContribution(0.9, 20)).toBe(18);
    expect(weightedContribution(1, 15)).toBe(15);
  });
  it("no data contributes zero", () => {
    expect(weightedContribution(null, 20)).toBe(0);
  });
});

describe("scoreScorecard — 80-point weighting & normalization", () => {
  const fullMarks: ScorecardItem[] = [
    { weight: 10, cappedAttainment: 1 },
    { weight: 20, cappedAttainment: 1 },
    { weight: 20, cappedAttainment: 1 },
    { weight: 15, cappedAttainment: 1 },
    { weight: 15, cappedAttainment: 1 },
  ];

  it("retains the true configured maximum of 80", () => {
    const s = scoreScorecard(fullMarks);
    expect(s.configuredWeight).toBe(80);
    expect(s.assignedWeightScore).toBe(80);
    expect(s.assignedWeightPct).toBe(100);
    expect(s.normalizedScore).toBe(100);
    expect(s.scoreOnMeasured).toBe(100);
  });

  it("handles a KPI with no data (weight retained, contribution zero)", () => {
    const items: ScorecardItem[] = [
      { weight: 10, cappedAttainment: 1 },
      { weight: 20, cappedAttainment: 1 },
      { weight: 20, cappedAttainment: null }, // no data
      { weight: 15, cappedAttainment: 1 },
      { weight: 15, cappedAttainment: 1 },
    ];
    const s = scoreScorecard(items);
    expect(s.configuredWeight).toBe(80);
    expect(s.dataWeight).toBe(60);
    expect(s.assignedWeightScore).toBe(60);
    expect(s.assignedWeightPct).toBe(75); // out of configured 80
    expect(s.scoreOnMeasured).toBe(100); // among measured KPIs
    expect(s.itemsWithData).toBe(4);
  });

  it("computes a mixed-attainment normalized score", () => {
    const items: ScorecardItem[] = [
      { weight: 10, cappedAttainment: 0.5 }, // 5
      { weight: 20, cappedAttainment: 0.9 }, // 18
      { weight: 20, cappedAttainment: 1 }, // 20
      { weight: 15, cappedAttainment: 0.8 }, // 12
      { weight: 15, cappedAttainment: 1 }, // 15
    ];
    const s = scoreScorecard(items);
    expect(s.assignedWeightScore).toBe(70);
    expect(s.assignedWeightPct).toBe(87.5);
  });

  it("reports evidence & cadence compliance", () => {
    const items: ScorecardItem[] = [
      { weight: 40, cappedAttainment: 1, evidenceComplete: true, cadenceCompliant: true },
      {
        weight: 40,
        cappedAttainment: 1,
        evidenceComplete: false,
        cadenceCompliant: true,
      },
    ];
    const s = scoreScorecard(items);
    expect(s.evidenceCompletionPct).toBe(50);
    expect(s.cadenceCompliancePct).toBe(100);
  });
});

describe("period aggregation", () => {
  it("aggregates ratio numerators & denominators (never averages %)", () => {
    const agg = aggregateRatios([
      { numerator: 5, denominator: 10 },
      { numerator: 7, denominator: 10 },
    ]);
    expect(agg).toEqual({ numerator: 12, denominator: 20 });
    const r = computeAttainment({
      mode: "ratio",
      target: 1,
      numerator: agg.numerator,
      denominator: agg.denominator,
    });
    expect(r.rawActual).toBe(0.6);
  });

  it("aggregates counts by summing actuals against a scaled target", () => {
    const agg = aggregateCounts([18, 22, 20], 20);
    expect(agg).toEqual({ actual: 60, target: 60 });
    const r = computeAttainment({
      mode: "count",
      target: agg.target,
      actual: agg.actual,
    });
    expect(r.attainment).toBe(1);
  });
});

describe("DEFAULT_CAPS", () => {
  it("defaults to 100% official / 120% stretch", () => {
    expect(DEFAULT_CAPS).toEqual({ officialCap: 1, stretchCap: 1.2 });
  });
});
