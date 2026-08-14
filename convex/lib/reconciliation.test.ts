import { describe, expect, it } from "vitest";
import {
  canonicalizeLocation,
  canonicalizeText,
  classifyCanonicalKey,
  ROLE_TEMPLATES,
  ROLE_WEIGHT_TOTALS,
} from "./catalogue";
import { detectDataQualityIssues } from "./dataQuality";
import { SOURCE_ROWS, WORKBOOK_META } from "./sourceRows";
import { CANONICAL_KPI_KEYS, JOB_ROLES } from "./types";

describe("workbook reconciliation invariants", () => {
  it("imports exactly 75 KPI assignment rows", () => {
    expect(SOURCE_ROWS.length).toBe(75);
    expect(WORKBOOK_META.dataRowCount).toBe(75);
  });

  it("covers exactly 15 employees", () => {
    const ids = new Set(SOURCE_ROWS.map((r) => r.sourceEmployeeId));
    expect(ids.size).toBe(15);
    expect(WORKBOOK_META.employeeCount).toBe(15);
  });

  it("every employee has 5 KPIs summing to a configured weight of 80", () => {
    const byEmp = new Map<string, { count: number; weight: number }>();
    for (const r of SOURCE_ROWS) {
      const cur = byEmp.get(r.sourceEmployeeId) ?? { count: 0, weight: 0 };
      cur.count += 1;
      cur.weight += r.sourceWeight;
      byEmp.set(r.sourceEmployeeId, cur);
    }
    for (const [, v] of byEmp) {
      expect(v.count).toBe(5);
      expect(v.weight).toBe(80);
    }
  });

  it("matches the source frequency distribution", () => {
    const counts: Record<string, number> = {};
    for (const r of SOURCE_ROWS) {
      const f = r.sourceFrequency ?? "(blank)";
      counts[f] = (counts[f] ?? 0) + 1;
    }
    expect(counts).toEqual({
      Monthly: 31,
      Annually: 15,
      Weekly: 10,
      Daily: 12,
      Quarterly: 6,
      "(blank)": 1,
    });
  });

  it("matches the source target-type distribution (Percentage 44 / Number 31)", () => {
    const counts: Record<string, number> = {};
    for (const r of SOURCE_ROWS)
      counts[r.sourceTargetType] = (counts[r.sourceTargetType] ?? 0) + 1;
    expect(counts).toEqual({ Percentage: 44, Number: 31 });
  });

  it("classifies every objective to a known canonical KPI key", () => {
    for (const r of SOURCE_ROWS) {
      const key = classifyCanonicalKey(r.sourceObjective);
      expect(CANONICAL_KPI_KEYS).toContain(key);
    }
  });

  it("preserves S/N as blank (internal IDs are generated)", () => {
    expect(SOURCE_ROWS.every((r) => r.sourceSN === null)).toBe(true);
  });
});

describe("canonical role templates", () => {
  it("defines all four job roles, each totalling weight 80", () => {
    for (const role of JOB_ROLES) {
      expect(ROLE_TEMPLATES[role]).toHaveLength(5);
      expect(ROLE_WEIGHT_TOTALS[role]).toBe(80);
    }
  });
});

describe("text & location canonicalisation (typos fixed only in canonical layer)", () => {
  it("fixes named typos", () => {
    expect(canonicalizeText("one oustanding  new technologies")).toBe(
      "one outstanding new technologies",
    );
    expect(canonicalizeText("Percentage Archieved / Planned")).toBe(
      "Percentage Achieved / Planned",
    );
    expect(canonicalizeText("during maitenance window")).toBe(
      "during maintenance window",
    );
    expect(canonicalizeText("all IE network assets.ts ")).toBe("all IE network assets");
    expect(canonicalizeText("the agreed-upon time timelines")).toBe(
      "the agreed-upon timelines",
    );
  });

  it("strips stray quotes and unifies 24-hour wording", () => {
    expect(
      canonicalizeText(
        '"Number of GIS Technical Issues resolved within 24hrs / Total issues × 100 "',
      ),
    ).toBe(
      "Number of GIS Technical Issues resolved within 24 hours / Total issues × 100",
    );
    expect(canonicalizeText("Resolve 100% of GIS technical issues within 24")).toBe(
      "Resolve 100% of GIS technical issues within 24 hours",
    );
  });

  it("proposes the canonical Akowonjo location", () => {
    expect(canonicalizeLocation("Akowonjo BU")).toBe("Akowonjo B/U");
    expect(canonicalizeLocation("Akowonjo B/U")).toBe("Akowonjo B/U");
  });
});

describe("data-quality detection (nothing silently corrected)", () => {
  const issues = detectDataQualityIssues();
  const of = (cat: string) => issues.filter((i) => i.category === cat);

  it("flags the blank row-32 frequency and proposes Monthly", () => {
    const mf = of("missing_frequency");
    expect(mf).toHaveLength(1);
    expect(mf[0]!.sourceRowNumber).toBe(32);
    expect(mf[0]!.proposedValue).toBe("Monthly");
    expect(mf[0]!.blocksScoring).toBe(true);
  });

  it("flags the 80/100 weight gap for all 15 employees", () => {
    const wi = of("weight_incomplete");
    expect(wi).toHaveLength(15);
    expect(wi.every((i) => i.sourceValue === 80)).toBe(true);
  });

  it("proposes the Akowonjo B/U location for the 5 variant rows", () => {
    const lv = of("location_variant");
    expect(lv).toHaveLength(5);
    expect(lv.every((i) => i.proposedValue === "Akowonjo B/U")).toBe(true);
  });

  it("flags the Geo-DB unit mismatch (reduce-by-20% typed as Number/20)", () => {
    const um = of("unit_mismatch");
    expect(um).toHaveLength(1);
    expect(um[0]!.sourceRowNumber).toBe(16);
    expect(um[0]!.blocksScoring).toBe(true);
  });

  it("flags the mis-copied innovation metric (row 54) and the truncated one (row 30)", () => {
    expect(of("metric_mismatch").map((i) => i.sourceRowNumber)).toEqual([54]);
    expect(of("metric_truncated").map((i) => i.sourceRowNumber)).toEqual([30]);
  });

  it("flags the ambiguous metrics (GDB Folders, GIS Project Dashboard, composite rule)", () => {
    const ma = of("metric_ambiguous");
    expect(ma.length).toBe(3);
    const rows = ma.map((i) => i.sourceRowNumber).sort((a, b) => (a ?? 0) - (b ?? 0));
    expect(rows).toEqual([14, 17, 18]);
  });

  it("requires an approved rubric for qualitative innovation", () => {
    expect(of("rubric_required")).toHaveLength(1);
  });

  it("proposes typo normalizations (source preserved, proposal recorded)", () => {
    const typos = of("typo_normalization");
    expect(typos.length).toBeGreaterThan(0);
    const oustanding = typos.find(
      (i) => typeof i.sourceValue === "string" && i.sourceValue.includes("oustanding"),
    );
    expect(oustanding).toBeDefined();
    expect(String(oustanding!.proposedValue)).toContain("outstanding");
  });
});
