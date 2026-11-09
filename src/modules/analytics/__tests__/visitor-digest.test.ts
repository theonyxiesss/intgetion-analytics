import { beforeEach, describe, expect, it, vi } from "vitest";

const readNewVisitors = vi.fn();
const hit = vi.fn();

vi.mock("../repo/analytics-repo", () => ({
  readNewVisitors: (...args: unknown[]) => readNewVisitors(...args),
}));

import {
  DIGEST_MAX_LINES,
  digestWindow,
  runVisitorDigest,
  visitorDigestText,
} from "../service/visitor-digest";
import { setAnalyticsPorts } from "../../../ports";

// The platform rate limiter, as a port (the digest goes out once a day).
setAnalyticsPorts({ rateHit: (...args: unknown[]) => hit(...args) as Promise<number> });
import type { NewVisitorRow } from "../repo/analytics-repo";

const now = new Date("2026-11-04T15:03:00Z");
const row = (over: Partial<NewVisitorRow> = {}): NewVisitorRow => ({
  occurredAt: "14:12",
  path: "/jobs",
  country: "DE",
  device: "desktop",
  referrerHost: "www.google.com",
  utmSource: null,
  ...over,
});

beforeEach(() => {
  vi.stubEnv("PRIVACY_HASH_SECRET", "test-secret");
  readNewVisitors.mockReset();
  hit.mockReset();
});

describe("visitor digest window (D607)", () => {
  it("is the last full UTC hour", () => {
    const { from, to } = digestWindow(now);
    expect(from.toISOString()).toBe("2026-11-04T14:00:00.000Z");
    expect(to.toISOString()).toBe("2026-11-04T15:00:00.000Z");
  });
});

describe("visitor digest text (D607)", () => {
  it("shows count, country, source, page and device, no person", () => {
    const text = visitorDigestText("en", digestWindow(now), [
      row(),
      row({
        occurredAt: "14:40",
        country: null,
        referrerHost: null,
        device: "mobile",
        path: "/ru/services",
      }),
      row({ utmSource: "telegram", referrerHost: "t.me" }),
    ]);
    const lines = text.split("\n");
    expect(lines[0]).toBe("New visitors 14:00–15:00 UTC: 3");
    expect(lines[2]).toBe(
      "14:12 · 🇩🇪 Germany · www.google.com · /jobs · Computer",
    );
    expect(lines[3]).toBe("14:40 · Unknown · direct · /ru/services · Phone");
    expect(lines[4]).toContain(" · telegram · ");
  });

  it("speaks the recipient's language", () => {
    const text = visitorDigestText("ru", digestWindow(now), [row()]);
    expect(text.split("\n")[0]).toBe("Новые посетители 14:00–15:00 UTC: 1");
    expect(text).toContain("Германия");
  });

  it("cuts a busy hour to one message with an 'and N more' line", () => {
    const rows = Array.from({ length: DIGEST_MAX_LINES + 5 }, () => row());
    const lines = visitorDigestText("en", digestWindow(now), rows).split("\n");
    expect(lines).toHaveLength(2 + DIGEST_MAX_LINES + 1);
    expect(lines.at(-1)).toBe("…and 5 more");
  });
});

describe("runVisitorDigest (D607)", () => {
  const recipients = [{ chatId: 42, locale: "en" }];

  it("sends nothing without recipients and does not read the events", async () => {
    const sender = vi.fn();
    const result = await runVisitorDigest({ sender, recipients: [], now });
    expect(result.skipped).toBe("no_recipients");
    expect(readNewVisitors).not.toHaveBeenCalled();
    expect(sender).not.toHaveBeenCalled();
  });

  it("sends nothing for an hour without new visitors", async () => {
    readNewVisitors.mockResolvedValue([]);
    const sender = vi.fn();
    const result = await runVisitorDigest({ sender, recipients, now });
    expect(result).toEqual({ visitors: 0, sent: 0 });
    expect(hit).not.toHaveBeenCalled();
    expect(sender).not.toHaveBeenCalled();
  });

  it("sends the hour once to every recipient", async () => {
    readNewVisitors.mockResolvedValue([row(), row()]);
    hit.mockResolvedValue(1);
    const sender = vi.fn().mockResolvedValue("sent");
    const result = await runVisitorDigest({
      sender,
      recipients: [...recipients, { chatId: 7, locale: "ru" }],
      now,
    });
    expect(result).toEqual({ visitors: 2, sent: 2 });
    expect(readNewVisitors).toHaveBeenCalledWith(
      new Date("2026-11-04T14:00:00Z"),
      new Date("2026-11-04T15:00:00Z"),
    );
    expect(hit.mock.calls[0]?.[0]).toBe("visitorDigest");
    expect(sender).toHaveBeenCalledWith(
      42,
      expect.stringContaining("New visitors"),
    );
    expect(sender).toHaveBeenCalledWith(
      7,
      expect.stringContaining("Новые посетители"),
    );
  });

  it("does not send the same hour again on the next cron run", async () => {
    readNewVisitors.mockResolvedValue([row()]);
    hit.mockResolvedValue(2);
    const sender = vi.fn();
    const result = await runVisitorDigest({ sender, recipients, now });
    expect(result.skipped).toBe("already_sent");
    expect(sender).not.toHaveBeenCalled();
  });
});
