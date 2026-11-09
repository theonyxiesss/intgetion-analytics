import { describe, expect, it } from "vitest";
import {
  dailyVisitorKey,
  deviceOf,
  isBot,
  jobIdOf,
  localeOf,
  normalizePath,
  referrerHost,
  searchOf,
  utmOf,
} from "../lib/events";

const chrome =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Safari/537.36";
const iphone =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148";

describe("analytics events (D225)", () => {
  it("drops crawlers, previews, headless browsers and scripts", () => {
    expect(isBot(chrome)).toBe(false);
    expect(isBot("Googlebot/2.1")).toBe(true);
    expect(isBot("TelegramBot (like TwitterBot)")).toBe(true);
    expect(isBot(`${chrome} HeadlessChrome`)).toBe(true);
    expect(isBot("curl/8.4.0")).toBe(true);
    expect(isBot(null)).toBe(true);
  });

  it("keeps only a coarse device class", () => {
    expect(deviceOf(chrome)).toBe("desktop");
    expect(deviceOf(iphone)).toBe("mobile");
    expect(deviceOf("Mozilla/5.0 (iPad; CPU OS 18_0)")).toBe("tablet");
  });

  it("normalizes paths of this site only", () => {
    expect(normalizePath("/en/jobs/?q=go#x")).toBe("/en/jobs");
    expect(normalizePath("//evil.example/x")).toBeNull();
    expect(normalizePath("https://evil.example/x")).toBeNull();
    expect(normalizePath("/")).toBe("/");
    expect(localeOf("/ru/jobs")).toBe("ru");
    expect(localeOf("/api/a")).toBeNull();
  });

  it("recognizes job pages and searches", () => {
    const id = "0b6f6f3e-5d1c-4a8e-9a37-1b2c3d4e5f60";
    expect(jobIdOf(`/en/jobs/${id}`)).toBe(id);
    expect(jobIdOf("/en/jobs/t/web3")).toBeNull();
    expect(
      searchOf("/en/jobs", "?q=  Rust   Engineer &workFormat=remote"),
    ).toEqual({
      term: "rust engineer",
      filters: ["workFormat"],
    });
    expect(searchOf("/en/jobs/t/web3", "?seniority=senior")).toEqual({
      term: null,
      filters: ["seniority"],
    });
    expect(searchOf("/en/jobs", "")).toBeNull();
    expect(searchOf("/en/jobs", "?cursor=abc")).toBeNull();
    expect(searchOf("/en/matches", "?q=go")).toBeNull();
  });

  it("keeps the referrer host only when it is another site", () => {
    expect(
      referrerHost("https://www.google.com/search?q=x", "intgetion.com"),
    ).toBe("google.com");
    expect(
      referrerHost("https://intgetion.com/en", "intgetion.com"),
    ).toBeNull();
    expect(referrerHost("not a url", "intgetion.com")).toBeNull();
    expect(utmOf("?utm_source=telegram&utm_campaign=launch")).toEqual({
      source: "telegram",
      campaign: "launch",
    });
  });

  it("gives a daily visitor key that changes with the day", () => {
    const input = { secret: "s", ip: "203.0.113.5", userAgent: chrome };
    const monday = dailyVisitorKey({ ...input, day: "2026-10-05" });
    expect(dailyVisitorKey({ ...input, day: "2026-10-05" })).toBe(monday);
    expect(dailyVisitorKey({ ...input, day: "2026-10-06" })).not.toBe(monday);
    expect(monday).not.toContain("203.0.113.5");
    expect(monday).toHaveLength(32);
  });
});
