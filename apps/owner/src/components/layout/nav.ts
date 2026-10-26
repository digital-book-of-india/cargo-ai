import {
  Bell,
  BarChart3,
  ScrollText,
  Camera,
  LayoutDashboard,
  Settings,
  ShieldAlert,
  Store,
  Truck,
  Users,
  Warehouse,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  /** match only this exact path (not its children) */
  exact?: boolean;
  /** a number shown next to the label, for example unread notifications */
  badge?: number;
}

export interface NavGroups {
  main: NavItem[];
  site: NavItem[];
  account: NavItem[];
  /** short list for the phone tab bar */
  tabs: NavItem[];
}

// Site-scoped links need the current site id. Without a site they are left out.
export function buildNav(siteId: string | null, caps: { users?: boolean; unread?: number; audit?: boolean } = {}): NavGroups {
  const dashboard: NavItem = { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard };
  const settings: NavItem = { href: "/settings", label: "Settings", icon: Settings };
  const notifications: NavItem = { href: "/notifications", label: "Notifications", icon: Bell, badge: caps.unread };
  const alerts: NavItem = { href: "/alerts", label: "Alerts", icon: ShieldAlert };
  const shipments: NavItem = { href: "/shipments", label: "Shipments", icon: Truck };
  const sites: NavItem = { href: "/sites", label: "Sites", icon: Warehouse, exact: true };
  const reports: NavItem = { href: "/reports", label: "Reports", icon: BarChart3 };
  const audit: NavItem = { href: "/audit", label: "Audit trail", icon: ScrollText };
  const users: NavItem = { href: "/users", label: "Users and roles", icon: Users };

  const site: NavItem[] = siteId
    ? [
        { href: `/sites/${siteId}`, label: "Site profile", icon: Store, exact: true },
        { href: `/sites/${siteId}/cameras`, label: "Cameras", icon: Camera },
      ]
    : [];

  return {
    main: [dashboard, alerts, shipments, reports, sites],
    site,
    account: [...(caps.users ? [users] : []), ...(caps.audit ? [audit] : []), notifications, settings],
    tabs: [dashboard, alerts, notifications, settings],
  };
}

export function isActive(pathname: string, item: NavItem): boolean {
  if (item.exact) return pathname === item.href;
  return pathname === item.href || pathname.startsWith(item.href + "/");
}
