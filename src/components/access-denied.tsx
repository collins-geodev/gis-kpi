import { Lock } from "lucide-react";
import { EmptyState } from "@/components/ui/empty-state";

export function AccessDenied({
  message = "You don't have permission to view this page.",
}: {
  message?: string;
}) {
  return (
    <EmptyState
      icon={<Lock className="h-8 w-8" />}
      title="Access denied"
      description={message}
    />
  );
}
