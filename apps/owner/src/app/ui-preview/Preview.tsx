"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Bell, Camera, Clock3, ShieldCheck } from "lucide-react";
import { DemoBadge } from "@/components/common/DemoBadge";
import { DemoBanner } from "@/components/common/DemoBanner";
import { PageHeader } from "@/components/common/PageHeader";
import { Alert, EmptyState, ErrorState, LoadingState } from "@/components/common/States";
import {
  CameraStatusBadge,
  ReviewStatusBadge,
  SecurityStateBadge,
  ShopStatusBadge,
} from "@/components/common/StatusBadges";
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Checkbox,
  Modal,
  Progress,
  SelectField,
  Separator,
  Skeleton,
  Switch,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  TextField,
} from "@/components/ui";
import type { CameraStatus, MonitoringState, ReviewStatus, ShopStatus } from "@/types";

const monitoringStates: MonitoringState[] = [
  "MONITORING",
  "DISARMED",
  "DEGRADED",
  "OFFLINE",
  "SETUP_REQUIRED",
];
const cameraStates: CameraStatus[] = ["PENDING_TEST", "ONLINE", "OFFLINE", "ERROR"];
const reviewStates: ReviewStatus[] = ["NEW", "REVIEWED", "FALSE_ALARM", "CONFIRMED"];
const shopStates: ShopStatus[] = ["PENDING_SETUP", "ACTIVE", "SUSPENDED"];

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">{title}</h2>
      {children}
    </section>
  );
}

export function Preview() {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [tz, setTz] = useState("Asia/Kolkata");
  const [armed, setArmed] = useState(true);

  return (
    <div className="min-h-screen bg-muted/40">
      <DemoBanner />
      <div className="mx-auto max-w-4xl space-y-10 p-4 md:p-8">
        <PageHeader
          title="UI preview"
          description="Every shared component in the DBI Intelligence design system (dev only)."
          actions={<DemoBadge />}
        />

        <Section title="Buttons">
          <div className="flex flex-wrap items-center gap-2">
            <Button>Primary</Button>
            <Button variant="secondary">Secondary</Button>
            <Button variant="outline">Outline</Button>
            <Button variant="ghost">Ghost</Button>
            <Button variant="danger">Danger</Button>
            <Button variant="link">Link</Button>
            <Button disabled>Disabled</Button>
            <Button size="sm">Small</Button>
            <Button size="lg">Large</Button>
            <Button
              loading={loading}
              onClick={() => {
                setLoading(true);
                setTimeout(() => {
                  setLoading(false);
                  toast.success("Schedule saved");
                }, 1200);
              }}
            >
              Save with toast
            </Button>
          </div>
        </Section>

        <Section title="Form fields">
          <Card>
            <CardContent className="grid gap-4 pt-5 sm:grid-cols-2">
              <TextField label="Shop name" placeholder="Main Street Shop" />
              <TextField label="With error" defaultValue="abc" error="Use HH:mm format" />
              <TextField label="Password" type="password" hint="Click the eye to show it" />
              <SelectField
                label="Timezone"
                hint="IANA timezone"
                value={tz}
                onValueChange={setTz}
                options={[
                  { value: "Asia/Kolkata", label: "Asia/Kolkata (IST)" },
                  { value: "Asia/Dubai", label: "Asia/Dubai (GST)" },
                  { value: "UTC", label: "UTC" },
                ]}
              />
              <label className="flex items-center gap-3 text-sm">
                <Switch checked={armed} onCheckedChange={setArmed} aria-label="Closed all day" />
                Closed all day
              </label>
              <label className="flex items-center gap-3 text-sm">
                <Checkbox defaultChecked aria-label="Enabled" />
                Zone enabled
              </label>
            </CardContent>
          </Card>
        </Section>

        <Section title="Status badges (honest labels)">
          <Card>
            <CardContent className="space-y-3 pt-5">
              <div className="flex flex-wrap gap-2">
                {monitoringStates.map((s) => (
                  <SecurityStateBadge key={s} state={s} />
                ))}
              </div>
              <Separator />
              <div className="flex flex-wrap gap-2">
                {cameraStates.map((s) => (
                  <CameraStatusBadge key={s} status={s} />
                ))}
                {reviewStates.map((s) => (
                  <ReviewStatusBadge key={s} status={s} />
                ))}
                {shopStates.map((s) => (
                  <ShopStatusBadge key={s} status={s} />
                ))}
                <Badge tone="primary">primary</Badge>
              </div>
            </CardContent>
          </Card>
        </Section>

        <Section title="Cards">
          <div className="grid gap-4 sm:grid-cols-2">
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle>Security status</CardTitle>
                  <ShieldCheck className="size-4 text-muted-foreground" aria-hidden />
                </div>
                <CardDescription>Updated just now</CardDescription>
              </CardHeader>
              <CardContent>
                <SecurityStateBadge state="SETUP_REQUIRED" />
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle>Setup progress</CardTitle>
                  <Clock3 className="size-4 text-muted-foreground" aria-hidden />
                </div>
                <CardDescription>2 of 4 steps done</CardDescription>
              </CardHeader>
              <CardContent>
                <Progress value={50} />
              </CardContent>
            </Card>
          </div>
        </Section>

        <Section title="Tabs">
          <Tabs defaultValue="all">
            <TabsList>
              <TabsTrigger value="all">All</TabsTrigger>
              <TabsTrigger value="new">New</TabsTrigger>
              <TabsTrigger value="reviewed">Reviewed</TabsTrigger>
            </TabsList>
            <TabsContent value="all">
              <p className="text-sm text-muted-foreground">All alerts would be listed here.</p>
            </TabsContent>
            <TabsContent value="new">
              <p className="text-sm text-muted-foreground">Only new alerts.</p>
            </TabsContent>
            <TabsContent value="reviewed">
              <p className="text-sm text-muted-foreground">Only reviewed alerts.</p>
            </TabsContent>
          </Tabs>
        </Section>

        <Section title="States">
          <LoadingState />
          <EmptyState
            icon={<Bell className="size-6" aria-hidden />}
            title="No alerts yet"
            hint="Alerts appear here when suspicious activity is detected near your shutter."
            action={<Button variant="outline">Check camera</Button>}
          />
          <ErrorState message="Could not load alerts." requestId="req_abc123" onRetry={() => undefined} />
          <div className="space-y-2">
            <Alert tone="success">Schedule saved.</Alert>
            <Alert tone="info">Push integration pending.</Alert>
            <Alert tone="warning">Camera is degraded.</Alert>
            <Alert tone="danger">Could not reach the server.</Alert>
          </div>
          <div className="space-y-2">
            <Skeleton className="h-4 w-1/2" />
            <Skeleton className="h-4 w-1/3" />
          </div>
        </Section>

        <Section title="Dialog and toasts">
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => setOpen(true)}>
              Open dialog
            </Button>
            <Button variant="outline" onClick={() => toast.error("Could not save. Try again.")}>
              Error toast
            </Button>
            <Button variant="outline" onClick={() => toast("Camera test queued")}>
              <Camera aria-hidden /> Info toast
            </Button>
          </div>
          <Modal
            open={open}
            title="Confirm override"
            description="This changes the armed state temporarily and is audit logged."
            onClose={() => setOpen(false)}
            footer={
              <>
                <Button variant="outline" onClick={() => setOpen(false)}>
                  Cancel
                </Button>
                <Button onClick={() => setOpen(false)}>Confirm</Button>
              </>
            }
          />
        </Section>
      </div>
    </div>
  );
}
