import { describe, expect, it } from "vitest";
import { aggregateActivityInputs } from "./measure";
import { computeAttainment } from "./scoring";

describe("aggregateActivityInputs", () => {
  it("sums ratio numerators & denominators across a period", () => {
    const input = aggregateActivityInputs("ratio", "higherIsBetter", 1, [
      { activityAt: 1, numerator: 5, denominator: 10 },
      { activityAt: 2, numerator: 8, denominator: 10 },
    ]);
    expect(input).toMatchObject({ numerator: 13, denominator: 20 });
    expect(computeAttainment(input).rawActual).toBe(0.65);
  });

  it("sums counts from quantity", () => {
    const input = aggregateActivityInputs("count", "higherIsBetter", 20, [
      { activityAt: 1, quantity: 12 },
      { activityAt: 2, quantity: 9 },
    ]);
    expect(input.actual).toBe(21);
    expect(computeAttainment(input).cappedAttainment).toBe(1);
  });

  it("sums SLA within/eligible", () => {
    const input = aggregateActivityInputs("durationSla", "higherIsBetter", 1, [
      { activityAt: 1, withinThreshold: 3, eligible: 4 },
      { activityAt: 2, withinThreshold: 5, eligible: 6 },
    ]);
    expect(input).toMatchObject({ withinThreshold: 8, eligible: 10 });
  });

  it("uses the latest activity for reduction", () => {
    const input = aggregateActivityInputs("reduction", "lowerIsBetter", 0.2, [
      { activityAt: 1, baseline: 100, currentValue: 95 },
      { activityAt: 5, baseline: 100, currentValue: 80 },
    ]);
    expect(input).toMatchObject({ baseline: 100, current: 80 });
    expect(computeAttainment(input).attainment).toBe(1);
  });

  it("gates composite on zero downtime", () => {
    const clean = aggregateActivityInputs("composite", "higherIsBetter", 1, [
      { activityAt: 1, numerator: 4, denominator: 4, quantity: 0 },
    ]);
    expect(computeAttainment(clean).cappedAttainment).toBe(1);
    const withDowntime = aggregateActivityInputs("composite", "higherIsBetter", 1, [
      { activityAt: 1, numerator: 4, denominator: 4, quantity: 2 },
    ]);
    expect(computeAttainment(withDowntime).cappedAttainment).toBe(0.5);
  });
});
