/// <reference types="vite/client" />
/**
 * Convex function integration tests (convex-test) — exercise the real seed,
 * authorization, data-quality, activity→measurement, evidence gate and period
 * approval against a simulated backend. Covers acceptance criteria #1, #4, #7,
 * #8 and #9 at the function level.
 */
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import schema from "./schema";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";

const modules = import.meta.glob("./**/*.ts");

function harness() {
  return convexTest(schema, modules);
}

type T = ReturnType<typeof harness>;

async function makeUser(
  t: T,
  opts: { email: string; roles?: string[]; employeeBusinessId?: string },
) {
  const userId = await t.run(async (ctx) => {
    let employeeId: Id<"employees"> | undefined;
    if (opts.employeeBusinessId) {
      const e = await ctx.db
        .query("employees")
        .withIndex("by_employeeId", (q) => q.eq("employeeId", opts.employeeBusinessId!))
        .first();
      employeeId = e?._id;
    }
    const uid = await ctx.db.insert("users", {
      email: opts.email,
      isActive: true,
      employeeId,
    });
    for (const role of opts.roles ?? []) {
      await ctx.db.insert("userRoleAssignments", {
        userId: uid,
        role: role as never,
        grantedAt: 0,
        isActive: true,
      });
    }
    return uid;
  });
  return { as: t.withIdentity({ subject: `${userId}|test` }), userId };
}

async function employeeIdByBiz(t: T, biz: string): Promise<Id<"employees">> {
  return await t.run(async (ctx) => {
    const e = await ctx.db
      .query("employees")
      .withIndex("by_employeeId", (q) => q.eq("employeeId", biz))
      .first();
    if (!e) throw new Error(`employee ${biz} not found`);
    return e._id;
  });
}

describe("seed + reconciliation (#1)", () => {
  test("imports 15 employees and 75 assignments with data-quality issues", async () => {
    const t = harness();
    const res = await t.mutation(internal.seed.seedBaseline, {});
    expect(res.employees).toBe(15);
    expect(res.assignments).toBe(75);
    expect(res.kpiDefinitions).toBeGreaterThan(0);
    expect(res.dataQualityIssues).toBeGreaterThan(0);
  });

  test("re-running the seed is idempotent (no duplicates)", async () => {
    const t = harness();
    await t.mutation(internal.seed.seedBaseline, {});
    await t.mutation(internal.seed.seedBaseline, {});
    const counts = await t.run(async (ctx) => ({
      employees: (await ctx.db.query("employees").collect()).length,
      assignments: (await ctx.db.query("kpiAssignments").collect()).length,
    }));
    expect(counts.employees).toBe(15);
    expect(counts.assignments).toBe(75);
  });
});

describe("authorization (#8)", () => {
  test("unauthenticated reads are rejected", async () => {
    const t = harness();
    await t.mutation(internal.seed.seedBaseline, {});
    await expect(t.query(api.overview.baselineSummary, {})).rejects.toThrow();
  });

  test("an employee can read their own detail but not another's", async () => {
    const t = harness();
    await t.mutation(internal.seed.seedBaseline, {});
    const { as: emp } = await makeUser(t, {
      email: "e@x.com",
      roles: ["employee"],
      employeeBusinessId: "IKD030835",
    });
    const ownId = await employeeIdByBiz(t, "IKD030835");
    const otherId = await employeeIdByBiz(t, "IKD041386");

    const detail = await emp.query(api.employees.getDetail, { employeeId: ownId });
    expect(detail.kpis.length).toBe(5);
    expect(detail.scorecard.configuredWeight).toBe(80);

    await expect(
      emp.query(api.employees.getDetail, { employeeId: otherId }),
    ).rejects.toThrow();
  });

  test("an admin can read any employee", async () => {
    const t = harness();
    await t.mutation(internal.seed.seedBaseline, {});
    const { as: admin } = await makeUser(t, {
      email: "a@x.com",
      roles: ["system_admin"],
    });
    const summary = await admin.query(api.overview.baselineSummary, {});
    expect(summary.employees).toBe(15);
    expect(summary.configuredWeightTotal).toBe(80);
  });
});

