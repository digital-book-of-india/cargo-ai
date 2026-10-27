import type { Migration } from "./types";
import { createIndexes } from "./20261026-001-create-indexes";
import { createShipmentIndexes } from "./20261026-003-create-shipment-indexes";
import { createVisionIndexes } from "./20261026-004-create-vision-indexes";
import { archiveLegacyCollections } from "./20261026-002-archive-legacy-collections";
import { sessionsOnVisionZones } from "./20261101-101-sessions-on-vision-zones";
import { addQueryIndexes } from "./20261101-102-query-indexes";
import { notificationEventIdAsObjectId } from "./20261101-103-notification-event-id";
import { uniqueCameraNames } from "./20261101-104-unique-camera-names";
import { cameraSecretsGcm } from "./20261101-105-camera-secrets-gcm";
import { archiveOldZones } from "./20261101-106-archive-old-zones";

// Order matters: migrations run top to bottom and roll back bottom to top.
export const migrations: Migration[] = [createIndexes, archiveLegacyCollections, createShipmentIndexes, createVisionIndexes, sessionsOnVisionZones, addQueryIndexes, notificationEventIdAsObjectId, uniqueCameraNames, cameraSecretsGcm, archiveOldZones];
