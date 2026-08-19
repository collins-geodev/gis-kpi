/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as access from "../access.js";
import type * as activities from "../activities.js";
import type * as analytics from "../analytics.js";
import type * as approvals from "../approvals.js";
import type * as audit from "../audit.js";
import type * as auth from "../auth.js";
import type * as authz from "../authz.js";
import type * as compliance from "../compliance.js";
import type * as crons from "../crons.js";
import type * as dataQuality from "../dataQuality.js";
import type * as emails from "../emails.js";
import type * as employees from "../employees.js";
import type * as evidence from "../evidence.js";
import type * as evidenceHttp from "../evidenceHttp.js";
import type * as http from "../http.js";
import type * as kpiSettings from "../kpiSettings.js";
import type * as kpis from "../kpis.js";
import type * as lib_catalogue from "../lib/catalogue.js";
import type * as lib_dataQuality from "../lib/dataQuality.js";
import type * as lib_emailTemplate from "../lib/emailTemplate.js";
import type * as lib_format from "../lib/format.js";
import type * as lib_measure from "../lib/measure.js";
import type * as lib_periods from "../lib/periods.js";
import type * as lib_scoring from "../lib/scoring.js";
import type * as lib_sourceRows from "../lib/sourceRows.js";
import type * as lib_thresholds from "../lib/thresholds.js";
import type * as lib_trend from "../lib/trend.js";
import type * as lib_types from "../lib/types.js";
import type * as measurementsModel from "../measurementsModel.js";
import type * as migrations from "../migrations.js";
import type * as notifications from "../notifications.js";
import type * as overrides from "../overrides.js";
import type * as overview from "../overview.js";
import type * as passwords from "../passwords.js";
import type * as profile from "../profile.js";
import type * as rateLimit from "../rateLimit.js";
import type * as reminders from "../reminders.js";
import type * as reports from "../reports.js";
import type * as seed from "../seed.js";
import type * as users from "../users.js";
import type * as validators from "../validators.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  access: typeof access;
  activities: typeof activities;
  analytics: typeof analytics;
  approvals: typeof approvals;
  audit: typeof audit;
  auth: typeof auth;
  authz: typeof authz;
  compliance: typeof compliance;
  crons: typeof crons;
  dataQuality: typeof dataQuality;
  emails: typeof emails;
  employees: typeof employees;
  evidence: typeof evidence;
  evidenceHttp: typeof evidenceHttp;
  http: typeof http;
  kpiSettings: typeof kpiSettings;
  kpis: typeof kpis;
  "lib/catalogue": typeof lib_catalogue;
  "lib/dataQuality": typeof lib_dataQuality;
  "lib/emailTemplate": typeof lib_emailTemplate;
  "lib/format": typeof lib_format;
  "lib/measure": typeof lib_measure;
  "lib/periods": typeof lib_periods;
  "lib/scoring": typeof lib_scoring;
  "lib/sourceRows": typeof lib_sourceRows;
  "lib/thresholds": typeof lib_thresholds;
  "lib/trend": typeof lib_trend;
  "lib/types": typeof lib_types;
  measurementsModel: typeof measurementsModel;
  migrations: typeof migrations;
  notifications: typeof notifications;
  overrides: typeof overrides;
  overview: typeof overview;
  passwords: typeof passwords;
  profile: typeof profile;
  rateLimit: typeof rateLimit;
  reminders: typeof reminders;
  reports: typeof reports;
  seed: typeof seed;
  users: typeof users;
  validators: typeof validators;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {};
