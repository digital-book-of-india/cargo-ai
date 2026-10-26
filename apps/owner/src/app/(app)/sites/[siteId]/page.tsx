"use client";

import { useEffect } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { toast } from "sonner";
import { ArrowRight, Camera, ShieldAlert } from "lucide-react";
import { DemoBadge } from "@/components/common/DemoBadge";
import { PageHeader } from "@/components/common/PageHeader";
import { Alert, ApiErrorState, LoadingState } from "@/components/common/States";
import { SiteStatusBadge } from "@/components/common/StatusBadges";
import { SiteForm } from "@/components/site/SiteForm";
import type { SiteFormValues } from "@/components/site/SiteForm";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui";
import { useAsync } from "@/hooks/useAsync";
import { sitesApi } from "@/lib/api/sites";
import { useAuth } from "@/lib/auth/AuthProvider";
import { useSite } from "@/lib/site/SiteProvider";

export default function SiteProfilePage() {
  const { siteId } = useParams<{ siteId: string }>();
  const { upsert, select } = useSite();
  const { canAtSite } = useAuth();
  const canEdit = canAtSite("sites:write", siteId);
  const { data, error, loading, reload } = useAsync(() => sitesApi.get(siteId), [siteId]);
  const site = data?.site ?? null;

  // Opening a site makes it the current one.
  useEffect(() => {
    if (site) {
      upsert(site);
      select(site.id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [site?.id]);

  async function save(values: SiteFormValues) {
    const res = await sitesApi.update(siteId, values);
    upsert(res.site);
    toast.success("Site updated");
    reload();
  }

  if (loading && !site) return <LoadingState label="Loading site..." />;
  if (error) return <ApiErrorState error={error} onRetry={reload} />;
  if (!site) return null;

  const links = [
    { href: `/sites/${site.id}/cameras`, label: "Cameras", text: "Connect and test your CCTV", icon: Camera },
    { href: `/sites/${site.id}/alerts`, label: "Alerts", text: "Review suspected activity", icon: ShieldAlert },
  ];

  return (
    <div className="animate-fade-up space-y-6">
      <PageHeader
        title={site.name}
        description="Your site details and quick links."
        actions={
          <div className="flex items-center gap-2">
            {site.demo && <DemoBadge />}
            <SiteStatusBadge status={site.status} />
          </div>
        }
      />

      {site.status !== "ACTIVE" && (
        <Alert tone="danger">
          This site is {site.status === "INACTIVE" ? "inactive" : "archived"}, so monitoring is off. Ask a
          company admin or support to reactivate it.
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
          <CardTitle>Site details</CardTitle>
          <CardDescription>
            Times in alerts and reports follow this timezone.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {/* key remounts the form with fresh values after each save */}
          <SiteForm
            key={`${site.name}|${site.timezone}|${JSON.stringify(site.address ?? {})}`}
            initial={site}
            submitLabel="Save changes"
            requireChange
            readOnly={!canEdit}
            onSubmit={save}
          />
        </CardContent>
      </Card>
    </div>
  );
}
