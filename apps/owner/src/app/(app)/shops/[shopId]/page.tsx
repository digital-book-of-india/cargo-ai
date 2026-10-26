"use client";

import { useEffect } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { toast } from "sonner";
import { ArrowRight, CalendarClock, Camera, ShieldAlert } from "lucide-react";
import { DemoBadge } from "@/components/common/DemoBadge";
import { PageHeader } from "@/components/common/PageHeader";
import { Alert, ApiErrorState, LoadingState } from "@/components/common/States";
import { ShopStatusBadge } from "@/components/common/StatusBadges";
import { ShopForm } from "@/components/shop/ShopForm";
import type { ShopFormValues } from "@/components/shop/ShopForm";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui";
import { useAsync } from "@/hooks/useAsync";
import { shopsApi } from "@/lib/api/shops";
import { useShop } from "@/lib/shop/ShopProvider";

export default function ShopProfilePage() {
  const { shopId } = useParams<{ shopId: string }>();
  const { upsert, select } = useShop();
  const { data, error, loading, reload } = useAsync(() => shopsApi.get(shopId), [shopId]);
  const shop = data?.shop ?? null;

  // Opening a shop makes it the current one.
  useEffect(() => {
    if (shop) {
      upsert(shop);
      select(shop.id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shop?.id]);

  async function save(values: ShopFormValues) {
    const res = await shopsApi.update(shopId, values);
    upsert(res.shop);
    toast.success("Shop updated");
    reload();
  }

  if (loading && !shop) return <LoadingState label="Loading shop..." />;
  if (error) return <ApiErrorState error={error} onRetry={reload} />;
  if (!shop) return null;

  const links = [
    { href: `/shops/${shop.id}/schedule`, label: "Opening hours", text: "When you open and close", icon: CalendarClock },
    { href: `/shops/${shop.id}/cameras`, label: "Cameras", text: "Connect and test your CCTV", icon: Camera },
    { href: `/shops/${shop.id}/alerts`, label: "Alerts", text: "Review suspected activity", icon: ShieldAlert },
  ];

  return (
    <div className="animate-fade-up space-y-6">
      <PageHeader
        title={shop.name}
        description="Your shop details and quick links."
        actions={
          <div className="flex items-center gap-2">
            {shop.demo && <DemoBadge />}
            <ShopStatusBadge status={shop.status} />
          </div>
        }
      />

      {shop.status === "SUSPENDED" && (
        <Alert tone="danger">
          This shop is suspended, so monitoring is off. Please contact support to reactivate it.
        </Alert>
      )}

      <div className="grid gap-4 sm:grid-cols-3">
        {links.map(({ href, label, text, icon: Icon }) => (
          <Link key={href} href={href} className="group">
            <Card className="h-full transition-shadow group-hover:shadow-pop">
              <CardHeader>
                <div className="flex items-center justify-between">
                  <span className="flex size-9 items-center justify-center rounded-lg bg-accent text-primary">
                    <Icon className="size-[18px]" aria-hidden />
                  </span>
                  <ArrowRight
                    className="size-4 text-muted-foreground transition-transform group-hover:translate-x-0.5"
                    aria-hidden
                  />
                </div>
                <CardTitle className="pt-2">{label}</CardTitle>
                <CardDescription>{text}</CardDescription>
              </CardHeader>
            </Card>
          </Link>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Shop details</CardTitle>
          <CardDescription>
            Changing the timezone changes when monitoring arms and disarms.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {/* key remounts the form with fresh values after each save */}
          <ShopForm
            key={`${shop.name}|${shop.timezone}|${JSON.stringify(shop.address ?? {})}`}
            initial={shop}
            submitLabel="Save changes"
            requireChange
            onSubmit={save}
          />
        </CardContent>
      </Card>
    </div>
  );
}
