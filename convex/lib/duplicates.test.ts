import { describe, expect, test } from "vitest";
import { crossEmployeeDuplicates, duplicateKeys } from "./duplicates";

const file = (id: string, employeeId: string, extra: Record<string, unknown> = {}) => ({
  id,
  employeeId,
  originalFilename: "report.pdf",
  fileSize: 1000,
  ...extra,
});

describe("duplicate evidence detection", () => {
  test("matches checksum, link, or filename + size across employees", () => {
    const dups = crossEmployeeDuplicates([
      file("a", "e1", { checksum: "ABC", originalFilename: "x.pdf" }),
      file("b", "e2", { checksum: "abc", originalFilename: "y.pdf" }),
      file("c", "e3", { externalUrl: "https://x.com/doc", fileSize: 0 }),
      file("d", "e4", { externalUrl: "https://X.com/doc ", fileSize: 0 }),
      file("e", "e5", { originalFilename: "Map.png", fileSize: 42 }),
      file("f", "e6", { originalFilename: "map.png", fileSize: 42 }),
    ]);
    expect([...dups.get("a")!]).toEqual(["e2"]);
    expect([...dups.get("b")!]).toEqual(["e1"]);
    expect([...dups.get("c")!]).toEqual(["e4"]);
    expect([...dups.get("e")!]).toEqual(["e6"]);
  });

  test("ignores the same employee, a different size, and name-only links", () => {
    const dups = crossEmployeeDuplicates([
      file("a", "e1", { checksum: "abc" }),
      file("b", "e1", { checksum: "abc" }),
      file("c", "e2", { fileSize: 999 }),
      file("d", "e3", { fileSize: 0 }),
      file("e", "e4", { fileSize: 0 }),
    ]);
    expect(dups.size).toBe(0);
    expect(duplicateKeys(file("x", "e1", { fileSize: 0 }))).toEqual([]);
  });
});
