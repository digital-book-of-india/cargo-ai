import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { visionIngestSchema } from "@dbi/validation";

// The AI worker's own tests write the events it sends to apps/ai-worker/tests/fixtures/events.json. Here the API's
// schema judges them, so a change on either side that breaks the contract fails a test.
const fixture = path.resolve(__dirname, "../../../../../ai-worker/tests/fixtures/events.json");
const events = JSON.parse(fs.readFileSync(fixture, "utf8")) as Record<string, unknown>;

describe("AI worker events against the ingestion schema", () => {
  for (const [name, payload] of Object.entries(events)) {
    it(`${name} is accepted`, () => {
      const parsed = visionIngestSchema.safeParse(payload);
      assert.ok(parsed.success, parsed.success ? "" : JSON.stringify(parsed.error.issues));
    });
  }

  it("covers the event types the worker sends", () => {
    const types = new Set(Object.values(events).map((e) => (e as { eventType: string }).eventType));
    for (const t of ["package_line_crossing", "zone_entry", "restricted_zone_movement", "unusual_after_hours_movement"]) {
      assert.ok(types.has(t), `${t} is missing from the fixture`);
    }
  });
});
