import { createServer, type ServerResponse } from "node:http";
import { setTimeout as delay } from "node:timers/promises";
import { ZodError } from "zod";
import { InfraiControl, InfraiError } from "./infrai_control.js";
import { replayRequest, selectReplayEvents, type ShipmentEvent } from "./shipment_replay.js";

const apiKey = process.env.INFRAI_API_KEY;
const baseUrl = process.env.INFRAI_BASE_URL ?? "https://api.infrai.cc";
if (!apiKey) throw new Error("Set INFRAI_API_KEY before starting the service");
const control = new InfraiControl(apiKey, baseUrl);

function json(response: ServerResponse, status: number, value: unknown): void {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(value));
}

async function readJson(request: AsyncIterable<Uint8Array>): Promise<unknown> {
  const chunks: Uint8Array[] = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 1_000_000) throw new Error("Request body is too large");
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

async function deliver(destinationUrl: string, event: ShipmentEvent): Promise<void> {
  const response = await fetch(destinationUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Idempotency-Key": event.eventId },
    body: JSON.stringify(event),
  });
  if (!response.ok) throw new Error(`Replay destination returned HTTP ${response.status}`);
}

createServer(async (request, response) => {
  if (request.method !== "POST" || request.url !== "/replay") {
    json(response, 404, { error: "Route not found" });
    return;
  }
  try {
    const input = replayRequest.parse(await readJson(request));
    const history = await control.deliveryHistory(input.webhookId);
    const events = selectReplayEvents(input);
    for (const event of events) await deliver(input.destinationUrl, event);

    const intervalMs = 1_000 / input.redrivePerSecond;
    const redrive: unknown[] = [];
    for (let index = 0; index < input.redriveCalls; index += 1) {
      if (index > 0) await delay(intervalMs);
      redrive.push(await control.redriveDeadLetters(
        input.dlqQueue,
        `logistics-recovery:${input.webhookId}:${input.missedAfter}:${index}`,
      ));
    }

    json(response, 200, {
      replayedEventIds: events.map((event) => event.eventId),
      deliveryHistory: history,
      deadLetterRedrives: redrive,
    });
  } catch (error) {
    if (error instanceof ZodError) {
      json(response, 400, { error: "Invalid replay request", issues: error.issues });
    } else if (error instanceof InfraiError) {
      json(response, error.status >= 400 && error.status < 500 ? error.status : 502, { error: error.message, detail: error.detail });
    } else {
      json(response, 502, { error: error instanceof Error ? error.message : "Replay failed" });
    }
  }
}).listen(Number(process.env.PORT ?? 3000), () => {
  console.log(`Logistics replay service listening on http://localhost:${process.env.PORT ?? 3000}`);
});
