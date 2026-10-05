import { describe, expect, test } from "vitest";
import { weightNote } from "./weights";

describe("weightNote", () => {
  test("confirms complete weights", () => {
    const n = weightNote([
      { name: "A", configuredWeight: 100 },
      { name: "B", configuredWeight: 100 },
    ]);
    expect(n.weightsComplete).toBe(true);
    expect(n.lowestConfiguredWeight).toBe(100);
    expect(n.weightWarning).toBe(
      "All 2 employees' configured weights total 100 / 100 (80 core + 20 non-core).",
    );
  });

  test("names the employees below 100", () => {
    const n = weightNote([
      { name: "A", configuredWeight: 100 },
      { name: "B", configuredWeight: 80 },
    ]);
    expect(n.weightsComplete).toBe(false);
    expect(n.lowestConfiguredWeight).toBe(80);
    expect(n.weightWarning).toMatch(/^1 of 2 employees' .* below 100: B \(80\)\./);
  });

  test("an empty scope reads as complete", () => {
    expect(weightNote([]).weightsComplete).toBe(true);
  });
});
