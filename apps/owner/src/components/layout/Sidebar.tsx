"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Brand } from "@/components/common/Brand";
import { ShopSwitcher } from "@/components/shop/ShopSwitcher";
import { useShop } from "@/lib/shop/ShopProvider";
import { cn } from "@/lib/utils/cn";
import { buildNav, isActive } from "./nav";
import type { NavItem } from "./nav";
import { UserMenu } from "./UserMenu";

function NavLink({ item, pathname }: { item: NavItem; pathname: string }) {
  const active = isActive(pathname, item);
  const Icon = item.icon;
  return (
    <Link
      href={item.href}
      aria-current={active ? "page" : undefined}
      className={cn(
        "group flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
        active ? "bg-accent text-primary" : "text-muted-foreground hover:bg-accent/60 hover:text-foreground"
      )}
    >
      <Icon
        className={cn("size-[18px]", active ? "text-primary" : "text-muted-foreground group-hover:text-foreground")}
        aria-hidden
      />
      {item.label}
      {active && <span aria-hidden className="ml-auto h-5 w-1 rounded-full bg-primary" />}
    </Link>
  );
}

function Group({ title, items, pathname }: { title?: string; items: NavItem[]; pathname: string }) {
  if (items.length === 0) return null;
  return (
    <div className="space-y-1">
      {title && (
        <p className="px-3 pb-1 pt-3 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/80">
          {title}
        </p>
      )}
      {items.map((item) => (
        <NavLink key={item.href} item={item} pathname={pathname} />
      ))}
    </div>
  );
}

// Desktop sidebar (md and up). Phones use MobileTopbar + MobileTabs instead.
export function Sidebar() {
  const pathname = usePathname();
  const { current } = useShop();
  const nav = buildNav(current?.id ?? null);

  return (
    <aside className="sticky top-0 hidden h-screen w-64 shrink-0 flex-col border-r bg-background md:flex">
      <div className="px-5 pb-3 pt-5">
        <Brand />
      </div>
      <div className="px-3 pb-2">
        <ShopSwitcher />
      </div>
      <nav aria-label="Main" className="flex-1 overflow-y-auto px-3 pb-3">
        <Group items={nav.main} pathname={pathname} />
        <Group title="Your shop" items={nav.shop} pathname={pathname} />
        <Group title="Account" items={nav.account} pathname={pathname} />
      </nav>
      <div className="border-t p-3">
        <UserMenu />
      </div>
    </aside>
  );
}
