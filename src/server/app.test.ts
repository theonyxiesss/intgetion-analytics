import { describe, expect, it, vi } from "vitest";
import { createApp } from "./app";
import { httpAnalyticsPorts } from "./remote-ports";

const token = "test-token";
const app = createApp({ serviceToken: token });
const auth = { authorization: `Bearer ${token}` };
const call = (path: string, init: RequestInit = {}) => app(new Request(`http://analytics${path}`, init));

describe("analytics http", () => {
  it("serves health without a token and refuses a missing one", async () => {
    expect((await call("/health")).status).toBe(200);
    expect((await call("/v1/reports/traffic")).status).toBe(401);
  });
  it("rejects bad input before any write", async () => {
    expect((await call("/v1/forget", { method: "POST", headers: auth, body: JSON.stringify({ visitorId: "x" }) })).status).toBe(400);
    expect((await call("/v1/events/page-view", { method: "POST", headers: auth, body: JSON.stringify({}) })).status).toBe(400);
    expect((await call("/v1/events/server", { method: "POST", headers: auth, body: JSON.stringify({ name: "buy" }) })).status).toBe(400);
    expect((await call("/v1/reports/traffic?days=999", { headers: auth })).status).toBe(400);
  });
  it("answers 404 for a bad job id, 503 without Telegram, 404 for unknown routes", async () => {
    expect((await call("/v1/jobs/nope/views", { headers: auth })).status).toBe(404);
    const digest = await call("/v1/tasks/visitor-digest", { method: "POST", headers: auth, body: JSON.stringify({ recipients: [] }) });
    expect(digest.status).toBe(503);
    expect((await call("/v1/nothing", { headers: auth })).status).toBe(404);
  });
});

describe("remote ports", () => {
  it("counts a hit through the platform", async () => {
    const fetchImpl = vi.fn(async (_url: string | URL | Request) => Response.json({ result: 2 }));
    const ports = httpAnalyticsPorts({ platform: { url: "http://p/", token: "t" }, fetchImpl: fetchImpl as typeof fetch });
    expect(await ports.rateHit("visitorDigest", "w", new Date("2030-01-01T00:00:00Z"))).toBe(2);
    expect(String(fetchImpl.mock.calls[0]?.[0])).toBe("http://p/api/internal/analytics/rate-hit");
  });
});
