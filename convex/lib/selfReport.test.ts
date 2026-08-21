import { describe, expect, test } from "vitest";
import { describeActivityInputs, describeSelfReport } from "./selfReport";

describe("describeSelfReport", () => {
  test("empty period", () => {
    expect(describeSelfReport("ratio", "higherIsBetter", 1, [])).toBe("nothing reported");
  });

  test("ratio sums entries", () => {
    expect(
      describeSelfReport("ratio", "higherIsBetter", 1, [
        { activityAt: 1, numerator: 20, denominator: 25 },
        { activityAt: 2, numerator: 25, denominator: 25 },
      ]),
    ).toBe("45 of 50 reported");
  });

  test("count against a lower-is-better budget", () => {
    expect(
      describeSelfReport("count", "lowerIsBetter", 24, [
        { activityAt: 1, quantity: 7 },
        { activityAt: 2, quantity: 5 },
      ]),
    ).toBe("12 recorded (budget 24)");
  });

  test("reduction takes the latest entry", () => {
    expect(
      describeSelfReport("reduction", "lowerIsBetter", 0.2, [
        { activityAt: 1, baseline: 30, currentValue: 28 },
        { activityAt: 9, baseline: 30, currentValue: 24 },
      ]),
    ).toBe("baseline 30 → now 24");
  });

  test("rubric self-score", () => {
    expect(
      describeSelfReport("rubric", "higherIsBetter", 1, [
        { activityAt: 1, score: 8, maxScore: 10 },
      ]),
    ).toBe("self-scored 8 / 10");
  });
});

describe("describeActivityInputs", () => {
  test("per-entry ratio and milestone", () => {
    expect(
      describeActivityInputs("ratio", { activityAt: 1, numerator: 4, denominator: 5 }),
    ).toBe("4 / 5");
    expect(
      describeActivityInputs("milestone", { activityAt: 1, completed: 2, planned: 3 }),
    ).toBe("2 / 3");
  });

  test("missing values render as em-dash", () => {
    expect(describeActivityInputs("ratio", { activityAt: 1 })).toBe("— / —");
  });
});
