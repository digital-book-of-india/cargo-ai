"use client";

import { useState } from "react";
import Link from "next/link";
import { LogOut, Store } from "lucide-react";
import { PageHeader } from "@/components/common/PageHeader";
import { PreferencesCard } from "@/components/settings/PreferencesCard";
import { PrivacyCard } from "@/components/settings/PrivacyCard";
import { ProfileCard } from "@/components/settings/ProfileCard";
import { Button, Card } from "@/components/ui";
import { useAuth } from "@/lib/auth/AuthProvider";
import { useShop } from "@/lib/shop/ShopProvider";

export default function SettingsPage() {
  const { logout } = useAuth();
  const { current } = useShop();
  const [signingOut, setSigningOut] = useState(false);

  async function onSignOut() {
    setSigningOut(true);
    await logout(); // RequireAuth then sends the owner to /login
  }

  return (
    <div className="animate-fade-up">
      <PageHeader title="Settings" description="Your profile and how we notify you." />
      <div className="mx-auto max-w-2xl space-y-5">
        <ProfileCard />
        <PreferencesCard />
        <PrivacyCard />

        <Card className="p-5">
          <h2 className="font-semibold">Your shop</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Name, time zone and address are on the shop profile. Opening hours and cameras have their own
            pages.
          </p>
          {current && (
            <Button asChild variant="outline" className="mt-3">
              <Link href={`/shops/${current.id}`}>
                <Store aria-hidden /> Open shop profile
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
