/**
 * Idempotent seed / import of the 2026 KPI baseline.
 *
 * Run with:  npx convex run seed:seedBaseline
 * Reset with: npx convex run seed:resetAll   (dev only)
 *
 * Everything below derives from the verbatim workbook rows and the canonical
 * catalogue. Re-running is safe: rows are matched by natural keys and merged,
 * never duplicated. Source values are preserved on every assignment; every
 * normalization is recorded as a dataQualityIssue.
 */
import { internalMutation } from "./_generated/server";
import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import {
  canonicalizeLocation,
  canonicalizeText,
  classifyCanonicalKey,
  getTemplate,
  ROLE_TEMPLATES,
} from "./lib/catalogue";
import { detectDataQualityIssues } from "./lib/dataQuality";
import { splitName } from "./lib/format";
import { generateYearPeriods } from "./lib/periods";
import { SOURCE_ROWS } from "./lib/sourceRows";
import {
  BASELINE_PERFORMANCE_YEAR,
  PERFORMANCE_TIMEZONE,
  type Frequency,
  type JobRole,
} from "./lib/types";
import { recordAudit } from "./audit";

const ROLE_ORDER: Record<string, number> = {
  "Geographic Information Systems Lead": 1,
  "Geo Database Specialist": 2,
  "Geographic Information Systems Specialist": 3,
  "Geographic Information Systems Analyst": 4,
};

