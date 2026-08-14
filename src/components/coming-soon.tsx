import { Hammer } from "lucide-react";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/page-header";

/**
 * Interim placeholder for pages whose write-heavy workflows are being wired in
 * a later build phase. The route + navigation are live so nothing 404s.
 */
export function ComingSoon({
  title,
  description,
  planned,
}: {
  title: string;
  description: string;
  planned: string[];
}) {
  return (
    <div className="space-y-6">
      <PageHeader title={title} description={description} />
      <EmptyState
        icon={<Hammer className="h-8 w-8" />}
        title="Being wired next"
        description="This workflow is part of the current build sequence. Planned capabilities:"
      />
      <ul className="mx-auto max-w-xl list-disc space-y-1 pl-6 text-sm text-muted-foreground">
        {planned.map((p) => (
          <li key={p}>{p}</li>
        ))}
      </ul>
    </div>
  );
}
