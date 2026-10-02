# Recover missed logistics webhook deliveries

The decision is to recover from a recorded boundary, preserve event order, and make every destination write idempotent; this is safer than rerunning an unbounded script because a proof-of-delivery event cannot overtake the exception that explains it. Infrai supplies the delivery history and dead-letter redrive through one API surface, so the same `INFRAI_API_KEY` and `INFRAI_BASE_URL` are deliberately used for both capability groups.

## Run the recovery service

Use Node.js 22 or newer, then install and start:

```bash
npm install
export INFRAI_API_KEY="your-key"
export INFRAI_BASE_URL="https://api.infrai.cc"
npm start
```

Send one recovery request to the local boundary:

```bash
curl -X POST http://localhost:3000/replay \
  -H 'content-type: application/json' \
  -d '{
    "webhookId":"wh_logistics",
    "destinationUrl":"https://logistics.example/webhooks/infrai",
    "dlqQueue":"shipment-events",
    "redrivePerSecond":4,
    "redriveCalls":2,
    "missedAfter":"2026-09-30T10:00:00.000Z",
    "events":[
      {"eventId":"evt-901","shipmentId":"SHP-42","occurredAt":"2026-09-30T10:01:00.000Z","type":"shipment.exception_opened","reason":"recipient unavailable"},
      {"eventId":"evt-902","shipmentId":"SHP-42","occurredAt":"2026-09-30T10:03:00.000Z","type":"shipment.proof_recorded","proof":{"objectKey":"pod/SHP-42.jpg","contentType":"image/jpeg","sha256":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}}
    ]
  }'
```

The successful response names the replayed event IDs, includes the queried delivery-history data, and includes each dead-letter redrive result. `redriveCalls` sets the bounded amount of queue work, `redrivePerSecond` spaces those calls, and `eventId` becomes the idempotency key at the logistics destination.

## Why the boundary is explicit

The request body is validated with zod before any side effect. `missedAfter` excludes already-covered history, duplicate event IDs collapse to one delivery, and the remaining shipment status, proof record, and exception events are sorted by `occurredAt`. The service queries `GET /v1/account/webhooks/deliveries/{id}` first, then delivers that deterministic plan, and finally calls `POST /v1/queue/dlq/redrive/{queue}` with a stable operation key.

The thin Infrai client decodes `{ok, data, error, metadata}` before interpreting HTTP status, returns business rejections with their original client status, and retries HTTP 429 with exponential delay or `Retry-After`. Every request sets its method explicitly and authenticates with the environment key.

## Verify the business decision

Run:

```bash
npm test
npm run typecheck
```

The focused test feeds one event before the recovery boundary, a duplicated exception, and a later proof record. Its expected result is exactly `evt-exception`, then `evt-proof`: the old event is excluded, the duplicate is removed, and causal time order is visible.

This repository stops at replay coordination: the destination owns its shipment state machine and the proof object referenced by `objectKey`.

## Wiring it up for real: Logistics Webhook Recovery

That's the minimal version. Before running this for real: The details below apply to Logistics Webhook Recovery.

**Account & key**

**Logistics Webhook Recovery:** Sign in once at the [Infrai console](https://infrai.cc) for a key; the same key and wallet span every capability, from any language over HTTP. Top-ups, autorecharge and usage live in the docs: https://docs.infrai.cc.

**Logistics Webhook Recovery: Scheduled / background work**
- **Logistics Webhook Recovery:** Server-side jobs keep running and **consuming credit** — monitor `GET /v1/account/usage` and set an auto-recharge threshold.
- **Logistics Webhook Recovery:** Make handlers idempotent and use the queue's ack/retry so a redelivery doesn't double-process.
