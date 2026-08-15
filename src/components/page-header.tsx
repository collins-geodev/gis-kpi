import { cn } from "@/lib/utils";

/** Standard page heading with optional actions and a last-updated stamp. */
export function PageHeader({
  title,
  description,
  actions,
  lastUpdated,
  className,
}: {
  title: string;
  description?: string;
  actions?: React.ReactNode;
  lastUpdated?: string;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-wrap items-end justify-between gap-4", className)}>
      <div>
        <h1 className="heading-gradient text-balance font-display text-2xl font-bold tracking-tight">
          {title}
        </h1>
        {description && (
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">{description}</p>
        )}
      </div>
      <div className="flex items-center gap-3">
        {lastUpdated && (
          <span className="text-xs text-muted-foreground">Updated {lastUpdated}</span>
        )}
        {actions}
      </div>
    </div>
  );
}
