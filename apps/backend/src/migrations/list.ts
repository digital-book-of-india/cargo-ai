import type { Migration } from "./types";
import { createIndexes } from "./20261026-001-create-indexes";
import { createShipmentIndexes } from "./20261026-003-create-shipment-indexes";
import { createVisionIndexes } from "./20261026-004-create-vision-indexes";
import { archiveLegacyCollections } from "./20261026-002-archive-legacy-collections";

// Order matters: migrations run top to bottom and roll back bottom to top.
export const migrations: Migration[] = [createIndexes, archiveLegacyCollections, createShipmentIndexes, createVisionIndexes];