describe("data-quality resolution (#4)", () => {
  test("resolving the rubric requirement unblocks innovation KPIs", async () => {
    const t = harness();
    await t.mutation(internal.seed.seedBaseline, {});
    const { as: admin } = await makeUser(t, { email: "a@x.com", roles: ["kpi_admin"] });

    const countBlockedInnovation = async () =>
      t.run(async (ctx) => {
        const year = await ctx.db
          .query("performanceYears")
          .withIndex("by_year", (q) => q.eq("year", 2026))
          .first();
        const list = await ctx.db
          .query("kpiAssignments")
          .withIndex("by_year_key", (q) =>
            q.eq("performanceYearId", year!._id).eq("canonicalKey", "tech_innovation"),
          )
          .collect();
        return list.filter((a) => a.scoringBlocked).length;
      });

    const before = await countBlockedInnovation();
    expect(before).toBe(15); // all innovation KPIs blocked by the rubric requirement

    const issueId = await t.run(async (ctx) => {
      const i = await ctx.db
        .query("dataQualityIssues")
        .withIndex("by_code", (q) => q.eq("code", "rubric_required:tech_innovation"))
        .first();
      return i!._id;
    });
    await admin.mutation(api.dataQuality.resolveIssue, {
      issueId,
      decision: "resolve",
      note: "Rubric approved",
    });

    const after = await countBlockedInnovation();
    // Rows 18 (GIS Project Dashboard — ambiguous), 30 (truncated) and 54 (mismatch)
    // keep their own row-level blockers; the remaining innovation KPIs clear.
    expect(after).toBeLessThan(before);
    expect(after).toBe(3);
  });
});

describe("activity → measurement, evidence gate & approval (#7, #9)", () => {
  test("captures a measurement, blocks approval without evidence, then approves & snapshots", async () => {
    const t = harness();
    await t.mutation(internal.seed.seedBaseline, {});

    const empId = await employeeIdByBiz(t, "IKD034860");
    const { as: emp } = await makeUser(t, {
      email: "sheriff@x.com",
      roles: ["employee"],
      employeeBusinessId: "IKD034860",
    });
    const { as: mgr } = await makeUser(t, { email: "mgr@x.com", roles: ["manager"] });

    // The analyst's asset-integration KPI (ratio, not scoring-blocked).
    const assignmentId = await t.run(async (ctx) => {
      const year = await ctx.db
        .query("performanceYears")
        .withIndex("by_year", (q) => q.eq("year", 2026))
        .first();
      const list = await ctx.db
        .query("kpiAssignments")
        .withIndex("by_employee_year", (q) =>
          q.eq("employeeId", empId).eq("performanceYearId", year!._id),
        )
        .collect();
      return list.find((a) => a.canonicalKey === "asset_integration")!._id;
    });

    // Capture an activity: 9 / 10 = 90% attainment.
    await emp.mutation(api.activities.create, {
      kpiAssignmentId: assignmentId,
      periodKey: "2026-M08",
      activityAt: 1,
      title: "Integrated assets",
      description: "batch",
      numerator: 9,
      denominator: 10,
    });

    const measurement = async () =>
      t.run(async (ctx) =>
        ctx.db
          .query("kpiMeasurements")
          .withIndex("by_assignment_period", (q) =>
            q.eq("kpiAssignmentId", assignmentId).eq("periodKey", "2026-M08"),
          )
          .first(),
      );

    const m1 = await measurement();
    expect(m1?.cappedAttainment).toBe(0.9);
    expect(m1?.evidenceComplete).toBe(false); // evidence required, none approved yet

    // Approval blocked: required evidence not approved (#7).
    await expect(
      mgr.mutation(api.approvals.approveEmployeePeriod, {
        employeeId: empId,
        periodKey: "2026-M08",
      }),
    ).rejects.toThrow(/evidence/i);

    // Attach + approve evidence.
    const evidenceId = await emp.mutation(api.evidence.saveEvidence, {
      kpiAssignmentId: assignmentId,
      externalUrl: "https://example.com/qa-log",
      originalFilename: "qa-log",
      mimeType: "text/uri-list",
      fileSize: 0,
      category: "qa_log",
      title: "QA log",
    });
    await mgr.mutation(api.evidence.reviewEvidence, {
      evidenceId,
      decision: "approve",
    });

    const m2 = await measurement();
    expect(m2?.evidenceComplete).toBe(true);

    // Now approval succeeds and freezes a reproducible snapshot (#9).
    const result = await mgr.mutation(api.approvals.approveEmployeePeriod, {
      employeeId: empId,
      periodKey: "2026-M08",
    });
    expect(result.assignedWeightScore).toBeCloseTo(9, 5); // 0.9 × weight 10
    expect(result.configuredWeight).toBe(80);

    const snapshot = await t.run(async (ctx) =>
      ctx.db
        .query("scoreSnapshots")
        .withIndex("by_scope_period", (q) =>
          q.eq("scope", "individual").eq("scopeRef", empId).eq("periodKey", "2026-M08"),
        )
        .first(),
    );
    expect(snapshot).not.toBeNull();
    expect(snapshot?.approvalState).toBe("approved");
    expect(snapshot?.calcVersion).toBeTruthy();
  });
});

