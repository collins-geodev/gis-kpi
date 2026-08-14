# GIS Team KPI Performance Dashboard

Auditable, role-based KPI performance management for the **GIS Unit** (Technical Services). Next.js 15 (App Router) + Convex + Vercel AI SDK, with a deterministic scoring engine, evidence-backed activities, review/approval workflow, structured-AI PDF reports, and professional Excel export.

> Every score is reproducible from source activity + evidence; every normalization of the 2026 workbook is surfaced as an admin-approvable data-quality issue — nothing is silently corrected.

- **Architecture:** [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)
- **Source-data reconciliation:** [docs/RECONCILIATION.md](docs/RECONCILIATION.md)

## Infrastructure (already provisioned)

| Thing | Value |
|---|---|
| Convex project | `gis-kpi` |
| Convex dev deployment | `cautious-grasshopper-472` |
| Convex prod deployment | `scintillating-bulldog-550` |
| GitHub repo | `collins-geodev/gis-kpi` |
| Vercel project | `gis-kpi` → `gis-kpi.vercel.app` |

## Prerequisites

- Node.js ≥ 18.18
- Accounts: Convex, Vercel, GitHub (all provisioned above)
- A Vercel AI Gateway key (for AI report narrative) — optional until you generate AI reports

## Local setup — exact steps

```bash
# 1. Install dependencies
npm install
```

```bash
# 2. Start the Convex dev backend (interactive login the first time).
#    When prompted, choose the EXISTING project "gis-kpi" and the dev
#    deployment. This generates convex/_generated/* and writes
#    CONVEX_DEPLOYMENT + NEXT_PUBLIC_CONVEX_URL into .env.local.
npx convex dev
```

```bash
# 3. Configure Convex Auth (generates JWT keys + SITE_URL in the Convex env).
npx @convex-dev/auth
```

```bash
# 4. Seed the 2026 baseline (15 employees, 75 KPI assignments, data-quality issues).
npx convex run seed:seedBaseline
```

```bash
# 5. In a second terminal, run the web app.
npm run dev
```

Then open http://localhost:3000 → **create an account** → on the overview, click **Claim System Admin** (only the first user can, and only if no admin exists). Optionally set `ADMIN_BOOTSTRAP_EMAIL` in the Convex env to lock the bootstrap to a specific address.

### Environment variables

Copy `.env.example` → `.env.local`. `npx convex dev` fills `NEXT_PUBLIC_CONVEX_URL`. Secrets live in the Convex/Vercel dashboards, never in git:

| Variable | Where | Purpose |
|---|---|---|
| `NEXT_PUBLIC_CONVEX_URL` | `.env.local` (auto) | Convex client URL |
| `SITE_URL` | Convex env | Auth callback origin |
| `JWT_PRIVATE_KEY` / `JWKS` | Convex env (auto via auth CLI) | Auth token signing |
| `AI_GATEWAY_API_KEY` | Convex/Vercel env | Vercel AI Gateway access |
| `AI_REPORT_MODEL` | env | Model id (verify against live gateway list) |
| `ADMIN_BOOTSTRAP_EMAIL` | Convex env | Locks first-admin claim to one email |

## Scripts

| Command | Purpose |
|---|---|
| `npm run dev` | Next.js dev server |
| `npm run convex` | Convex dev backend (codegen + live push) |
| `npm test` | Vitest unit tests (scoring + reconciliation) |
| `npm run typecheck` | `tsc --noEmit` (after `convex dev` has generated types) |
| `npm run lint` / `npm run format` | ESLint / Prettier |
| `npm run seed` | `convex run seed:seedBaseline` |
| `npm run build` | Production build |
| `npm run verify` | format:check + typecheck + lint + test + build |

## Deployment — exact steps

### GitHub

```bash
git init && git add -A && git commit -m "GIS KPI Dashboard"
git branch -M main
git remote add origin https://github.com/collins-geodev/gis-kpi.git
git push -u origin main
```

Protect `main`: require PRs + the CI checks (lint, typecheck, test, build) before merge.

### Convex production

```bash
# Push schema + functions to the production deployment.
npx convex deploy   # targets scintillating-bulldog-550
# Seed production once:
npx convex run seed:seedBaseline --prod
```

### Vercel

1. Import `collins-geodev/gis-kpi` into the `gis-kpi` Vercel project.
2. **Build command:** `npx convex deploy --cmd 'npm run build'` (deploys Convex, injects the prod `NEXT_PUBLIC_CONVEX_URL`, then builds Next).
3. Set env vars: `CONVEX_DEPLOY_KEY` (prod deploy key from the Convex dashboard), `AI_GATEWAY_API_KEY`, `AI_REPORT_MODEL`.
4. Preview deployments: every PR gets an isolated Vercel Preview; pair with a Convex preview deployment (`CONVEX_DEPLOY_KEY` preview key) and seed preview data with safe test values (never production employee evidence).

## Testing

```bash
npm test            # 47 unit tests: scoring engine + workbook reconciliation
npm run test:e2e    # Playwright end-to-end (added in the test phase)
```

The scoring engine is deterministic and never delegates official scores to the AI model. See [convex/lib/scoring.ts](convex/lib/scoring.ts).

## Documentation

- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — IA, routes, authz matrix, scoring, AI/export pipeline
- [docs/RECONCILIATION.md](docs/RECONCILIATION.md) — source-data reconciliation + anomaly ledger
- Administrator guide + employee/reviewer guide — added in the documentation phase.

---

**Powered by the GIS Team.**
