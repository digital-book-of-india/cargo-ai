"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Brand } from "@/components/common/Brand";
import { ShopSwitcher } from "@/components/shop/ShopSwitcher";
import { useShop } from "@/lib/shop/ShopProvider";
import { cn } from "@/lib/utils/cn";
import { buildNav, isActive } from "./nav";
import { UserMenu } from "./UserMenu";

// Phone layout: slim top bar (brand, shop switcher, account) plus a bottom tab bar.
export function MobileTopbar() {
  return (
    <header className="sticky top-0 z-30 border-b bg-background/90 px-4 py-2.5 backdrop-blur md:hidden">
      <div className="flex items-center justify-between">
        <Brand />
        <UserMenu compact />
      </div>
      <ShopSwitcher className="mt-2.5" />
    </header>
  );
}

export function MobileTabs() {
  const pathname = usePathname();
  const { current } = useShop();
  const { tabs } = buildNav(current?.id ?? null);

  return (
    <nav
      aria-label="Main"
      className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-4 border-t bg-background/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden"
    >
      {tabs.map((item) => {
        const active = isActive(pathname, item);
        const Icon = item.icon;
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "flex flex-col items-center gap-1 py-2.5 text-[11px] font-medium transition-colors",
              active ? "text-primary" : "text-muted-foreground"
            )}
          >
            <Icon className="size-5" aria-hidden />
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
