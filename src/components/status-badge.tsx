import { Badge } from "@/components/ui/badge";
import { STATUS_BAND_LABELS, type StatusBand } from "@convex/lib/types";

const VARIANT: Record<StatusBand, React.ComponentProps<typeof Badge>["variant"]> = {
  on_target: "success",
  watch: "info",
  at_risk: "warning",
  critical: "critical",
  no_data: "muted",
};

/** Accessible status pill mapped from a KPI status band. */
export function StatusBadge({ status }: { status: StatusBand }) {
  return (
    <Badge variant={VARIANT[status]}>
      <span aria-hidden>●</span> {STATUS_BAND_LABELS[status]}
    </Badge>
  );
}
