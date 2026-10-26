"use client";

import Link from "next/link";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { Store } from "lucide-react";
import { PageHeader } from "@/components/common/PageHeader";
import { ApiErrorState, EmptyState, LoadingState } from "@/components/common/States";
import { Button } from "@/components/ui";
import { useSite } from "@/lib/site/SiteProvider";

// First-run page for an owner with no site yet. Owners who already have a site go to the dashboard.
export default function OnboardingPage() {
  const { status, current, error, reload } = useSite();
  const router = useRouter();

  useEffect(() => {
    if (status === "ready" && current) router.replace("/dashboard");
  }, [status, current, router]);

  if (status === "loading" && !current) return <LoadingState label="Loading your sites..." />;
  if (status === "error") return <ApiErrorState error={error!} onRetry={() => void reload()} />;
  if (current) return <LoadingState />;

  return (
    <div className="animate-fade-up">
      <PageHeader title="Welcome to DBI Intelligence" description="Let us get your site set up." />
      <EmptyState
        icon={<Store className="size-6" aria-hidden />}
        title="Start by creating your site"
        hint="It takes a minute. Then you can connect your camera."
        action={
          <Button asChild>
            <Link href="/sites/new">Create site</Link>
          </Button>
        }
      />
    </div>
  );
}
