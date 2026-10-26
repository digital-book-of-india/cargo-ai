import {
  Bell,
  CalendarClock,
  Camera,
  LayoutDashboard,
  ListChecks,
  Settings,
  ShieldAlert,
  Store,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  /** match only this exact path (not its children) */
  exact?: boolean;
}

export interface NavGroups {
  main: NavItem[];
  shop: NavItem[];
  account: NavItem[];
  /** short list for the phone tab bar */
  tabs: NavItem[];
}

// Shop-scoped links need the current shop id. Without a shop they are left out.
export function buildNav(shopId: string | null): NavGroups {
  const dashboard: NavItem = { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard };
  const setup: NavItem = { href: "/onboarding", label: "Setup", icon: ListChecks };
  const settings: NavItem = { href: "/settings", label: "Settings", icon: Settings };
  const notifications: NavItem = { href: "/notifications", label: "Notifications", icon: Bell };

  const shop: NavItem[] = shopId
    ? [
        { href: `/shops/${shopId}`, label: "Shop profile", icon: Store, exact: true },
        { href: `/shops/${shopId}/schedule`, label: "Opening hours", icon: CalendarClock },
        { href: `/shops/${shopId}/cameras`, label: "Cameras", icon: Camera },
        { href: `/shops/${shopId}/alerts`, label: "Alerts", icon: ShieldAlert },
      ]
    : [];

  const alertsTab: NavItem = shopId
    ? { href: `/shops/${shopId}/alerts`, label: "Alerts", icon: ShieldAlert }
    : notifications;

  return {
    main: [dashboard, setup],
    shop,
    account: [notifications, settings],
    tabs: [dashboard, setup, alertsTab, settings],
  };
}

export function isActive(pathname: string, item: NavItem): boolean {
  if (item.exact) return pathname === item.href;
  return pathname === item.href || pathname.startsWith(item.href + "/");
}
