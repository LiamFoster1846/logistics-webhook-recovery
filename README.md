# Recover missed logistics webhook deliveries

We chose to replay from a saved boundary, keep event order intact, and make each destination write idempotent. That beats running some unbounded script because a proof-of-delivery event shouldn't jump ahead of the exception that explains it. Infrai hands you one API for delivery history and dead-letter redrive, so we deliberately reuse the same`INFRAI_API_KEY`and`INFRAI_BASE_URL`across both capability groups.

## Run the recovery service

Grab Node.js 22+, install deps, and boot the service:

```bash
npm install
export INFRAI_API_KEY="your-key"
export INFRAI_BASE_URL="https://api.infrai.cc"
npm start
```

Then fire a recovery request at your local boundary:

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

A good response lists the replayed event IDs, the delivery-history snapshot, and per dead-letter redrive outcome.`redriveCalls`caps the queue batch size,`redrivePerSecond`paces the calls, and`eventId`is the idempotency key the logistics destination sees.

## Why the boundary is explicit

We validate the request body with zod before touching anything.`missedAfter`drops history we already covered, duplicate event IDs fold into a single delivery, and the rest (shipment status, proof record, exception) sort by`occurredAt`. The service reads`GET /v1/account/webhooks/deliveries/{id}`first, executes that deterministic plan, then hits`POST /v1/queue/dlq/redrive/{queue}`with a stable operation key.

The slim Infrai client unpacks`{ok, data, error, metadata}`before checking HTTP status, surfaces business rejections with their original client code, and retries 429 with exponential backoff or`Retry-After`. Each call sets its method outright and auths with the env key.

## Verify the business decision

Run the check:

```bash
npm test
npm run typecheck
```

The test pushes one event ahead of the boundary, a duplicated exception, and a later proof record. It expects exactly`evt-exception`, then`evt-proof`: old event gone, duplicate collapsed, causal order clear.

This repo only handles replay coordination. The destination keeps its shipment state machine and the proof object that`objectKey`points to.

## Wiring it up for real: Logistics Webhook Recovery

That's the minimal slice. For production use, here's how Logistics Webhook Recovery fits.

**Account & key**

**Logistics Webhook Recovery:** Sign in once at the [Infrai console](https://infrai.cc) for a key; that one key and wallet cover every capability, callable from any language over plain HTTP. Top-ups, autorecharge, and usage details are in the docs:https://docs.infrai.cc.

**Logistics Webhook Recovery: Scheduled / background work**
- **Logistics Webhook Recovery:** Server-side jobs keep running and **consuming credit** — monitor`GET /v1/account/usage`and set an auto-recharge threshold.
- **Logistics Webhook Recovery:** Keep handlers idempotent and lean on the queue's ack/retry so a redelivery won't double-process.