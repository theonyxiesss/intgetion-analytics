import { describe, expect, it } from "vitest";
import { channelOf, searchEngineOf } from "../lib/channel";

describe("searchEngineOf (D293)", () => {
  it("knows an engine by its host, in any country and with www", () => {
    expect(searchEngineOf("www.google.com")).toBe("google");
    expect(searchEngineOf("google.de")).toBe("google");
    expect(searchEngineOf("news.google.com")).toBe("google");
    expect(searchEngineOf("yandex.ru")).toBe("yandex");
    expect(searchEngineOf("ya.ru")).toBe("yandex");
    expect(searchEngineOf("duckduckgo.com")).toBe("duckduckgo");
  });

  it("does not mistake another site for an engine", () => {
    expect(searchEngineOf("t.me")).toBeNull();
    expect(searchEngineOf("intgetion.com")).toBeNull();
    expect(searchEngineOf(null)).toBeNull();
    expect(searchEngineOf("")).toBeNull();
  });
});

describe("channelOf (D293)", () => {
  it("calls a visit with no referrer direct", () => {
    expect(channelOf({ referrerHost: null })).toBe("direct");
  });

  it("separates search, messengers and other sites", () => {
    expect(channelOf({ referrerHost: "www.google.com" })).toBe("search");
    expect(channelOf({ referrerHost: "t.me" })).toBe("social");
    expect(channelOf({ referrerHost: "web.telegram.org" })).toBe("social");
    expect(channelOf({ referrerHost: "x.com" })).toBe("social");
    expect(channelOf({ referrerHost: "someblog.dev" })).toBe("referral");
  });

  it("believes our own campaign tag over the referrer", () => {
    expect(
      channelOf({ referrerHost: "someblog.dev", utmMedium: "organic" }),
    ).toBe("search");
    expect(channelOf({ referrerHost: null, utmSource: "telegram.org" })).toBe(
      "social",
    );
    expect(channelOf({ referrerHost: null, utmSource: "google" })).toBe(
      "search",
    );
  });

  it("counts a tagged link without a referrer as a referral, not direct", () => {
    expect(channelOf({ referrerHost: null, utmSource: "newsletter" })).toBe(
      "referral",
    );
  });

  it("is not thrown off by case or stray spaces", () => {
    expect(channelOf({ referrerHost: "  WWW.Yandex.RU " })).toBe("search");
    expect(channelOf({ referrerHost: null, utmMedium: " Social " })).toBe(
      "social",
    );
  });
});
