import {
  BarChart3,
  CheckSquare,
  ClipboardList,
  FileText,
  FolderCheck,
  LayoutDashboard,
  ScrollText,
  Settings,
  ShieldAlert,
  UserCog,
  Users2,
  type LucideIcon,
} from "lucide-react";
import type { AppRole } from "@convex/lib/types";

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  /** Undefined = visible to any authenticated user with a role. */
  roles?: AppRole[];
}

export interface NavGroup {
  label: string;
  items: NavItem[];
}

export const NAV: NavGroup[] = [
  {
    label: "Performance",
    items: [
      { href: "/overview", label: "Executive Overview", icon: LayoutDashboard },
      { href: "/team", label: "Team Performance", icon: Users2 },
      { href: "/analytics", label: "Analytics", icon: BarChart3 },
      { href: "/reports", label: "Reports & Exports", icon: FileText },
    ],
  },
  {
    label: "My Work",
    items: [
      { href: "/activities", label: "Activity Capture", icon: ClipboardList },
      { href: "/evidence", label: "Evidence Centre", icon: FolderCheck },
      {
        href: "/review",
        label: "Review & Approval",
        icon: CheckSquare,
        roles: ["manager", "reviewer", "kpi_admin", "system_admin"],
      },
    ],
  },
  {
    label: "Governance",
    items: [
      {
        href: "/data-quality",
        label: "Data Quality",
        icon: ShieldAlert,
        roles: ["kpi_admin", "system_admin", "auditor"],
      },
      {
        href: "/settings/kpi",
        label: "KPI Settings",
        icon: Settings,
        roles: ["kpi_admin", "system_admin"],
      },
      {
        href: "/settings/users",
        label: "Users & Organization",
        icon: UserCog,
        roles: ["system_admin"],
      },
      {
        href: "/audit",
        label: "Audit Log",
        icon: ScrollText,
        roles: ["auditor", "system_admin"],
      },
    ],
  },
];

export function visibleTo(item: NavItem, roles: AppRole[]): boolean {
  if (!item.roles) return true;
  return item.roles.some((r) => roles.includes(r));
}
