"use client";

import { useParams } from "next/navigation";
import { EventInbox } from "@/components/alerts/EventInbox";

// The same inbox, narrowed to one site.
export default function SiteAlertsPage() {
  const { siteId } = useParams<{ siteId: string }>();
  return <EventInbox siteId={siteId} />;
}