describe("admin lifecycle: revoke/unlink/deactivate + activity delete", () => {
  test("the last active System Admin cannot be revoked or deactivated", async () => {
    const t = harness();
    const { as: admin, userId: adminId } = await makeUser(t, {
      email: "admin@x.com",
      roles: ["system_admin"],
    });

    await expect(
      admin.mutation(api.access.revokeRole, {
        userId: adminId,
        role: "system_admin",
      }),
    ).rejects.toThrow(/last active System Admin/i);

    // Self-deactivation is always blocked.
    await expect(
      admin.mutation(api.access.setUserActive, { userId: adminId, isActive: false }),
    ).rejects.toThrow(/own account/i);

    // With a second admin the revoke goes through and is audit-logged.
    const { userId: secondId } = await makeUser(t, {
      email: "admin2@x.com",
      roles: ["system_admin"],
    });
    const res = await admin.mutation(api.access.revokeRole, {
      userId: secondId,
      role: "system_admin",
    });
    expect(res.revoked).toBe(1);
    const audit = await t.run(async (ctx) =>
      (await ctx.db.query("auditLogs").collect()).filter(
        (l) => l.action === "revoke_role",
      ),
    );
    expect(audit.length).toBe(1);
  });

  test("admin can unlink a user's roster employee; non-admin cannot", async () => {
    const t = harness();
    await t.mutation(internal.seed.seedBaseline, {});
    const { as: admin } = await makeUser(t, {
      email: "admin@x.com",
      roles: ["system_admin"],
    });
    const { as: emp, userId: empUserId } = await makeUser(t, {
      email: "e@x.com",
      roles: ["employee"],
      employeeBusinessId: "IKD030835",
    });

    await expect(
      emp.mutation(api.access.unlinkUserFromEmployee, { userId: empUserId }),
    ).rejects.toThrow();

    await admin.mutation(api.access.unlinkUserFromEmployee, { userId: empUserId });
    const linked = await t.run(async (ctx) => (await ctx.db.get(empUserId))?.employeeId);
    // convex-test surfaces an unset optional field as null.
    expect(linked ?? null).toBeNull();
  });

  test("owner deletes a submitted activity and the measurement recomputes", async () => {
    const t = harness();
    await t.mutation(internal.seed.seedBaseline, {});
    const empId = await employeeIdByBiz(t, "IKD034860");
    const { as: emp } = await makeUser(t, {
      email: "e@x.com",
      roles: ["employee"],
      employeeBusinessId: "IKD034860",
    });
    const { as: other } = await makeUser(t, {
      email: "other@x.com",
      roles: ["employee"],
      employeeBusinessId: "IKD030835",
    });

    const assignmentId = await t.run(async (ctx) => {
      const year = await ctx.db
        .query("performanceYears")
        .withIndex("by_year", (q) => q.eq("year", 2026))
        .first();
      const list = await ctx.db
        .query("kpiAssignments")
        .withIndex("by_employee_year", (q) =>
          q.eq("employeeId", empId).eq("performanceYearId", year!._id),
        )
        .collect();
      return list.find((a) => a.canonicalKey === "asset_integration")!._id;
    });

    const activityId = await emp.mutation(api.activities.create, {
      kpiAssignmentId: assignmentId,
      periodKey: "2026-M08",
      activityAt: 1,
      title: "Integrated assets",
      description: "batch",
      numerator: 9,
      denominator: 10,
    });

    // Someone else's employee account cannot delete it.
    await expect(other.mutation(api.activities.remove, { activityId })).rejects.toThrow();

    await emp.mutation(api.activities.remove, { activityId });

    const measurement = await t.run(async (ctx) =>
      ctx.db
        .query("kpiMeasurements")
        .withIndex("by_assignment_period", (q) =>
          q.eq("kpiAssignmentId", assignmentId).eq("periodKey", "2026-M08"),
        )
        .first(),
    );
    expect(measurement?.hasData).toBe(false);
    const audit = await t.run(async (ctx) =>
      (await ctx.db.query("auditLogs").collect()).filter(
        (l) => l.action === "delete_activity",
      ),
    );
    expect(audit.length).toBe(1);
  });
});

