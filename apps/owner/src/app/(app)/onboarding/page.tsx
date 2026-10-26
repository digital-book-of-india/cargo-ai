"use client";

import Link from "next/link";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { Store } from "lucide-react";
import { PageHeader } from "@/components/common/PageHeader";
import { ApiErrorState, EmptyState, LoadingState } from "@/components/common/States";
import { Button } from "@/components/ui";
import { useShop } from "@/lib/shop/ShopProvider";

// First-run page for an owner with no shop yet. Owners who already have a shop go to the dashboard.
export default function OnboardingPage() {
  const { status, current, error, reload } = useShop();
  const router = useRouter();

  useEffect(() => {
    if (status === "ready" && current) router.replace("/dashboard");
  }, [status, current, router]);

  if (status === "loading" && !current) return <LoadingState label="Loading your shops..." />;
  if (status === "error") return <ApiErrorState error={error!} onRetry={() => void reload()} />;
  if (current) return <LoadingState />;

  return (
    <div className="animate-fade-up">
      <PageHeader title="Welcome to DBI Intelligence" description="Let us get your shop set up." />
      <EmptyState
        icon={<Store className="size-6" aria-hidden />}
        title="Start by creating your shop"
        hint="It takes a minute. Then you can connect your camera."
        action={
          <Button asChild>
            <Link href="/shops/new">Create shop</Link>
          </Button>
        }
      />
    </div>
  );
}
