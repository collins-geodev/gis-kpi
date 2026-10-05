import { ConvexError } from "convex/values";
import { describe, expect, test } from "vitest";
import { errorMessage } from "./errors";

describe("errorMessage", () => {
  test("prefers the ConvexError payload", () => {
    expect(errorMessage(new ConvexError("Nothing to recall."), "fallback")).toBe(
      "Nothing to recall.",
    );
  });

  test("duck-types a .data payload when instanceof fails", () => {
    const e = Object.assign(new Error("[CONVEX M(x)] Server Error"), {
      data: "Clear sentence.",
    });
    expect(errorMessage(e, "fallback")).toBe("Clear sentence.");
  });

  test("extracts the uncaught message from a dev-style error", () => {
    const e = new Error(
      "[CONVEX M(approvals:rejectSubmission)] [Request ID: abc] Server Error\nUncaught ConvexError: No rejectable entries.\n    at handler (approvals.ts:1)",
    );
    expect(errorMessage(e, "fallback")).toBe("No rejectable entries.");
  });

  test("never shows a bare Server Error", () => {
    const e = new Error(
      "[CONVEX M(approvals:rejectSubmission)] [Request ID: abc] Server Error",
    );
    expect(errorMessage(e, "Rejection failed.")).toBe("Rejection failed.");
  });

  test("falls back for non-errors", () => {
    expect(errorMessage("oops", "fallback")).toBe("fallback");
  });
});
