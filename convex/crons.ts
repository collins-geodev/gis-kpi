import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

// Flag overdue tracking periods every morning (06:00 UTC ≈ 07:00 Africa/Lagos).
crons.daily(
  "flag overdue periods",
  { hourUTC: 6, minuteUTC: 0 },
  internal.reminders.scanOverdue,
);

// Nudge managers about the review backlog on weekday mornings.
crons.daily(
  "review backlog reminder",
  { hourUTC: 7, minuteUTC: 30 },
  internal.reminders.notifyReviewBacklog,
);

// Close periods whose grace window has fully elapsed (7 days past due).
crons.daily(
  "close expired grace periods",
  { hourUTC: 6, minuteUTC: 15 },
  internal.reminders.closeExpiredGracePeriods,
);

// Submission reminder ladder: due-soon nudges, overdue notices, admin escalation.
crons.daily(
  "submission reminders",
  { hourUTC: 7, minuteUTC: 0 },
  internal.reminders.scanSubmissionReminders,
  {},
);

export default crons;
