import assert from "node:assert/strict";
import test from "node:test";
import { replayRequest, selectReplayEvents } from "../src/shipment_replay.js";

test("replays only missed events once and in occurrence order", () => {
  const shared = { shipmentId: "SHP-42" };
  const input = replayRequest.parse({
    webhookId: "wh_logistics",
    destinationUrl: "https://logistics.example/webhooks/infrai",
    dlqQueue: "shipment-events",
    redrivePerSecond: 4,
    redriveCalls: 2,
    missedAfter: "2026-09-30T10:00:00.000Z",
    events: [
      { ...shared, eventId: "evt-proof", type: "shipment.proof_recorded", occurredAt: "2026-09-30T10:03:00.000Z", proof: { objectKey: "pod/SHP-42.jpg", contentType: "image/jpeg", sha256: "a".repeat(64) } },
      { ...shared, eventId: "evt-old", type: "shipment.status_updated", occurredAt: "2026-09-30T09:59:00.000Z", status: "in_transit" },
      { ...shared, eventId: "evt-exception", type: "shipment.exception_opened", occurredAt: "2026-09-30T10:01:00.000Z", reason: "recipient unavailable" },
      { ...shared, eventId: "evt-exception", type: "shipment.exception_opened", occurredAt: "2026-09-30T10:01:00.000Z", reason: "recipient unavailable" },
    ],
  });

  assert.deepEqual(selectReplayEvents(input).map((event) => event.eventId), ["evt-exception", "evt-proof"]);
});
