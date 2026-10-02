import { z } from "zod";

const baseEvent = z.object({
  eventId: z.string().min(1),
  shipmentId: z.string().min(1),
  occurredAt: z.string().datetime(),
});

const shipmentEvent = z.discriminatedUnion("type", [
  baseEvent.extend({ type: z.literal("shipment.status_updated"), status: z.enum(["picked_up", "in_transit", "delivered"]) }),
  baseEvent.extend({
    type: z.literal("shipment.proof_recorded"),
    proof: z.object({ objectKey: z.string().min(1), contentType: z.string().min(1), sha256: z.string().regex(/^[a-f0-9]{64}$/) }),
  }),
  baseEvent.extend({ type: z.literal("shipment.exception_opened"), reason: z.string().min(1) }),
  baseEvent.extend({ type: z.literal("shipment.exception_resolved"), resolution: z.string().min(1) }),
]);

export const replayRequest = z.object({
  webhookId: z.string().min(1),
  destinationUrl: z.string().url(),
  dlqQueue: z.string().min(1),
  redrivePerSecond: z.number().int().min(1).max(20),
  redriveCalls: z.number().int().min(1).max(100),
  missedAfter: z.string().datetime(),
  events: z.array(shipmentEvent).max(500),
});

export type ReplayRequest = z.infer<typeof replayRequest>;
export type ShipmentEvent = ReplayRequest["events"][number];

export function selectReplayEvents(input: ReplayRequest): ShipmentEvent[] {
  const boundary = Date.parse(input.missedAfter);
  const unique = new Map<string, ShipmentEvent>();
  for (const event of input.events) {
    if (Date.parse(event.occurredAt) >= boundary && !unique.has(event.eventId)) unique.set(event.eventId, event);
  }
  return [...unique.values()].sort((left, right) =>
    Date.parse(left.occurredAt) - Date.parse(right.occurredAt) || left.eventId.localeCompare(right.eventId),
  );
}