export const seedBaseline = internalMutation({
  args: {},
  returns: v.object({
    organizationId: v.id("organizations"),
    performanceYearId: v.id("performanceYears"),
    employees: v.number(),
    assignments: v.number(),
    kpiDefinitions: v.number(),
    dataQualityIssues: v.number(),
    periods: v.number(),
  }),
  handler: async (ctx) => {
    // --- Organization structure -----------------------------------------
    const org = await ctx.db
      .query("organizations")
      .withIndex("by_name", (q) => q.eq("name", "Ikeja Electric"))
      .first();
    const organizationId =
      org?._id ??
      (await ctx.db.insert("organizations", { name: "Ikeja Electric", shortName: "IE" }));

    const departments = await ctx.db
      .query("departments")
      .withIndex("by_org", (q) => q.eq("organizationId", organizationId))
      .collect();
    const departmentId =
      departments.find((d) => d.name === "Technical Services")?._id ??
      (await ctx.db.insert("departments", {
        organizationId,
        name: "Technical Services",
      }));

    const units = await ctx.db
      .query("units")
      .withIndex("by_department", (q) => q.eq("departmentId", departmentId))
      .collect();
    const unitId =
      units.find((u) => u.name === "Technical Optimization")?._id ??
      (await ctx.db.insert("units", {
        departmentId,
        name: "Technical Optimization",
      }));

    const teams = await ctx.db
      .query("teams")
      .withIndex("by_unit", (q) => q.eq("unitId", unitId))
      .collect();
    const teamId =
      teams.find((t) => t.slug === "gis-unit")?._id ??
      (await ctx.db.insert("teams", { unitId, name: "GIS Unit", slug: "gis-unit" }));

    // --- Locations (canonical + observed source variants) ---------------
    const variantsByCanonical = new Map<string, Set<string>>();
    for (const r of SOURCE_ROWS) {
      const canon = canonicalizeLocation(r.sourceLocation);
      const set = variantsByCanonical.get(canon) ?? new Set<string>();
      set.add(r.sourceLocation);
      variantsByCanonical.set(canon, set);
    }
    const locationIdByName = new Map<string, Id<"locations">>();
    for (const [canon, variants] of variantsByCanonical) {
      const existing = await ctx.db
        .query("locations")
        .withIndex("by_name", (q) => q.eq("name", canon))
        .first();
      const id =
        existing?._id ??
        (await ctx.db.insert("locations", {
          name: canon,
          sourceVariants: Array.from(variants),
          isActive: true,
        }));
      locationIdByName.set(canon, id);
    }

    // --- Job roles ------------------------------------------------------
    const jobRoleIdByTitle = new Map<string, Id<"jobRoles">>();
    for (const title of Array.from(new Set(SOURCE_ROWS.map((r) => r.sourceRole)))) {
      const existing = await ctx.db
        .query("jobRoles")
        .withIndex("by_title", (q) => q.eq("title", title))
        .first();
      const id =
        existing?._id ??
        (await ctx.db.insert("jobRoles", {
          title,
          displayOrder: ROLE_ORDER[title] ?? 99,
        }));
      jobRoleIdByTitle.set(title, id);
    }

    // --- Employees ------------------------------------------------------
    const employeeIdByBusinessKey = new Map<string, Id<"employees">>();
    const firstRowByEmp = new Map<string, (typeof SOURCE_ROWS)[number]>();
    for (const r of SOURCE_ROWS) {
      if (!firstRowByEmp.has(r.sourceEmployeeId))
        firstRowByEmp.set(r.sourceEmployeeId, r);
    }
    const orderedEmps = Array.from(firstRowByEmp.values()).sort((a, b) => {
      const ro = (ROLE_ORDER[a.sourceRole] ?? 99) - (ROLE_ORDER[b.sourceRole] ?? 99);
      if (ro !== 0) return ro;
      return a.sourceEmployeeName.localeCompare(b.sourceEmployeeName);
    });
    let displayOrder = 0;
    for (const r of orderedEmps) {
      const canonLoc = canonicalizeLocation(r.sourceLocation);
      const { honorific, displayName } = splitName(r.sourceEmployeeName);
      const existing = await ctx.db
        .query("employees")
        .withIndex("by_employeeId", (q) => q.eq("employeeId", r.sourceEmployeeId))
        .first();
      const doc = {
        employeeId: r.sourceEmployeeId,
        fullName: r.sourceEmployeeName,
        honorific: honorific ?? undefined,
        displayName,
        jobRole: r.sourceRole,
        jobRoleId: jobRoleIdByTitle.get(r.sourceRole),
        teamId,
        locationId: locationIdByName.get(canonLoc),
        sourceLocation: r.sourceLocation,
        canonicalLocation: canonLoc,
        displayOrder: displayOrder++,
        isActive: true,
      };
      const id = existing?._id ?? (await ctx.db.insert("employees", doc));
      if (existing) await ctx.db.patch(existing._id, doc);
      employeeIdByBusinessKey.set(r.sourceEmployeeId, id);
    }

    // --- Performance year + tracking periods ----------------------------
    const yearRow = await ctx.db
      .query("performanceYears")
      .withIndex("by_year", (q) => q.eq("year", BASELINE_PERFORMANCE_YEAR))
      .first();
    const performanceYearId =
      yearRow?._id ??
      (await ctx.db.insert("performanceYears", {
        year: BASELINE_PERFORMANCE_YEAR,
        timezone: PERFORMANCE_TIMEZONE,
        status: "open",
        normalizationEnabled: false,
        officialAttainmentCap: 1,
        stretchAttainmentCap: 1.2,
      }));

    let periodCount = 0;
    for (const p of generateYearPeriods(BASELINE_PERFORMANCE_YEAR)) {
      const existing = await ctx.db
        .query("trackingPeriods")
        .withIndex("by_periodKey", (q) => q.eq("periodKey", p.periodKey))
        .first();
      if (!existing) {
        await ctx.db.insert("trackingPeriods", {
          performanceYearId,
          grain: p.grain,
          periodKey: p.periodKey,
          label: p.label,
          startAt: p.startAt,
          endAt: p.endAt,
          dueAt: p.dueAt,
          status: "open",
        });
        periodCount++;
      }
    }

    // --- KPI definitions (from canonical role templates) ----------------
    const definitionIdByRoleKey = new Map<string, Id<"kpiDefinitions">>();
    let defCount = 0;
    for (const role of Object.keys(ROLE_TEMPLATES) as JobRole[]) {
      for (const t of ROLE_TEMPLATES[role]) {
        const mapKey = `${role}::${t.key}`;
        const existing = await ctx.db
          .query("kpiDefinitions")
          .withIndex("by_role_key", (q) =>
            q.eq("jobRole", role).eq("canonicalKey", t.key),
          )
          .first();
        if (existing) {
          definitionIdByRoleKey.set(mapKey, existing._id);
          continue;
        }
        const defId = await ctx.db.insert("kpiDefinitions", {
          canonicalKey: t.key,
          jobRole: role,
          title: t.title,
          canonicalObjective: t.canonicalObjective,
          canonicalMetric: t.canonicalMetric,
          measurementMode: t.measurementMode,
          direction: t.direction,
          targetType: t.targetType,
          defaultTarget: t.target,
          unit: t.unit,
          frequency: t.frequency,
          defaultWeight: t.weight,
          evidenceRequired: t.evidenceRequired,
          needsRubric: t.needsRubric ?? false,
          needsClarification: t.needsClarification ?? false,
          scoringNotes: t.scoringNotes,
          status: "active",
          currentVersion: 1,
        });
        await ctx.db.insert("kpiDefinitionVersions", {
          kpiDefinitionId: defId,
          version: 1,
          effectiveFrom: Date.now(),
          snapshot: t,
          changeReason: "Seed baseline import",
          createdAt: Date.now(),
        });
        definitionIdByRoleKey.set(mapKey, defId);
        defCount++;
      }
    }

    // --- Import batch ---------------------------------------------------
    const committedBatches = await ctx.db
      .query("importBatches")
      .withIndex("by_state", (q) => q.eq("state", "committed"))
      .collect();
    const existingBatch = committedBatches.find(
      (b) => b.fileName === "GIS 2026 PO Settings-3.xlsx",
    );
    const importBatchId =
      existingBatch?._id ??
      (await ctx.db.insert("importBatches", {
        fileName: "GIS 2026 PO Settings-3.xlsx",
        sheetName: "KPI Template",
        performanceYearId,
        state: "committed",
        sourceRowCount: SOURCE_ROWS.length,
        importedRowCount: 0,
        employeeCount: employeeIdByBusinessKey.size,
        createdAt: Date.now(),
        committedAt: Date.now(),
      }));

    // --- KPI assignments (canonical snapshot + verbatim source layer) ---
    const issues = detectDataQualityIssues();
    const blockingRows = new Set<number>();
    for (const i of issues) {
      if (i.blocksScoring && i.sourceRowNumber !== undefined)
        blockingRows.add(i.sourceRowNumber);
    }

    const assignmentIdByRow = new Map<number, Id<"kpiAssignments">>();
    let importedRows = 0;
    for (const r of SOURCE_ROWS) {
      const role = r.sourceRole as JobRole;
      const key = classifyCanonicalKey(r.sourceObjective);
      const template = getTemplate(role, key);
      if (!template) {
        throw new Error(`No template for ${role} / ${key} (row ${r.sourceRowNumber})`);
      }
      const employeeId = employeeIdByBusinessKey.get(r.sourceEmployeeId)!;
      const orderIndex = ROLE_TEMPLATES[role].findIndex((t) => t.key === key);

      // The rubric requirement blocks all innovation rows until a rubric exists.
      const scoringBlocked =
        blockingRows.has(r.sourceRowNumber) || key === "tech_innovation";
      // Row 32 has a blank source cadence — fall back to the template frequency
      // (Monthly) while the missing_frequency data-quality issue stays open.
      const canonicalFreq: Frequency =
        (r.sourceFrequency as Frequency | null) ?? template.frequency;

      const existingAssignments = await ctx.db
        .query("kpiAssignments")
        .withIndex("by_employee_year", (q) =>
          q.eq("employeeId", employeeId).eq("performanceYearId", performanceYearId),
        )
        .collect();
      const existing = existingAssignments.find(
        (a) => a.sourceRowNumber === r.sourceRowNumber,
      );

      const doc = {
        performanceYearId,
        employeeId,
        kpiDefinitionId: definitionIdByRoleKey.get(`${role}::${key}`),
        canonicalKey: key,
        objective: canonicalizeText(r.sourceObjective),
        metric: canonicalizeText(r.sourceMetric),
        weight: r.sourceWeight,
        target: r.sourceTarget,
        targetType: template.targetType,
        frequency: canonicalFreq,
        measurementMode: template.measurementMode,
        direction: template.direction,
        scoreCap: 1,
        stretchCap: 1.2,
        evidenceRequired: template.evidenceRequired,
        sourceRowNumber: r.sourceRowNumber,
        sourceObjective: r.sourceObjective,
        sourceMetric: r.sourceMetric,
        sourceWeight: r.sourceWeight,
        sourceTarget: r.sourceTarget,
        sourceTargetType: r.sourceTargetType,
        sourceFrequency: r.sourceFrequency,
        status: "active" as const,
        scoringBlocked,
        displayOrder: orderIndex,
        importBatchId,
        createdAt: Date.now(),
      };

      const id = existing?._id ?? (await ctx.db.insert("kpiAssignments", doc));
      if (existing) await ctx.db.patch(existing._id, doc);
      assignmentIdByRow.set(r.sourceRowNumber, id);

      const existingRow = await ctx.db
        .query("importRows")
        .withIndex("by_batch_row", (q) =>
          q.eq("importBatchId", importBatchId).eq("sourceRowNumber", r.sourceRowNumber),
        )
        .first();
      if (!existingRow) {
        await ctx.db.insert("importRows", {
          importBatchId,
          sourceRowNumber: r.sourceRowNumber,
          raw: r,
          canonical: {
            canonicalKey: key,
            objective: doc.objective,
            metric: doc.metric,
            targetType: doc.targetType,
            frequency: doc.frequency,
          },
          outcome: "imported",
          messages: [],
        });
      }
      importedRows++;
    }
    await ctx.db.patch(importBatchId, { importedRowCount: importedRows });

    // --- Data quality issues -------------------------------------------
    for (const issue of issues) {
      const existing = await ctx.db
        .query("dataQualityIssues")
        .withIndex("by_code", (q) => q.eq("code", issue.code))
        .first();
      const doc = {
        code: issue.code,
        performanceYearId,
        importBatchId,
        category: issue.category,
        severity: issue.severity,
        status: issue.initialStatus,
        employeeId: issue.employeeId
          ? employeeIdByBusinessKey.get(issue.employeeId)
          : undefined,
        kpiAssignmentId:
          issue.sourceRowNumber !== undefined
            ? assignmentIdByRow.get(issue.sourceRowNumber)
            : undefined,
        sourceRowNumber: issue.sourceRowNumber,
        canonicalKey: issue.canonicalKey,
        field: issue.field,
        sourceValue: issue.sourceValue ?? undefined,
        proposedValue: issue.proposedValue ?? undefined,
        reason: issue.reason,
        blocksScoring: issue.blocksScoring,
        createdAt: Date.now(),
      };
      if (existing) {
        await ctx.db.patch(existing._id, {
          reason: doc.reason,
          proposedValue: doc.proposedValue,
          employeeId: doc.employeeId,
          kpiAssignmentId: doc.kpiAssignmentId,
        });
      } else {
        await ctx.db.insert("dataQualityIssues", doc);
      }
    }

    await recordAudit(ctx, {
      entityType: "importBatch",
      entityId: importBatchId,
      action: "seed_baseline",
      after: {
        employees: employeeIdByBusinessKey.size,
        assignments: importedRows,
        kpiDefinitions: defCount,
        dataQualityIssues: issues.length,
      },
    });

    return {
      organizationId,
      performanceYearId,
      employees: employeeIdByBusinessKey.size,
      assignments: importedRows,
      kpiDefinitions: defCount,
      dataQualityIssues: issues.length,
      periods: periodCount,
    };
  },
});

