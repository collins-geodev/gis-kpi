import { Constellation } from "@/components/constellation";
import { Sidebar } from "@/components/dashboard/sidebar";
import { Topbar } from "@/components/dashboard/topbar";
import { PoweredByGisTeam } from "@/components/powered-by-gis-team";

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative flex min-h-screen bg-background">
      {/* Space backdrop: stars, constellation clusters, drifting light pools. */}
      <div className="starfield" aria-hidden />
      <Constellation />
      <div className="aurora" aria-hidden />
      <Sidebar />
      <div className="relative z-10 flex min-w-0 flex-1 flex-col">
        <Topbar />
        <main className="flex-1">
          <div className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6">{children}</div>
        </main>
        <PoweredByGisTeam />
      </div>
    </div>
  );
}
