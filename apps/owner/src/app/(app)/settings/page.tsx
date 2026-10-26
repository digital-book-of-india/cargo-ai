"use client";

import { useState } from "react";
import Link from "next/link";
import { LogOut, Store } from "lucide-react";
import { PageHeader } from "@/components/common/PageHeader";
import { CompanyCard } from "@/components/settings/CompanyCard";
import { OperatingSettingsCard } from "@/components/settings/OperatingSettingsCard";
import { PrivacyCard } from "@/components/settings/PrivacyCard";
import { ProfileCard } from "@/components/settings/ProfileCard";
import { Button, Card } from "@/components/ui";
import { useAuth } from "@/lib/auth/AuthProvider";
import { useSite } from "@/lib/site/SiteProvider";

export default function SettingsPage() {
  const { logout } = useAuth();
  const { current } = useSite();
  const [signingOut, setSigningOut] = useState(false);

  async function onSignOut() {
    setSigningOut(true);
    await logout(); // RequireAuth then sends the owner to /login
  }

  return (
    <div className="animate-fade-up">
      <PageHeader title="Settings" description="Your profile, your company and how it operates." />
      <div className="mx-auto max-w-2xl space-y-5">
        <ProfileCard />
        <CompanyCard />
        <OperatingSettingsCard />
        <PrivacyCard />

        <Card className="p-5">
          <h2 className="font-semibold">Your sites</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Name, time zone and address are on each site profile. Cameras have their own pages.
          </p>
          {current && (
            <Button asChild variant="outline" className="mt-3">
              <Link href={`/sites/${current.id}`}>
                <Store aria-hidden /> Open site profile
              </Link>
            </Button>
          )}
        </Card>

        <Card className="p-5">
          <h2 className="font-semibold">Account</h2>
          <Button variant="outline" className="mt-3" loading={signingOut} onClick={() => void onSignOut()}>
            <LogOut aria-hidden /> Sign out
          </Button>
        </Card>
      </div>
    </div>
  );
}