/** DEV ONLY — wipes all domain tables (keeps auth tables). */
export const resetAll = internalMutation({
  args: {},
  returns: v.object({ deleted: v.number() }),
  handler: async (ctx) => {
    const tables = [
      "dataQualityIssues",
      "importRows",
      "importBatches",
      "kpiAssignments",
      "kpiDefinitionVersions",
      "kpiDefinitions",
      "kpiMeasurements",
      "activities",
      "evidenceLinks",
      "evidenceFiles",
      "reviews",
      "approvals",
      "comments",
      "scoreOverrides",
      "scoreSnapshots",
      "reportJobs",
      "generatedReports",
      "reportAccessLogs",
      "notifications",
      "reminderJobs",
      "trackingPeriods",
      "performanceYears",
      "employees",
      "jobRoles",
      "locations",
      "teams",
      "units",
      "departments",
      "organizations",
      "auditLogs",
    ] as const;
    let deleted = 0;
    for (const table of tables) {
      // Bounded batches keep the reset within mutation limits (dev-only utility).
      let batch = await ctx.db.query(table).take(500);
      while (batch.length > 0) {
        for (const row of batch) {
          await ctx.db.delete(row._id);
          deleted++;
        }
        batch = await ctx.db.query(table).take(500);
      }
    }
    return { deleted };
  },
});