describe("activity capture: required fields + edit", () => {
  test("incomplete captures are rejected; edits recompute the measurement", async () => {
    const t = harness();
    await t.mutation(internal.seed.seedBaseline, {});
    const empId = await employeeIdByBiz(t, "IKD034860");
    const { as: emp } = await makeUser(t, {
      email: "e@x.com",
      roles: ["employee"],
      employeeBusinessId: "IKD034860",
    });
    const assignmentId = await t.run(async (ctx) => {
      const year = await ctx.db
        .query("performanceYears")
        .withIndex("by_year", (q) => q.eq("year", 2026))
        .first();
      const list = await ctx.db
        .query("kpiAssignments")
        .withIndex("by_employee_year", (q) =>
          q.eq("employeeId", empId).eq("performanceYearId", year!._id),
        )
        .collect();
      return list.find((a) => a.canonicalKey === "asset_integration")!._id;
    });

    const base = {
      kpiAssignmentId: assignmentId,
      periodKey: "2026-M08",
      activityAt: 1,
      title: "Integrated assets",
      description: "batch",
    };

    // Ratio mode requires both numerator and denominator, and non-empty notes.
    await expect(
      emp.mutation(api.activities.create, { ...base, numerator: 9 }),
    ).rejects.toThrow(/Denominator is required/i);
    await expect(
      emp.mutation(api.activities.create, {
        ...base,
        description: "  ",
        numerator: 9,
        denominator: 10,
      }),
    ).rejects.toThrow(/Notes are required/i);

    const activityId = await emp.mutation(api.activities.create, {
      ...base,
      numerator: 9,
      denominator: 10,
    });

    // Edit 9/10 → 8/10 and confirm the measurement follows.
    await emp.mutation(api.activities.update, {
      activityId,
      periodKey: "2026-M08",
      title: "Integrated assets (corrected)",
      description: "batch — corrected count",
      numerator: 8,
      denominator: 10,
    });
    const measurement = await t.run(async (ctx) =>
      ctx.db
        .query("kpiMeasurements")
        .withIndex("by_assignment_period", (q) =>
          q.eq("kpiAssignmentId", assignmentId).eq("periodKey", "2026-M08"),
        )
        .first(),
    );
    expect(measurement?.cappedAttainment).toBe(0.8);
  });
});

describe("evidence centre scope", () => {
  test("employees see only their own evidence; admins see all", async () => {
    const t = harness();
    await t.mutation(internal.seed.seedBaseline, {});
    const { as: emp } = await makeUser(t, {
      email: "e@x.com",
      roles: ["employee"],
      employeeBusinessId: "IKD034860",
    });
    const { as: other } = await makeUser(t, {
      email: "o@x.com",
      roles: ["employee"],
      employeeBusinessId: "IKD030835",
    });
    const { as: admin } = await makeUser(t, {
      email: "a@x.com",
      roles: ["system_admin"],
    });

    const empId = await employeeIdByBiz(t, "IKD034860");
    const assignmentId = await t.run(async (ctx) => {
      const list = await ctx.db
        .query("kpiAssignments")
        .withIndex("by_employee_year", (q) => q.eq("employeeId", empId))
        .collect();
      return list[0]!._id;
    });
    await emp.mutation(api.evidence.saveEvidence, {
      kpiAssignmentId: assignmentId,
      externalUrl: "https://example.com/report",
      originalFilename: "report",
      mimeType: "text/uri-list",
      fileSize: 0,
      category: "supporting_document",
      title: "August batch report",
    });

    expect((await emp.query(api.evidence.listCentre, {})).length).toBe(1);
    expect((await other.query(api.evidence.listCentre, {})).length).toBe(0);
    expect((await admin.query(api.evidence.listCentre, {})).length).toBe(1);
  });
});

