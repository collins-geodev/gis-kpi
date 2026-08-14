import { test, expect } from "@playwright/test";

/**
 * Smoke tests — verify the public entry points and auth gating work.
 * Deeper flows (capture → evidence → approve) require a seeded backend and a
 * signed-in session; add authenticated fixtures when running against a preview.
 */

test("sign-in page renders", async ({ page }) => {
  await page.goto("/signin");
  await expect(page.getByText("GIS KPI Performance Dashboard")).toBeVisible();
  await expect(page.getByLabel("Work email")).toBeVisible();
});

test("unauthenticated root redirects to sign-in", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveURL(/\/signin/);
});

test("protected route redirects to sign-in when unauthenticated", async ({ page }) => {
  await page.goto("/overview");
  await expect(page).toHaveURL(/\/signin/);
});
