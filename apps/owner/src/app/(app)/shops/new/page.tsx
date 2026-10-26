"use client";

import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { PageHeader } from "@/components/common/PageHeader";
import { ShopForm } from "@/components/shop/ShopForm";
import type { ShopFormValues } from "@/components/shop/ShopForm";
import { Card, CardContent } from "@/components/ui";
import { shopsApi } from "@/lib/api/shops";
import { useShop } from "@/lib/shop/ShopProvider";

export default function NewShopPage() {
  const router = useRouter();
  const { shops, upsert, select } = useShop();

  async function createShop(values: ShopFormValues) {
    const { shop } = await shopsApi.create(values);
    upsert(shop);
    select(shop.id);
    toast.success(`${shop.name} created`, { description: "Next: connect your camera." });
    router.push(`/shops/${shop.id}/cameras`);
  }

  return (
    <div className="mx-auto max-w-2xl animate-fade-up">
      <PageHeader
        title={shops.length === 0 ? "Create your shop" : "Add another shop"}
        description="Tell us about the shop you want to protect. You can change this later."
      />
      <Card>
        <CardContent className="pt-5">
          <ShopForm
            submitLabel="Create shop"
            onSubmit={createShop}
            onCancel={shops.length > 0 ? () => router.back() : undefined}
          />
        </CardContent>
      </Card>
    </div>
  );
}