describe("evidence deletion rules", () => {
  test("owner deletes pre-review evidence; approved needs an admin", async () => {
    const t = harness();
    await t.mutation(internal.seed.seedBaseline, {});
    const { as: emp } = await makeUser(t, {
      email: "e@x.com",
      roles: ["employee"],
      employeeBusinessId: "IKD034860",
    });
    const { as: mgr } = await makeUser(t, { email: "m@x.com", roles: ["manager"] });
    const { as: admin } = await makeUser(t, {
      email: "a@x.com",
      roles: ["system_admin"],
    });

    const empId = await employeeIdByBiz(t, "IKD034860");
    const assignmentId = await t.run(async (ctx) => {
      const list = await ctx.db
        .query("kpiAssignments")
        .withIndex("by_employee_year", (q) => q.eq("employeeId", empId))
        .collect();
      return list[0]!._id;
    });
    const mkEvidence = () =>
      emp.mutation(api.evidence.saveEvidence, {
        kpiAssignmentId: assignmentId,
        externalUrl: "https://example.com/r",
        originalFilename: "r",
        mimeType: "text/uri-list",
        fileSize: 0,
        category: "supporting_document",
        title: "Report",
      });

    // Owner can delete while submitted.
    const e1 = await mkEvidence();
    await emp.mutation(api.evidence.removeEvidence, { evidenceId: e1 });
    expect((await emp.query(api.evidence.listCentre, {})).length).toBe(0);

    // Once approved, the owner is blocked but an admin may delete.
    const e2 = await mkEvidence();
    await mgr.mutation(api.evidence.reviewEvidence, {
      evidenceId: e2,
      decision: "approve",
    });
    await expect(
      emp.mutation(api.evidence.removeEvidence, { evidenceId: e2 }),
    ).rejects.toThrow(/Admin/i);
    await admin.mutation(api.evidence.removeEvidence, { evidenceId: e2 });
    expect((await admin.query(api.evidence.listCentre, {})).length).toBe(0);
  });
});

describe("submission rejection", () => {
  test("rejecting returns activities to needs_changes; editing re-submits", async () => {
    const t = harness();
    await t.mutation(internal.seed.seedBaseline, {});
    const empId = await employeeIdByBiz(t, "IKD034860");
    const { as: emp } = await makeUser(t, {
      email: "e@x.com",
      roles: ["employee"],
      employeeBusinessId: "IKD034860",
    });
    const { as: admin } = await makeUser(t, {
      email: "a@x.com",
      roles: ["system_admin"],
    });
    const assignmentId = await t.run(async (ctx) => {
      const list = await ctx.db
        .query("kpiAssignments")
        .withIndex("by_employee_year", (q) => q.eq("employeeId", empId))
        .collect();
      return list.find((a) => a.canonicalKey === "asset_integration")!._id;
    });
    const activityId = await emp.mutation(api.activities.create, {
      kpiAssignmentId: assignmentId,
      periodKey: "2026-M08",
      activityAt: 1,
      title: "Integrated assets",
      description: "batch",
      numerator: 9,
      denominator: 10,
    });

    // Reason is mandatory.
    await expect(
      admin.mutation(api.approvals.rejectSubmission, {
        kpiAssignmentId: assignmentId,
        periodKey: "2026-M08",
        reason: "  ",
      }),
    ).rejects.toThrow(/reason/i);

    const res = await admin.mutation(api.approvals.rejectSubmission, {
      kpiAssignmentId: assignmentId,
      periodKey: "2026-M08",
      reason: "Numbers don't match the batch report",
    });
    expect(res.returned).toBe(1);
    const status = await t.run(async (ctx) => (await ctx.db.get(activityId))!.status);
    expect(status).toBe("needs_changes");
    const review = await t.run(async (ctx) =>
      (await ctx.db.query("reviews").collect()).find(
        (r) => r.decision === "request_changes",
      ),
    );
    expect(review?.comment).toMatch(/batch report/);

    // Editing the returned entry re-submits it for review.
    await emp.mutation(api.activities.update, {
      activityId,
      periodKey: "2026-M08",
      title: "Integrated assets (corrected)",
      description: "batch — matched to report",
      numerator: 8,
      denominator: 10,
    });
    const after = await t.run(async (ctx) => (await ctx.db.get(activityId))!.status);
    expect(after).toBe("submitted");
  });
});

