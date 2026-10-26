"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Check, ChevronsUpDown, Plus, Store } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui";
import { useShop } from "@/lib/shop/ShopProvider";
import { cn } from "@/lib/utils/cn";

// Shows the current shop and lets the owner switch or add another one.
export function ShopSwitcher({ className }: { className?: string }) {
  const { shops, current, select, status } = useShop();
  const router = useRouter();

  if (status === "loading" && !current) {
    return <div aria-hidden className={cn("h-12 animate-pulse rounded-lg bg-primary/10", className)} />;
  }

  if (!current) {
    return (
      <Link
        href="/shops/new"
        className={cn(
          "flex items-center gap-2 rounded-lg border border-dashed border-primary/40 px-3 py-2.5 text-sm font-medium text-primary transition-colors hover:bg-accent",
          className
        )}
      >
        <Plus className="size-4" aria-hidden /> Create your shop
      </Link>
    );
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={`Current shop: ${current.name}. Switch shop`}
          className={cn(
            "flex w-full items-center gap-3 rounded-lg border bg-background p-2.5 text-left shadow-sm transition-colors hover:bg-accent/60",
            className
          )}
        >
          <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-accent text-primary">
            <Store className="size-4" aria-hidden />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-medium">{current.name}</span>
            <span className="block truncate text-xs text-muted-foreground">
              {current.timezone}
              {current.demo ? " · DEMO" : ""}
            </span>
          </span>
          <ChevronsUpDown className="size-4 shrink-0 text-muted-foreground" aria-hidden />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-64">
        <DropdownMenuLabel>Your shops</DropdownMenuLabel>
        {shops.map((s) => (
          <DropdownMenuItem
            key={s.id}
            onSelect={() => {
              select(s.id);
              router.push("/dashboard");
            }}
          >
            <span className="min-w-0 flex-1 truncate">{s.name}</span>
            {s.id === current.id && <Check className="text-primary" aria-hidden />}
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link href="/shops/new">
            <Plus aria-hidden /> Add another shop
          </Link>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
