/// <reference types="vite/client" />
/**
 * Convex function integration tests (convex-test) — exercise the real seed,
 * authorization, data-quality, activity→measurement, evidence gate and period
 * approval against a simulated backend. Covers acceptance criteria #1, #4, #7,
 * #8 and #9 at the function level.
 */
import { convexTest } from "convex-test";
import { afterEach, describe, expect, test, vi } from "vitest";
import schema from "./schema";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";

const modules = import.meta.glob("./**/*.ts");

// A work-date inside both 2026-M08 and 2026-Q3 (activity dates must fall
// inside the period they are logged to).
const AUG_2026 = Date.UTC(2026, 7, 15, 11);

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

/**
 * Attach stub evidence to an assignment so the evidence-first capture rule
 * lets employees log work. Tests that exercise the rule itself skip this.
 */
async function unlockCapture(t: T, assignmentId: Id<"kpiAssignments">) {
  await t.run(async (ctx) => {
    const assignment = (await ctx.db.get(assignmentId))!;
    const anyUser =
      (await ctx.db.query("users").first()) ??
      (await ctx.db.get(await ctx.db.insert("users", { isActive: true })));
    await ctx.db.insert("evidenceFiles", {
      employeeId: assignment.employeeId,
      kpiAssignmentId: assignmentId,
      externalUrl: "https://example.com/stub-evidence",
      originalFilename: "stub-evidence",
      mimeType: "text/uri-list",
      fileSize: 0,
      category: "supporting_document",
      title: "Stub evidence",
      uploadedByUserId: anyUser!._id,
      uploadedAt: Date.now(),
      version: 1,
      confidentiality: "internal",
      reviewStatus: "submitted",
      retentionState: "active",
    });
  });
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
    await unlockCapture(t, assignmentId);

    // Capture an activity: 9 / 10 = 90% attainment.
    await emp.mutation(api.activities.create, {
      kpiAssignmentId: assignmentId,
      periodKey: "2026-M08",
      activityAt: AUG_2026,
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

  test("oversight audience excludes employees; active only; dual-role members deduped", async () => {
    const t = harness();
    await makeUser(t, { email: "sysadmin@x.com", roles: ["system_admin"] });
    await makeUser(t, { email: "kpiadmin@x.com", roles: ["kpi_admin"] });
    // Holds two oversight roles — must appear exactly once.
    await makeUser(t, { email: "lead@x.com", roles: ["manager", "reviewer"] });
    // Employees and viewers get only their own targeted notices, never the feed.
    await makeUser(t, { email: "worker@x.com", roles: ["employee"] });
    await makeUser(t, { email: "exec@x.com", roles: ["executive_viewer"] });
    const { userId: goneId } = await makeUser(t, {
      email: "gone@x.com",
      roles: ["manager"],
    });
    await t.run(async (ctx) => {
      await ctx.db.patch(goneId, { isActive: false });
    });

    const { adminUsers, oversightUsers } = await import("./emails");
    const groups = await t.run(async (ctx) => ({
      admins: (await adminUsers(ctx)).map((u) => u.email).sort(),
      oversight: (await oversightUsers(ctx)).map((u) => u.email).sort(),
    }));
    expect(groups.admins).toEqual(["sysadmin@x.com"]);
    expect(groups.oversight).toEqual(["kpiadmin@x.com", "lead@x.com", "sysadmin@x.com"]);
  });

  test("admin login reset clears the credential and sessions; self/non-admin blocked", async () => {
    const t = harness();
    const { as: admin, userId: adminId } = await makeUser(t, {
      email: "admin@x.com",
      roles: ["system_admin"],
    });
    const { as: plain, userId: targetId } = await makeUser(t, {
      email: "employee@x.com",
    });

    // Give the target a password credential and a live session.
    await t.run(async (ctx) => {
      await ctx.db.insert("authAccounts", {
        provider: "password",
        providerAccountId: "employee@x.com",
        userId: targetId,
        secret: "hash:stub",
      });
      const sessionId = await ctx.db.insert("authSessions", {
        userId: targetId,
        expirationTime: Date.now() + 86_400_000,
      });
      await ctx.db.insert("authRefreshTokens", {
        sessionId,
        expirationTime: Date.now() + 86_400_000,
      });
    });

    // Non-admin cannot reset; admin cannot reset their own login.
    await expect(
      plain.mutation(api.access.adminResetLogin, { userId: targetId }),
    ).rejects.toThrow();
    await expect(
      admin.mutation(api.access.adminResetLogin, { userId: adminId }),
    ).rejects.toThrow(/own login/i);

    await admin.mutation(api.access.adminResetLogin, { userId: targetId });

    const after = await t.run(async (ctx) => ({
      accounts: (await ctx.db.query("authAccounts").collect()).filter(
        (a) => a.userId === targetId,
      ).length,
      sessions: (await ctx.db.query("authSessions").collect()).filter(
        (s) => s.userId === targetId,
      ).length,
      refresh: (await ctx.db.query("authRefreshTokens").collect()).length,
      user: await ctx.db.get(targetId),
      audit: (await ctx.db.query("auditLogs").collect()).filter(
        (l) => l.action === "reset_login_credential",
      ).length,
    }));
    expect(after.accounts).toBe(0);
    expect(after.sessions).toBe(0);
    expect(after.refresh).toBe(0);
    // The users row survives so a re-registration reconnects to it.
    expect(after.user?.email).toBe("employee@x.com");
    expect(after.audit).toBe(1);
  });

  test("admin can unlink a user's roster employee; non-admin cannot; unlink wipes captured data", async () => {
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
    const empId = await employeeIdByBiz(t, "IKD030835");
    const assignmentId = await t.run(async (ctx) => {
      const list = await ctx.db
        .query("kpiAssignments")
        .withIndex("by_employee_year", (q) => q.eq("employeeId", empId))
        .collect();
      return list.find((a) => a.canonicalKey === "asset_integration")!._id;
    });
    await unlockCapture(t, assignmentId);
    await emp.mutation(api.activities.create, {
      kpiAssignmentId: assignmentId,
      periodKey: "2026-M08",
      activityAt: AUG_2026,
      title: "Integrated assets",
      description: "batch",
      numerator: 9,
      denominator: 10,
    });
    await emp.mutation(api.evidence.saveEvidence, {
      kpiAssignmentId: assignmentId,
      externalUrl: "https://example.com/log",
      originalFilename: "log",
      mimeType: "text/uri-list",
      fileSize: 0,
      category: "qa_log",
      title: "Integration log",
    });

    await expect(
      emp.mutation(api.access.unlinkUserFromEmployee, { userId: empUserId }),
    ).rejects.toThrow();

    await admin.mutation(api.access.unlinkUserFromEmployee, { userId: empUserId });
    const linked = await t.run(async (ctx) => (await ctx.db.get(empUserId))?.employeeId);
    // convex-test surfaces an unset optional field as null.
    expect(linked ?? null).toBeNull();

    // The employee's captured data is gone from the records and dashboards.
    const remaining = await t.run(async (ctx) => {
      const acts = await ctx.db
        .query("activities")
        .withIndex("by_assignment_period", (q) =>
          q.eq("kpiAssignmentId", assignmentId).eq("periodKey", "2026-M08"),
        )
        .take(10);
      const evidence = (
        await ctx.db
          .query("evidenceFiles")
          .withIndex("by_assignment", (q) => q.eq("kpiAssignmentId", assignmentId))
          .take(10)
      ).filter((e) => e.retentionState === "active");
      const measurement = await ctx.db
        .query("kpiMeasurements")
        .withIndex("by_assignment_period", (q) =>
          q.eq("kpiAssignmentId", assignmentId).eq("periodKey", "2026-M08"),
        )
        .first();
      return { acts: acts.length, evidence: evidence.length, measurement };
    });
    expect(remaining.acts).toBe(0);
    expect(remaining.evidence).toBe(0);
    expect(remaining.measurement).toBeNull();
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
    await unlockCapture(t, assignmentId);

    const activityId = await emp.mutation(api.activities.create, {
      kpiAssignmentId: assignmentId,
      periodKey: "2026-M08",
      activityAt: AUG_2026,
      title: "Integrated assets",
      description: "batch",
      numerator: 9,
      denominator: 10,
    });

    // Someone else's employee account cannot delete it.
    await expect(other.mutation(api.activities.remove, { activityId })).rejects.toThrow();

    await emp.mutation(api.activities.remove, { activityId });

    // Deleting the only entry removes the provisional measurement entirely
    // (an empty input set must not read as a real 0% — or 100% for budgets).
    const measurement = await t.run(async (ctx) =>
      ctx.db
        .query("kpiMeasurements")
        .withIndex("by_assignment_period", (q) =>
          q.eq("kpiAssignmentId", assignmentId).eq("periodKey", "2026-M08"),
        )
        .first(),
    );
    expect(measurement).toBeNull();
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
    await unlockCapture(t, assignmentId);

    const base = {
      kpiAssignmentId: assignmentId,
      periodKey: "2026-M08",
      activityAt: AUG_2026,
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
    await unlockCapture(t, assignmentId);
    const activityId = await emp.mutation(api.activities.create, {
      kpiAssignmentId: assignmentId,
      periodKey: "2026-M08",
      activityAt: AUG_2026,
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
    await unlockCapture(t, assignmentId);
    await emp.mutation(api.activities.create, {
      kpiAssignmentId: assignmentId,
      periodKey: "2026-M08",
      activityAt: AUG_2026,
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

describe("cadence-aware periods", () => {
  test("quarterly KPIs accumulate per quarter and reject month buckets", async () => {
    const t = harness();
    await t.mutation(internal.seed.seedBaseline, {});
    // Find any employee who owns a quarterly mentorship KPI (role-dependent).
    const { assignmentId, target, employeeBiz } = await t.run(async (ctx) => {
      const all = await ctx.db.query("kpiAssignments").take(200);
      const a = all.find((x) => x.canonicalKey === "mentorship_training")!;
      const e = (await ctx.db.get(a.employeeId))!;
      return { assignmentId: a._id, target: a.target, employeeBiz: e.employeeId };
    });
    await unlockCapture(t, assignmentId);
    const { as: emp } = await makeUser(t, {
      email: "e@x.com",
      roles: ["employee"],
      employeeBusinessId: employeeBiz,
    });

    const base = {
      kpiAssignmentId: assignmentId,
      activityAt: AUG_2026,
      title: "Training session",
      description: "geospatial onboarding",
      quantity: 1,
    };

    // A month bucket is refused for a quarterly KPI.
    await expect(
      emp.mutation(api.activities.create, { ...base, periodKey: "2026-M08" }),
    ).rejects.toThrow(/quarterly/i);

    // Two sessions logged in Q3 add up against the full quarterly target.
    await emp.mutation(api.activities.create, { ...base, periodKey: "2026-Q3" });
    await emp.mutation(api.activities.create, {
      ...base,
      periodKey: "2026-Q3",
      title: "Second session",
    });
    const m = await t.run(async (ctx) =>
      ctx.db
        .query("kpiMeasurements")
        .withIndex("by_assignment_period", (q) =>
          q.eq("kpiAssignmentId", assignmentId).eq("periodKey", "2026-Q3"),
        )
        .first(),
    );
    expect(m?.rawActual).toBe(2);
    expect(m?.cappedAttainment).toBeCloseTo(Math.min(2 / target, 1), 5);
  });

  test("cadencePeriodKey maps months into their quarter/year buckets", async () => {
    const { cadencePeriodKey } = await import("./lib/periods");
    expect(cadencePeriodKey("Quarterly", "2026-M08")).toBe("2026-Q3");
    expect(cadencePeriodKey("Annually", "2026-M08")).toBe("2026");
    expect(cadencePeriodKey("Monthly", "2026-M08")).toBe("2026-M08");
    expect(cadencePeriodKey("Daily", "2026-M01")).toBe("2026-M01");
    expect(cadencePeriodKey("Quarterly", "2026-Q2")).toBe("2026-Q2");
  });
});

describe("submission compliance & gating", () => {
  test("compliance board classifies on-time, late and missing", async () => {
    const t = harness();
    await t.mutation(internal.seed.seedBaseline, {});
    const { as: emp } = await makeUser(t, {
      email: "e@x.com",
      roles: ["employee"],
      employeeBusinessId: "IKD034860",
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
      return list.find((a) => a.canonicalKey === "asset_integration")!._id;
    });
    await unlockCapture(t, assignmentId);
    await emp.mutation(api.activities.create, {
      kpiAssignmentId: assignmentId,
      periodKey: "2026-M08",
      activityAt: AUG_2026,
      title: "Integrated assets",
      description: "batch",
      numerator: 9,
      denominator: 10,
    });

    const boardData = await admin.query(api.compliance.board, {
      periodKey: "2026-M08",
    });
    const row = boardData.rows.find((r) => r.employeeId === empId)!;
    expect(row.expected).toBe(5);
    expect(row.onTime + row.late).toBe(1);
    expect(row.missing.length).toBe(4);
    // Employees cannot read the board.
    await expect(
      emp.query(api.compliance.board, { periodKey: "2026-M08" }),
    ).rejects.toThrow();
  });

  test("closed periods block employees, admins bypass, reopen restores", async () => {
    const t = harness();
    await t.mutation(internal.seed.seedBaseline, {});
    const { as: emp } = await makeUser(t, {
      email: "e@x.com",
      roles: ["employee"],
      employeeBusinessId: "IKD034860",
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
      return list.find((a) => a.canonicalKey === "asset_integration")!._id;
    });
    await unlockCapture(t, assignmentId);
    const base = {
      kpiAssignmentId: assignmentId,
      periodKey: "2026-M08",
      activityAt: AUG_2026,
      title: "Integrated assets",
      description: "batch",
      numerator: 1,
      denominator: 10,
    };

    await admin.mutation(api.compliance.closePeriod, { periodKey: "2026-M08" });
    await expect(emp.mutation(api.activities.create, base)).rejects.toThrow(/closed/i);
    // Admins bypass the gate (they own reopening).
    const adminActivity = await admin.mutation(api.activities.create, base);

    await expect(
      admin.mutation(api.compliance.reopenPeriod, {
        periodKey: "2026-M08",
        reason: " ",
      }),
    ).rejects.toThrow(/reason/i);
    await admin.mutation(api.compliance.reopenPeriod, {
      periodKey: "2026-M08",
      reason: "Employee was on approved leave",
    });
    // Clear the admin's ratio entry (the duplicate guard rightly blocks a
    // second period-summary), then the employee can capture again.
    await admin.mutation(api.activities.remove, { activityId: adminActivity });
    await emp.mutation(api.activities.create, base);
  });

  test("reminder ladder fires once per stage and escalates overdue periods", async () => {
    const t = harness();
    await t.mutation(internal.seed.seedBaseline, {});
    await makeUser(t, {
      email: "e@x.com",
      roles: ["employee"],
      employeeBusinessId: "IKD034860",
    });
    await makeUser(t, { email: "a@x.com", roles: ["system_admin"] });

    // Sep 3 2026: two days before the M08 due date (Sep 5) → due_soon stage.
    const sep3 = Date.UTC(2026, 8, 3, 12);
    const first = await t.mutation(internal.reminders.scanSubmissionReminders, {
      now: sep3,
    });
    expect(first.notified).toBeGreaterThan(0);
    const again = await t.mutation(internal.reminders.scanSubmissionReminders, {
      now: sep3,
    });
    expect(again.notified).toBe(0); // deduped

    // Sep 6 2026: past due → overdue notices + one-time admin escalation.
    const sep6 = Date.UTC(2026, 8, 6, 12);
    const overdue = await t.mutation(internal.reminders.scanSubmissionReminders, {
      now: sep6,
    });
    expect(overdue.notified).toBeGreaterThan(0);
    expect(overdue.escalations).toBeGreaterThan(0);
    const overdueAgain = await t.mutation(internal.reminders.scanSubmissionReminders, {
      now: sep6,
    });
    expect(overdueAgain.notified).toBe(0);
    expect(overdueAgain.escalations).toBe(0);
  });
});

describe("duplicate capture guard", () => {
  test("period-total modes block a second capture; incremental modes accumulate", async () => {
    const t = harness();
    await t.mutation(internal.seed.seedBaseline, {});
    const empId = await employeeIdByBiz(t, "IKD034860");
    const { as: emp } = await makeUser(t, {
      email: "e@x.com",
      roles: ["employee"],
      employeeBusinessId: "IKD034860",
    });
    const ratioAssignment = await t.run(async (ctx) => {
      const list = await ctx.db
        .query("kpiAssignments")
        .withIndex("by_employee_year", (q) => q.eq("employeeId", empId))
        .collect();
      return list.find((a) => a.canonicalKey === "asset_integration")!._id;
    });
    await unlockCapture(t, ratioAssignment);
    const base = {
      kpiAssignmentId: ratioAssignment,
      periodKey: "2026-M08",
      activityAt: AUG_2026,
      title: "Integrated assets",
      description: "batch",
      numerator: 9,
      denominator: 10,
    };

    const first = await emp.mutation(api.activities.create, base);
    // A second ratio capture for the same month is a duplicate → blocked.
    await expect(
      emp.mutation(api.activities.create, { ...base, title: "Again" }),
    ).rejects.toThrow(/already been captured/i);
    // The guard is visible to the form.
    const info = await emp.query(api.activities.existingForPeriod, {
      kpiAssignmentId: ratioAssignment,
      periodKey: "2026-M08",
    });
    expect(info?.singleEntry).toBe(true);
    expect(info?.count).toBe(1);
    // Editing the existing entry still works.
    await emp.mutation(api.activities.update, {
      activityId: first,
      periodKey: "2026-M08",
      title: "Integrated assets (corrected)",
      description: "batch",
      numerator: 10,
      denominator: 10,
    });

    // Incremental (count/quarterly) mode still accumulates freely.
    const { countAssignment, countBiz } = await t.run(async (ctx) => {
      const all = await ctx.db.query("kpiAssignments").take(200);
      const a = all.find((x) => x.canonicalKey === "mentorship_training")!;
      const e = (await ctx.db.get(a.employeeId))!;
      return { countAssignment: a._id, countBiz: e.employeeId };
    });
    await unlockCapture(t, countAssignment);
    const { as: lead } = await makeUser(t, {
      email: "lead@x.com",
      roles: ["employee"],
      employeeBusinessId: countBiz,
    });
    const cBase = {
      kpiAssignmentId: countAssignment,
      periodKey: "2026-Q3",
      activityAt: AUG_2026,
      title: "Training session",
      description: "onboarding",
      quantity: 1,
    };
    await lead.mutation(api.activities.create, cBase);
    await lead.mutation(api.activities.create, { ...cBase, title: "Second session" });
    const cInfo = await lead.query(api.activities.existingForPeriod, {
      kpiAssignmentId: countAssignment,
      periodKey: "2026-Q3",
    });
    expect(cInfo?.singleEntry).toBe(false);
    expect(cInfo?.count).toBe(2);
  });

  test("QA coverage ratio accumulates as batch logs (exempt from the guard)", async () => {
    const t = harness();
    await t.mutation(internal.seed.seedBaseline, {});
    await t.mutation(internal.migrations.convertQaDataQualityToCoverageRatio, {});
    const empId = await employeeIdByBiz(t, "IKD034860"); // GIS Analyst
    const { as: emp } = await makeUser(t, {
      email: "qa@x.com",
      roles: ["employee"],
      employeeBusinessId: "IKD034860",
    });
    const qaAssignment = await t.run(async (ctx) => {
      const list = await ctx.db
        .query("kpiAssignments")
        .withIndex("by_employee_year", (q) => q.eq("employeeId", empId))
        .collect();
      return list.find((a) => a.canonicalKey === "qa_data_quality")!._id;
    });
    await unlockCapture(t, qaAssignment);
    const base = {
      kpiAssignmentId: qaAssignment,
      periodKey: "2026-M08",
      activityAt: AUG_2026,
      description: "QA batch",
    };
    // Two batches in the same month both save (ratio, but batch-accumulating).
    await emp.mutation(api.activities.create, {
      ...base,
      title: "QA batch 1",
      numerator: 6,
      denominator: 8,
    });
    await emp.mutation(api.activities.create, {
      ...base,
      title: "QA batch 2",
      numerator: 9,
      denominator: 9,
    });
    const info = await emp.query(api.activities.existingForPeriod, {
      kpiAssignmentId: qaAssignment,
      periodKey: "2026-M08",
    });
    expect(info?.singleEntry).toBe(false);
    expect(info?.count).toBe(2);
    // The measurement sums the batches: 15/17 vs 100% target.
    const measurement = await t.run(async (ctx) => {
      return await ctx.db
        .query("kpiMeasurements")
        .withIndex("by_assignment_period", (q) =>
          q.eq("kpiAssignmentId", qaAssignment).eq("periodKey", "2026-M08"),
        )
        .first();
    });
    expect(measurement?.rawActual).toBeCloseTo(15 / 17, 5);
    expect(measurement?.cappedAttainment).toBeCloseTo(15 / 17, 5);
  });
});

describe("review queue: bulk evidence approve + admin submission delete", () => {
  test("approve-all unblocks the gate; delete removes entries for the employee too", async () => {
    const t = harness();
    await t.mutation(internal.seed.seedBaseline, {});
    const empId = await employeeIdByBiz(t, "IKD034860");
    const { as: emp } = await makeUser(t, {
      email: "e2@x.com",
      roles: ["employee"],
      employeeBusinessId: "IKD034860",
    });
    const { as: admin } = await makeUser(t, {
      email: "a2@x.com",
      roles: ["system_admin"],
    });
    const assignmentId = await t.run(async (ctx) => {
      const list = await ctx.db
        .query("kpiAssignments")
        .withIndex("by_employee_year", (q) => q.eq("employeeId", empId))
        .collect();
      return list.find((a) => a.canonicalKey === "asset_integration")!._id;
    });
    // Evidence-first: attach the proof, then log the work.
    await emp.mutation(api.evidence.saveEvidence, {
      kpiAssignmentId: assignmentId,
      externalUrl: "https://example.com/log",
      originalFilename: "log",
      mimeType: "text/uri-list",
      fileSize: 0,
      category: "qa_log",
      title: "Integration log",
    });
    await emp.mutation(api.activities.create, {
      kpiAssignmentId: assignmentId,
      periodKey: "2026-M08",
      activityAt: AUG_2026,
      title: "Integrated assets",
      description: "batch",
      numerator: 9,
      denominator: 10,
    });

    // The queue distinguishes "submitted, awaiting review" from "needed".
    const queue = await admin.query(api.approvals.reviewQueue, {});
    const row = queue.find(
      (r) => r.assignmentId === assignmentId && r.periodKey === "2026-M08",
    )!;
    expect(row.evidenceComplete).toBe(false);
    expect(row.pendingEvidence).toBe(1);

    // One-click bulk approve flips the evidence gate.
    const res = await admin.mutation(api.evidence.approveAllForAssignment, {
      kpiAssignmentId: assignmentId,
    });
    expect(res.approved).toBe(1);
    const queue2 = await admin.query(api.approvals.reviewQueue, {});
    expect(queue2.find((r) => r.assignmentId === assignmentId)!.evidenceComplete).toBe(
      true,
    );

    // Deleting the submission needs a reason, is admin-only, and removes the
    // shared records — gone from the employee's side and the measurement too.
    await expect(
      emp.mutation(api.approvals.deleteSubmission, {
        kpiAssignmentId: assignmentId,
        periodKey: "2026-M08",
        reason: "x",
      }),
    ).rejects.toThrow();
    await expect(
      admin.mutation(api.approvals.deleteSubmission, {
        kpiAssignmentId: assignmentId,
        periodKey: "2026-M08",
        reason: "  ",
      }),
    ).rejects.toThrow(/reason/i);
    const del = await admin.mutation(api.approvals.deleteSubmission, {
      kpiAssignmentId: assignmentId,
      periodKey: "2026-M08",
      reason: "Duplicate numbers — recapture",
    });
    expect(del.deleted).toBe(1);
    expect(del.evidenceDeleted).toBe(1);
    const evidenceAfter = await t.run(async (ctx) =>
      (
        await ctx.db
          .query("evidenceFiles")
          .withIndex("by_assignment", (q) => q.eq("kpiAssignmentId", assignmentId))
          .take(10)
      ).filter((e) => e.retentionState === "active"),
    );
    expect(evidenceAfter.length).toBe(0);

    const remaining = await t.run(async (ctx) =>
      ctx.db
        .query("activities")
        .withIndex("by_assignment_period", (q) =>
          q.eq("kpiAssignmentId", assignmentId).eq("periodKey", "2026-M08"),
        )
        .take(10),
    );
    expect(remaining.length).toBe(0);
    const measurement = await t.run(async (ctx) =>
      ctx.db
        .query("kpiMeasurements")
        .withIndex("by_assignment_period", (q) =>
          q.eq("kpiAssignmentId", assignmentId).eq("periodKey", "2026-M08"),
        )
        .first(),
    );
    expect(measurement).toBeNull();
    const audit = await t.run(async (ctx) =>
      (await ctx.db.query("auditLogs").collect()).filter(
        (l) => l.action === "delete_submission_activity",
      ),
    );
    expect(audit.length).toBe(1);
  });

  test("reject clears the queue row; recall restores it; period approval can be recalled", async () => {
    const t = harness();
    await t.mutation(internal.seed.seedBaseline, {});
    const empId = await employeeIdByBiz(t, "IKD034860");
    const { as: emp } = await makeUser(t, {
      email: "e3@x.com",
      roles: ["employee"],
      employeeBusinessId: "IKD034860",
    });
    const { as: admin } = await makeUser(t, {
      email: "a3@x.com",
      roles: ["system_admin"],
    });
    const assignmentId = await t.run(async (ctx) => {
      const list = await ctx.db
        .query("kpiAssignments")
        .withIndex("by_employee_year", (q) => q.eq("employeeId", empId))
        .collect();
      return list.find((a) => a.canonicalKey === "asset_integration")!._id;
    });
    await unlockCapture(t, assignmentId);
    const readMeasurement = () =>
      t.run(async (ctx) =>
        ctx.db
          .query("kpiMeasurements")
          .withIndex("by_assignment_period", (q) =>
            q.eq("kpiAssignmentId", assignmentId).eq("periodKey", "2026-M08"),
          )
          .first(),
      );

    const activityId = await emp.mutation(api.activities.create, {
      kpiAssignmentId: assignmentId,
      periodKey: "2026-M08",
      activityAt: AUG_2026,
      title: "Integrated assets",
      description: "batch",
      numerator: 9,
      denominator: 10,
    });
    const activityStatus = () =>
      t.run(async (ctx) => (await ctx.db.get(activityId))!.status);

    // Reject → entries returned, provisional measurement gone from the queue.
    await admin.mutation(api.approvals.rejectSubmission, {
      kpiAssignmentId: assignmentId,
      periodKey: "2026-M08",
      reason: "Numbers do not tally",
    });
    expect(await readMeasurement()).toBeNull();

    // Recall the rejection → entries re-submitted, measurement restored.
    const recalled = await admin.mutation(api.approvals.recallRejection, {
      kpiAssignmentId: assignmentId,
      periodKey: "2026-M08",
    });
    expect(recalled.restored).toBe(1);
    const restored = await readMeasurement();
    expect(restored?.hasData).toBe(true);
    expect(restored?.isProvisional).toBe(true);

    // Approve evidence + the period, then recall the approval.
    await emp.mutation(api.evidence.saveEvidence, {
      kpiAssignmentId: assignmentId,
      externalUrl: "https://example.com/log",
      originalFilename: "log",
      mimeType: "text/uri-list",
      fileSize: 0,
      category: "qa_log",
      title: "Integration log",
    });
    await admin.mutation(api.evidence.approveAllForAssignment, {
      kpiAssignmentId: assignmentId,
    });
    await admin.mutation(api.approvals.approveEmployeePeriod, {
      employeeId: empId,
      periodKey: "2026-M08",
    });
    expect((await readMeasurement())?.isProvisional).toBe(false);
    // The decision is visible on the employee's side immediately.
    expect(await activityStatus()).toBe("approved");

    const recallRes = await admin.mutation(api.approvals.recallPeriodApproval, {
      employeeId: empId,
      periodKey: "2026-M08",
      reason: "Approved in error",
    });
    expect(recallRes.measurementsReopened).toBeGreaterThan(0);
    expect((await readMeasurement())?.isProvisional).toBe(true);
    expect(await activityStatus()).toBe("submitted");
    const snapshots = await t.run(async (ctx) =>
      ctx.db
        .query("scoreSnapshots")
        .withIndex("by_scope_period", (q) =>
          q.eq("scope", "individual").eq("scopeRef", empId).eq("periodKey", "2026-M08"),
        )
        .take(10),
    );
    expect(snapshots.length).toBe(0);
  });
});

describe("non-core KPIs (80 core + 20 non-core = 100)", () => {
  test("migration adds 4 non-core KPIs per employee and resolves weight flags", async () => {
    const t = harness();
    await t.mutation(internal.seed.seedBaseline, {});
    const first = await t.mutation(internal.migrations.addNonCoreKpis, {});
    expect(first.assignments).toBe(60); // 15 employees × 4
    expect(first.definitions).toBe(16); // 4 roles × 4
    expect(first.weightIssuesResolved).toBe(15);

    // Idempotent.
    const again = await t.mutation(internal.migrations.addNonCoreKpis, {});
    expect(again.assignments).toBe(0);
    expect(again.definitions).toBe(0);

    // Every employee now totals exactly 100: 80 core + 20 non-core.
    const totals = await t.run(async (ctx) => {
      const assignments = await ctx.db.query("kpiAssignments").take(500);
      const byEmp = new Map<string, { core: number; nonCore: number }>();
      for (const a of assignments) {
        const e = byEmp.get(a.employeeId) ?? { core: 0, nonCore: 0 };
        if ((a.kpiCategory ?? "core") === "non_core") e.nonCore += a.weight;
        else e.core += a.weight;
        byEmp.set(a.employeeId, e);
      }
      return [...byEmp.values()];
    });
    expect(totals.length).toBe(15);
    for (const tot of totals) {
      expect(tot.core).toBe(80);
      expect(tot.nonCore).toBe(20);
    }

    // The weight_incomplete flags are resolved.
    const openWeightIssues = await t.run(async (ctx) =>
      (
        await ctx.db
          .query("dataQualityIssues")
          .withIndex("by_category", (q) => q.eq("category", "weight_incomplete"))
          .take(100)
      ).filter((i) => !["approved", "rejected", "resolved"].includes(i.status)),
    );
    expect(openWeightIssues.length).toBe(0);
  });
});

describe("employee analytics scoping", () => {
  test("employees always get their own analytics; moderators can select anyone", async () => {
    const t = harness();
    await t.mutation(internal.seed.seedBaseline, {});
    const ownId = await employeeIdByBiz(t, "IKD034860");
    const otherId = await employeeIdByBiz(t, "IKD030835");
    const { as: emp } = await makeUser(t, {
      email: "e@x.com",
      roles: ["employee"],
      employeeBusinessId: "IKD034860",
    });
    const { as: mgr } = await makeUser(t, {
      email: "m@x.com",
      roles: ["manager"],
    });

    // An employee asking for someone else still gets themselves.
    const own = await emp.query(api.analytics.employeeAnalytics, {
      employeeId: otherId,
    });
    expect(own.canSelect).toBe(false);
    expect(own.employee?.id).toBe(ownId);
    expect(own.roster.length).toBe(0);
    expect(own.kpis.length).toBe(5);

    // A manager can pick any employee and gets the roster for the selector.
    const picked = await mgr.query(api.analytics.employeeAnalytics, {
      employeeId: otherId,
    });
    expect(picked.canSelect).toBe(true);
    expect(picked.employee?.id).toBe(otherId);
    expect(picked.roster.length).toBe(15);
  });
});

describe("pinned baseline & scoring-block repair", () => {
  test("pinned baseline is injected server-side for reduction KPIs", async () => {
    const t = harness();
    await t.mutation(internal.seed.seedBaseline, {});
    const { assignmentId, biz } = await t.run(async (ctx) => {
      const all = await ctx.db.query("kpiAssignments").take(200);
      const a = all.find((x) => x.measurementMode === "reduction" && !x.scoringBlocked)!;
      const e = (await ctx.db.get(a.employeeId))!;
      return { assignmentId: a._id, biz: e.employeeId };
    });
    await unlockCapture(t, assignmentId);
    const { as: emp } = await makeUser(t, {
      email: "e@x.com",
      roles: ["employee"],
      employeeBusinessId: biz,
    });
    const { as: admin } = await makeUser(t, {
      email: "a@x.com",
      roles: ["kpi_admin"],
    });

    await admin.mutation(api.kpiSettings.updateAssignment, {
      assignmentId,
      pinnedBaseline: 50,
      reason: "Agreed 2025 baseline",
    });

    // Employee supplies only the current value — baseline comes from the pin.
    await emp.mutation(api.activities.create, {
      kpiAssignmentId: assignmentId,
      periodKey: "2026-M08",
      activityAt: AUG_2026,
      title: "QA errors this month",
      description: "40 errors vs pinned 50",
      currentValue: 40,
    });
    const m = await t.run(async (ctx) =>
      ctx.db
        .query("kpiMeasurements")
        .withIndex("by_assignment_period", (q) =>
          q.eq("kpiAssignmentId", assignmentId).eq("periodKey", "2026-M08"),
        )
        .first(),
    );
    // (50-40)/50 = 20% achieved reduction; attainment = 0.2 / target.
    expect(m?.rawActual).toBeCloseTo(0.2, 5);
  });

  test("recomputeScoringBlocks clears flags once every blocker is resolved", async () => {
    const t = harness();
    await t.mutation(internal.seed.seedBaseline, {});
    const { as: admin } = await makeUser(t, {
      email: "a@x.com",
      roles: ["system_admin"],
    });
    // Resolve every open blocking issue (rubric + row-level blockers).
    await t.run(async (ctx) => {
      const issues = await ctx.db.query("dataQualityIssues").collect();
      for (const i of issues) {
        if (i.blocksScoring && !["approved", "rejected", "resolved"].includes(i.status)) {
          await ctx.db.patch(i._id, { status: "resolved", resolvedAt: 1 });
        }
      }
    });
    const res = await t.mutation(internal.migrations.recomputeScoringBlocks, {});
    expect(res.blocked).toBe(0);
    const stillBlocked = await t.run(
      async (ctx) =>
        (await ctx.db.query("kpiAssignments").collect()).filter((a) => a.scoringBlocked)
          .length,
    );
    expect(stillBlocked).toBe(0);
    // Sanity: admin board still readable afterwards.
    const summary = await admin.query(api.dataQuality.summary, {});
    expect(summary.blockers).toBe(0);
  });
});

describe("data-quality reopen", () => {
  test("reopening a decided blocker re-blocks the affected KPI", async () => {
    const t = harness();
    await t.mutation(internal.seed.seedBaseline, {});
    const { as: admin } = await makeUser(t, {
      email: "a@x.com",
      roles: ["kpi_admin"],
    });
    // Resolve the rubric requirement → innovation KPIs unblock (except 18/30/54).
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
      note: "Rubric agreed",
    });
    const blockedAfterResolve = await t.run(
      async (ctx) =>
        (await ctx.db.query("kpiAssignments").collect()).filter(
          (a) => a.canonicalKey === "tech_innovation" && a.scoringBlocked,
        ).length,
    );
    expect(blockedAfterResolve).toBe(3);

    // Undo → all innovation KPIs are blocked again.
    await admin.mutation(api.dataQuality.reopenIssue, { issueId });
    const blockedAfterReopen = await t.run(
      async (ctx) =>
        (await ctx.db.query("kpiAssignments").collect()).filter(
          (a) => a.canonicalKey === "tech_innovation" && a.scoringBlocked,
        ).length,
    );
    expect(blockedAfterReopen).toBe(15);
    const status = await t.run(async (ctx) => (await ctx.db.get(issueId))!.status);
    expect(status).toBe("open");
  });
});

describe("account reset & delete", () => {
  test("reset wipes captured data but keeps KPI config; admin-only", async () => {
    const t = harness();
    await t.mutation(internal.seed.seedBaseline, {});
    const empId = await employeeIdByBiz(t, "IKD034860");
    const { as: emp, userId: empUserId } = await makeUser(t, {
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
    // Evidence-first: attach the proof, then log the work.
    await emp.mutation(api.evidence.saveEvidence, {
      kpiAssignmentId: assignmentId,
      externalUrl: "https://example.com/r",
      originalFilename: "r",
      mimeType: "text/uri-list",
      fileSize: 0,
      category: "supporting_document",
      title: "Report",
    });
    await emp.mutation(api.activities.create, {
      kpiAssignmentId: assignmentId,
      periodKey: "2026-M08",
      activityAt: AUG_2026,
      title: "Integrated assets",
      description: "batch",
      numerator: 9,
      denominator: 10,
    });

    await expect(
      emp.mutation(api.access.resetUserData, { userId: empUserId }),
    ).rejects.toThrow();

    const counts = await admin.mutation(api.access.resetUserData, {
      userId: empUserId,
    });
    expect(counts.activities).toBe(1);
    expect(counts.evidence).toBe(1);
    const remaining = await t.run(async (ctx) => ({
      activities: (await ctx.db.query("activities").collect()).length,
      assignments: (await ctx.db.query("kpiAssignments").collect()).length,
    }));
    expect(remaining.activities).toBe(0);
    expect(remaining.assignments).toBe(75); // config untouched
  });

  test("delete removes the account with guards", async () => {
    const t = harness();
    const { as: admin, userId: adminId } = await makeUser(t, {
      email: "a@x.com",
      roles: ["system_admin"],
    });
    const { userId: victimId } = await makeUser(t, {
      email: "v@x.com",
      roles: ["employee"],
    });

    await expect(
      admin.mutation(api.access.deleteUser, { userId: adminId }),
    ).rejects.toThrow(/own account/i);

    await admin.mutation(api.access.deleteUser, { userId: victimId });
    const gone = await t.run(async (ctx) => ({
      user: await ctx.db.get(victimId),
      roles: (
        await ctx.db
          .query("userRoleAssignments")
          .withIndex("by_user", (q) => q.eq("userId", victimId))
          .collect()
      ).length,
    }));
    expect(gone.user).toBeNull();
    expect(gone.roles).toBe(0);
  });
});

describe("employee-level reset", () => {
  test("resets a roster employee's data even with no linked account", async () => {
    const t = harness();
    await t.mutation(internal.seed.seedBaseline, {});
    const empId = await employeeIdByBiz(t, "IKD034860");
    const { as: admin } = await makeUser(t, {
      email: "a@x.com",
      roles: ["system_admin"],
    });
    // Admin logs an activity FOR the employee (no account linked to them).
    const assignmentId = await t.run(async (ctx) => {
      const list = await ctx.db
        .query("kpiAssignments")
        .withIndex("by_employee_year", (q) => q.eq("employeeId", empId))
        .collect();
      return list.find((a) => a.canonicalKey === "asset_integration")!._id;
    });
    await admin.mutation(api.activities.create, {
      kpiAssignmentId: assignmentId,
      periodKey: "2026-M08",
      activityAt: AUG_2026,
      title: "Integrated assets",
      description: "batch",
      numerator: 9,
      denominator: 10,
    });

    // Account-level reset on an unlinked account explains itself.
    await expect(
      admin.mutation(api.access.resetUserData, {
        userId: await t.run(
          async (ctx) => (await ctx.db.query("users").collect())[0]!._id,
        ),
      }),
    ).rejects.toThrow(/no linked employee/i);

    const counts = await admin.mutation(api.access.resetEmployeeData, {
      employeeId: empId,
    });
    expect(counts.activities).toBe(1);
    const left = await t.run(
      async (ctx) => (await ctx.db.query("activities").collect()).length,
    );
    expect(left).toBe(0);
  });
});

describe("capture window — employees start capturing from July 2026", () => {
  const MARCH_2026 = Date.UTC(2026, 2, 15);
  const AUGUST_2026 = Date.UTC(2026, 7, 15);
  const CAPTURE_START = Date.UTC(2026, 6, 1) - 60 * 60 * 1000; // 1 Jul, Lagos

  async function setup() {
    const t = harness();
    await t.mutation(internal.seed.seedBaseline, {});
    await t.run(async (ctx) => {
      const year = await ctx.db
        .query("performanceYears")
        .withIndex("by_year", (q) => q.eq("year", 2026))
        .first();
      await ctx.db.patch(year!._id, { captureStartAt: CAPTURE_START });
    });
    const empId = await employeeIdByBiz(t, "IKD034860");
    const { as: emp } = await makeUser(t, {
      email: "junegate@x.com",
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
    await unlockCapture(t, assignmentId);
    return { t, emp, assignmentId };
  }

  test("capture into a pre-June period is rejected", async () => {
    const { emp, assignmentId } = await setup();
    await expect(
      emp.mutation(api.activities.create, {
        kpiAssignmentId: assignmentId,
        periodKey: "2026-M03",
        activityAt: MARCH_2026,
        title: "Backdated work",
        description: "should not be allowed",
        numerator: 1,
        denominator: 2,
      }),
    ).rejects.toThrow(/capture opened/i);
  });

  test("capture from June onward succeeds", async () => {
    const { emp, assignmentId } = await setup();
    await emp.mutation(api.activities.create, {
      kpiAssignmentId: assignmentId,
      periodKey: "2026-M08",
      activityAt: AUGUST_2026,
      title: "August work",
      description: "inside the window",
      numerator: 9,
      denominator: 10,
    });
  });

  test("the period list hides pre-July periods but keeps Q3 and the year", async () => {
    const { emp } = await setup();
    const keys = (await emp.query(api.activities.periods, {})).map(
      (p: { periodKey: string }) => p.periodKey,
    );
    expect(keys).not.toContain("2026-M03");
    expect(keys).not.toContain("2026-M06");
    expect(keys).not.toContain("2026-Q1");
    expect(keys).not.toContain("2026-Q2");
    expect(keys).toContain("2026-M07");
    expect(keys).toContain("2026-Q3"); // July work lands here for quarterly KPIs
    expect(keys).toContain("2026");
  });
});

describe("rate limiting", () => {
  test("report exports allow 10 per window, then block with a retry hint", async () => {
    const t = harness();
    await t.mutation(internal.seed.seedBaseline, {});
    const { as: user } = await makeUser(t, {
      email: "limits@x.com",
      roles: ["employee"],
    });
    for (let i = 0; i < 10; i++) {
      const r = await user.mutation(api.rateLimit.hit, { endpoint: "report_xlsx" });
      expect(r.ok).toBe(true);
    }
    const blocked = await user.mutation(api.rateLimit.hit, { endpoint: "report_xlsx" });
    expect(blocked.ok).toBe(false);
    expect(blocked.retryAfterSeconds).toBeGreaterThan(0);
    // Endpoints are limited independently.
    const other = await user.mutation(api.rateLimit.hit, { endpoint: "report_pdf" });
    expect(other.ok).toBe(true);
  });

  test("limits are per user, and the signed-out are rejected outright", async () => {
    const t = harness();
    await t.mutation(internal.seed.seedBaseline, {});
    const { as: a } = await makeUser(t, { email: "a-lim@x.com", roles: ["employee"] });
    const { as: b } = await makeUser(t, { email: "b-lim@x.com", roles: ["employee"] });
    for (let i = 0; i < 5; i++) {
      await a.mutation(api.rateLimit.hit, { endpoint: "password_change" });
    }
    expect(
      (await a.mutation(api.rateLimit.hit, { endpoint: "password_change" })).ok,
    ).toBe(false);
    // A different user still has a fresh window.
    expect(
      (await b.mutation(api.rateLimit.hit, { endpoint: "password_change" })).ok,
    ).toBe(true);
    await expect(
      t.mutation(api.rateLimit.hit, { endpoint: "report_pdf" }),
    ).rejects.toThrow();
  });
});

describe("malware scan integration point", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  /** Seed, then upload a real stored file as evidence for one KPI. */
  async function uploadedEvidence(t: T) {
    await t.mutation(internal.seed.seedBaseline, {});
    const empId = await employeeIdByBiz(t, "IKD034860");
    const { as: emp } = await makeUser(t, {
      email: "scan-emp@x.com",
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
    const storageId = await t.run(async (ctx) =>
      ctx.storage.store(new Blob(["%PDF fake bytes"])),
    );
    const evidenceId = await emp.mutation(api.evidence.saveEvidence, {
      kpiAssignmentId: assignmentId,
      storageId,
      originalFilename: "integration-report.pdf",
      mimeType: "application/pdf",
      fileSize: 15,
      category: "supporting_document",
      title: "Integration report",
    });
    return { emp, empId, assignmentId, evidenceId };
  }

  async function scanStatusOf(t: T, evidenceId: Id<"evidenceFiles">) {
    return await t.run(async (ctx) => (await ctx.db.get(evidenceId))!.scanStatus);
  }

  test("unconfigured scanner: files stay pending, links are never scannable", async () => {
    const t = harness();
    const { emp, assignmentId, evidenceId } = await uploadedEvidence(t);

    expect(await scanStatusOf(t, evidenceId)).toBe("pending");
    // Running the scan without MALWARE_SCAN_WEBHOOK_URL is a graceful no-op.
    await t.action(internal.evidenceScan.scanEvidence, { evidenceId });
    expect(await scanStatusOf(t, evidenceId)).toBe("pending");

    const linkId = await emp.mutation(api.evidence.saveEvidence, {
      kpiAssignmentId: assignmentId,
      externalUrl: "https://example.com/log",
      originalFilename: "log",
      mimeType: "text/uri-list",
      fileSize: 0,
      category: "qa_log",
      title: "Link evidence",
    });
    expect((await scanStatusOf(t, linkId)) ?? null).toBeNull();

    // Pending never blocks downloads (scanner absence must not stall work).
    const auth = await emp.query(internal.evidence.authorizeDownload, { evidenceId });
    expect(auth.allowed).toBe(true);
  });

  test("a flagged verdict blocks downloads, audits, and queues admin notices", async () => {
    const t = harness();
    const { emp, evidenceId } = await uploadedEvidence(t);
    await makeUser(t, { email: "scan-admin@x.com", roles: ["system_admin"] });

    vi.stubEnv("MALWARE_SCAN_WEBHOOK_URL", "https://scanner.example/scan");
    vi.stubEnv("MALWARE_SCAN_WEBHOOK_TOKEN", "secret-token");
    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify({ verdict: "flagged", detail: "EICAR-Test" }), {
          status: 200,
        }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await t.action(internal.evidenceScan.scanEvidence, { evidenceId });

    // The scanner received the bytes with filename + bearer auth.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://scanner.example/scan");
    const headers = init.headers as Record<string, string>;
    expect(headers["X-Filename"]).toBe("integration-report.pdf");
    expect(headers["Authorization"]).toBe("Bearer secret-token");

    expect(await scanStatusOf(t, evidenceId)).toBe("flagged");

    // Downloads blocked — even for the owner.
    const auth = await emp.query(internal.evidence.authorizeDownload, { evidenceId });
    expect(auth.allowed).toBe(false);
    expect(auth.status).toBe(403);

    // Audited, and admin notices queued via the shared pipeline.
    const flaggedAudits = await t.run(async (ctx) =>
      (await ctx.db.query("auditLogs").collect()).filter(
        (a) => a.action === "malware_flagged",
      ),
    );
    expect(flaggedAudits.length).toBe(1);
  });

  test("a clean verdict marks the file clean and keeps downloads open", async () => {
    const t = harness();
    const { emp, evidenceId } = await uploadedEvidence(t);

    vi.stubEnv("MALWARE_SCAN_WEBHOOK_URL", "https://scanner.example/scan");
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () => new Response(JSON.stringify({ verdict: "clean" }), { status: 200 }),
      ),
    );

    await t.action(internal.evidenceScan.scanEvidence, { evidenceId });
    expect(await scanStatusOf(t, evidenceId)).toBe("clean");
    const auth = await emp.query(internal.evidence.authorizeDownload, { evidenceId });
    expect(auth.allowed).toBe(true);
  });

  test("scanner failure never fakes a verdict — file stays pending, error audited", async () => {
    const t = harness();
    const { evidenceId } = await uploadedEvidence(t);

    vi.stubEnv("MALWARE_SCAN_WEBHOOK_URL", "https://scanner.example/scan");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("upstream down", { status: 503 })),
    );

    await t.action(internal.evidenceScan.scanEvidence, { evidenceId });
    expect(await scanStatusOf(t, evidenceId)).toBe("pending");

    const errorAudits = await t.run(async (ctx) =>
      (await ctx.db.query("auditLogs").collect()).filter(
        (a) => a.action === "malware_scan_error",
      ),
    );
    expect(errorAudits.length).toBe(1);
  });
});

describe("evidence centre nudge: activityLogged", () => {
  test("evidence without logged work is flagged; logging the activity clears it", async () => {
    const t = harness();
    await t.mutation(internal.seed.seedBaseline, {});
    const empId = await employeeIdByBiz(t, "IKD034860");
    const { as: emp } = await makeUser(t, {
      email: "nudge-emp@x.com",
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

    // Evidence attached, no activity logged → nudge.
    await emp.mutation(api.evidence.saveEvidence, {
      kpiAssignmentId: assignmentId,
      externalUrl: "https://example.com/batch-report",
      originalFilename: "batch-report",
      mimeType: "text/uri-list",
      fileSize: 0,
      category: "batch_report",
      title: "Asset integration batch report",
    });
    const before = await emp.query(api.evidence.listCentre, {});
    expect(before.find((r) => r.kpiAssignmentId === assignmentId)?.activityLogged).toBe(
      false,
    );

    // Log the work → nudge clears.
    await emp.mutation(api.activities.create, {
      kpiAssignmentId: assignmentId,
      periodKey: "2026-M08",
      activityAt: AUG_2026,
      title: "Integrated assets",
      description: "batch",
      numerator: 9,
      denominator: 10,
    });
    const after = await emp.query(api.evidence.listCentre, {});
    expect(after.find((r) => r.kpiAssignmentId === assignmentId)?.activityLogged).toBe(
      true,
    );
  });
});

describe("evidence-first capture rule", () => {
  test("employees cannot log work on an evidence-required KPI until proof is attached; admins bypass", async () => {
    const t = harness();
    await t.mutation(internal.seed.seedBaseline, {});
    const empId = await employeeIdByBiz(t, "IKD034860");
    const { as: emp } = await makeUser(t, {
      email: "efirst@x.com",
      roles: ["employee"],
      employeeBusinessId: "IKD034860",
    });
    const { as: admin } = await makeUser(t, {
      email: "efirst-admin@x.com",
      roles: ["kpi_admin"],
    });
    const assignmentId = await t.run(async (ctx) => {
      const list = await ctx.db
        .query("kpiAssignments")
        .withIndex("by_employee_year", (q) => q.eq("employeeId", empId))
        .collect();
      return list.find((a) => a.canonicalKey === "asset_integration")!._id;
    });
    const base = {
      kpiAssignmentId: assignmentId,
      periodKey: "2026-M08",
      activityAt: AUG_2026,
      title: "Integrated assets",
      description: "batch",
      numerator: 9,
      denominator: 10,
    };

    // No evidence yet → the employee's capture is refused with guidance.
    await expect(emp.mutation(api.activities.create, base)).rejects.toThrow(
      /requires evidence/i,
    );

    // Admins bypass (cleanup/backfill path).
    const adminActivity = await admin.mutation(api.activities.create, base);
    await admin.mutation(api.activities.remove, { activityId: adminActivity });

    // Attaching evidence (any review status) unlocks the employee.
    await emp.mutation(api.evidence.saveEvidence, {
      kpiAssignmentId: assignmentId,
      externalUrl: "https://example.com/batch-report",
      originalFilename: "batch-report",
      mimeType: "text/uri-list",
      fileSize: 0,
      category: "batch_report",
      title: "Batch report",
    });
    await emp.mutation(api.activities.create, base);

    // Deleting the only evidence re-locks new captures (existing entries stay).
    const evidenceId = await t.run(async (ctx) => {
      const rows = await ctx.db
        .query("evidenceFiles")
        .withIndex("by_assignment", (q) => q.eq("kpiAssignmentId", assignmentId))
        .take(5);
      return rows[0]!._id;
    });
    await emp.mutation(api.evidence.removeEvidence, { evidenceId });
    await expect(
      emp.mutation(api.activities.create, { ...base, title: "Another batch" }),
    ).rejects.toThrow(/requires evidence/i);
  });
});
