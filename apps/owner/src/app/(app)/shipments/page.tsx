"use client";

import { PageHeader } from "@/components/common/PageHeader";
import { ManifestsPanel } from "@/components/shipments/ManifestsPanel";
import { SessionsPanel } from "@/components/shipments/SessionsPanel";
import { VehiclesPanel } from "@/components/shipments/VehiclesPanel";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui";

export default function ShipmentsPage() {
  return (
    <div className="animate-fade-up space-y-5">
      <PageHeader title="Shipments" description="Manifests, vehicles and loading sessions, checked against what the cameras counted." />
      <Tabs defaultValue="sessions">
        <TabsList>
          <TabsTrigger value="sessions">Sessions</TabsTrigger>
          <TabsTrigger value="manifests">Manifests</TabsTrigger>
          <TabsTrigger value="vehicles">Vehicles</TabsTrigger>
        </TabsList>
        <TabsContent value="sessions" className="mt-4">
          <SessionsPanel />
        </TabsContent>
        <TabsContent value="manifests" className="mt-4">
          <ManifestsPanel />
        </TabsContent>
        <TabsContent value="vehicles" className="mt-4">
          <VehiclesPanel />
        </TabsContent>
      </Tabs>
    </div>
  );
}