describe("score overrides", () => {
  test("override supersedes the computed value, survives recompute, and reverts on removal", async () => {
    const t = harness();
    await t.mutation(internal.seed.seedBaseline, {});
    const empId = await employeeIdByBiz(t, "IKD034860");
    const { as: emp } = await makeUser(t, {
      email: "e@x.com",
      roles: ["employee"],
      employeeBusinessId: "IKD034860",
    });
    const { as: admin } = await makeUser(t, {
      email: "a@x.com",
      roles: ["kpi_admin"],
    });
    const assignmentId = await t.run(async (ctx) => {
      const list = await ctx.db
        .query("kpiAssignments")
        .withIndex("by_employee_year", (q) => q.eq("employeeId", empId))
        .collect();
      return list.find((a) => a.canonicalKey === "asset_integration")!._id;
    });
    await emp.mutation(api.activities.create, {
      kpiAssignmentId: assignmentId,
      periodKey: "2026-M08",
      activityAt: 1,
      title: "Integrated assets",
      description: "10 of 15 planned — only 10 arrived",
      numerator: 10,
      denominator: 15,
    });

    const measurement = async () =>
      t.run(async (ctx) =>
        ctx.db
          .query("kpiMeasurements")
          .withIndex("by_assignment_period", (q) =>
            q.eq("kpiAssignmentId", assignmentId).eq("periodKey", "2026-M08"),
          )
          .first(),
      );
    expect((await measurement())?.cappedAttainment).toBeCloseTo(10 / 15, 5);

    // Reason is mandatory; employees cannot override.
    await expect(
      admin.mutation(api.overrides.apply, {
        kpiAssignmentId: assignmentId,
        periodKey: "2026-M08",
        overrideValue: 1,
        reason: " ",
      }),
    ).rejects.toThrow(/reason/i);
    await expect(
      emp.mutation(api.overrides.apply, {
        kpiAssignmentId: assignmentId,
        periodKey: "2026-M08",
        overrideValue: 1,
        reason: "self-serve",
      }),
    ).rejects.toThrow();

    await admin.mutation(api.overrides.apply, {
      kpiAssignmentId: assignmentId,
      periodKey: "2026-M08",
      overrideValue: 1,
      reason: "Only 10 projects arrived; all captured — counted as met.",
    });
    expect((await measurement())?.cappedAttainment).toBe(1);
    expect((await measurement())?.status).toBe("on_target");

    // A recompute (e.g. the employee edits the entry) keeps the override.
    const activityId = await t.run(
      async (ctx) =>
        (await ctx.db.query("activities").collect()).find(
          (a) => a.kpiAssignmentId === assignmentId,
        )!._id,
    );
    await emp.mutation(api.activities.update, {
      activityId,
      periodKey: "2026-M08",
      title: "Integrated assets",
      description: "corrected",
      numerator: 10,
      denominator: 15,
    });
    expect((await measurement())?.cappedAttainment).toBe(1);

    // Removing the override restores the engine value.
    const overrideId = await t.run(
      async (ctx) => (await ctx.db.query("scoreOverrides").collect())[0]!._id,
    );
    await admin.mutation(api.overrides.remove, { overrideId });
    expect((await measurement())?.cappedAttainment).toBeCloseTo(10 / 15, 5);
  });
});
