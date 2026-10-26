"use client";

import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { NoAccess } from "@/components/common/NoAccess";
import { PageHeader } from "@/components/common/PageHeader";
import { SiteForm } from "@/components/site/SiteForm";
import type { SiteFormValues } from "@/components/site/SiteForm";
import { Card, CardContent } from "@/components/ui";
import { sitesApi } from "@/lib/api/sites";
import { useAuth } from "@/lib/auth/AuthProvider";
import { useSite } from "@/lib/site/SiteProvider";

export default function NewSitePage() {
  const router = useRouter();
  const { sites, upsert, select } = useSite();
  const { can } = useAuth();

  async function createSite(values: SiteFormValues) {
    const { site } = await sitesApi.create(values);
    upsert(site);
    select(site.id);
    toast.success(`${site.name} created`, { description: "Next: connect your camera." });
    router.push(`/sites/${site.id}/cameras`);
  }

  if (!can("sites:write")) return <NoAccess what="the add site screen" />;

  return (
    <div className="mx-auto max-w-2xl animate-fade-up">
      <PageHeader
        title={sites.length === 0 ? "Create your site" : "Add another site"}
        description="Tell us about the site you want to protect. You can change this later."
      />
      <Card>
        <CardContent className="pt-5">
          <SiteForm
            submitLabel="Create site"
            onSubmit={createSite}
            onCancel={sites.length > 0 ? () => router.back() : undefined}
          />
        </CardContent>
      </Card>
    </div>
  );
}
