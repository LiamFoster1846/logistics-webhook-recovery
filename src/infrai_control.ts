import { setTimeout as delay } from "node:timers/promises";

type InfraiEnvelope<T> = {
  ok: boolean;
  data?: T;
  error?: { code?: string; message?: string; [key: string]: unknown };
  metadata?: unknown;
};

export class InfraiError extends Error {
  readonly status: number;
  readonly detail: InfraiEnvelope<never>["error"];

  constructor(
    status: number,
    detail: InfraiEnvelope<never>["error"],
  ) {
    super(detail?.message ?? detail?.code ?? "Infrai request was rejected");
    this.name = "InfraiError";
    this.status = status;
    this.detail = detail;
  }
}

export class InfraiControl {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly fetcher: typeof fetch;

  constructor(
    apiKey: string,
    baseUrl: string,
    fetcher: typeof fetch = fetch,
  ) {
    this.apiKey = apiKey;
    this.baseUrl = baseUrl;
    this.fetcher = fetcher;
  }

  async deliveryHistory(webhookId: string): Promise<unknown> {
    return this.request("GET", `/v1/account/webhooks/deliveries/${encodeURIComponent(webhookId)}`);
  }

  async redriveDeadLetters(queue: string, operationId: string): Promise<unknown> {
    return this.request("POST", `/v1/queue/dlq/redrive/${encodeURIComponent(queue)}`, undefined, operationId);
  }

  private async request<T>(method: "GET" | "POST", path: string, body?: unknown, operationId?: string): Promise<T> {
    for (let attempt = 0; attempt < 4; attempt += 1) {
      let response: Response;
      try {
        response = await this.fetcher(`${this.baseUrl}${path}`, {
          method,
          headers: {
            Authorization: `Bearer ${this.apiKey}`,
            Accept: "application/json",
            ...(body === undefined ? {} : { "Content-Type": "application/json" }),
            ...(operationId ? { "Idempotency-Key": operationId } : {}),
          },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        });
      } catch (cause) {
        throw new Error("Could not reach Infrai", { cause });
      }

      let envelope: InfraiEnvelope<T>;
      try {
        envelope = (await response.json()) as InfraiEnvelope<T>;
      } catch (cause) {
        throw new Error(`Infrai returned a non-JSON response with HTTP ${response.status}`, { cause });
      }

      if (response.status === 429 && attempt < 3) {
        const retryAfter = Number(response.headers.get("retry-after"));
        const waitMs = Number.isFinite(retryAfter) && retryAfter >= 0
          ? retryAfter * 1_000
          : 250 * 2 ** attempt;
        await delay(waitMs);
        continue;
      }
      if (!envelope.ok) throw new InfraiError(response.status, envelope.error);
      if (response.status >= 500) throw new Error(`Unexpected Infrai HTTP response: ${response.status}`);
      return envelope.data as T;
    }
    throw new Error("Infrai retry budget exhausted");
  }
}
