import { createHmac } from "node:crypto";

/**
 * Own analytics (D225): what a page view says about the visit, computed on
 * the server from the path the browser reports. Nothing here identifies a
 * person: no IP, no full user agent, no query values except a search term.
 */

export const EVENT_NAMES = [
  "page_view",
  "job_view",
  "search",
  "signup",
  "apply",
] as const;
export type EventName = (typeof EVENT_NAMES)[number];

export type Device = "mobile" | "tablet" | "desktop";

const LOCALE_PATH = /^\/(en|ru)(?=\/|$)/;
// D335: English pages have no prefix.
const JOB_PATH = /^(?:\/(?:en|ru))?\/jobs\/([0-9a-f-]{36})$/;
const CATALOG_PATH = /^(?:\/(?:en|ru))?\/jobs(?:\/t\/[\w-]+)?$/;
const BOT_AGENT =
  /bot|crawl|spider|slurp|preview|fetch|headless|lighthouse|monitor|curl|wget|python|axios|node-fetch/i;

/** Crawlers, link previews, uptime checks and scripts are not visitors. */
export function isBot(userAgent: string | null | undefined): boolean {
  return !userAgent || BOT_AGENT.test(userAgent);
}

export function deviceOf(userAgent: string | null | undefined): Device {
  const agent = userAgent ?? "";
  if (/ipad|tablet/i.test(agent)) return "tablet";
  if (/mobi|iphone|android/i.test(agent)) return "mobile";
  return "desktop";
}

/** Only paths of this site, without query or fragment, at most 200 chars. */
export function normalizePath(path: string): string | null {
  if (!path.startsWith("/") || path.startsWith("//")) return null;
  const clean = path.split(/[?#]/)[0]!.replace(/\/+$/, "") || "/";
  return clean.slice(0, 200);
}

/** A site path without a prefix is English (D335). */
export function localeOf(path: string): string | null {
  if (!path.startsWith("/") || path.startsWith("/api/")) return null;
  return LOCALE_PATH.exec(path)?.[1] ?? "en";
}

export function jobIdOf(path: string): string | null {
  return JOB_PATH.exec(path)?.[1] ?? null;
}

/**
 * A catalog view with a text query or filters is a search. The term is
 * lowercased and cut to 60 chars; filters are kept as names only.
 */
export function searchOf(
  path: string,
  search: string,
): { term: string | null; filters: string[] } | null {
  if (!CATALOG_PATH.test(path)) return null;
  const params = new URLSearchParams(search);
  const term =
    params.get("q")?.trim().toLowerCase().replace(/\s+/g, " ").slice(0, 60) ||
    null;
  const filters = [...new Set(params.keys())]
    .filter((key) => key !== "q" && key !== "cursor")
    .sort()
    .slice(0, 12);
  if (!term && filters.length === 0) return null;
  return { term, filters };
}

/** Host of an external referrer; our own site and junk give null. */
export function referrerHost(
  referrer: string | null | undefined,
  siteHost: string,
): string | null {
  if (!referrer) return null;
  try {
    const host = new URL(referrer).hostname.replace(/^www\./, "");
    return host && host !== siteHost.replace(/^www\./, "")
      ? host.slice(0, 100)
      : null;
  } catch {
    return null;
  }
}

/** utm_source / utm_medium / utm_campaign, each at most 60 chars. */
export function utmOf(search: string): Record<string, string> {
  const params = new URLSearchParams(search);
  const utm: Record<string, string> = {};
  for (const key of ["source", "medium", "campaign"]) {
    const value = params.get(`utm_${key}`)?.trim().slice(0, 60);
    if (value) utm[key] = value;
  }
  return utm;
}

/**
 * Cookieless daily visitor key (D225): HMAC of day + IP + user agent with
 * the server secret. It counts unique visitors per day and cannot be
 * reversed or linked across days; the inputs are never stored.
 */
export function dailyVisitorKey(input: {
  secret: string;
  day: string;
  ip: string;
  userAgent: string;
}): string {
  return createHmac("sha256", input.secret)
    .update(`${input.day}|${input.ip}|${input.userAgent}`)
    .digest("hex")
    .slice(0, 32);
}

/** Visitor cookie set only with analytics consent (D226). */
export const VISITOR_COOKIE = "_ia";
/** 13 months, the longest the CNIL accepts for an analytics cookie. */
export const VISITOR_MAX_AGE_SECONDS = 395 * 24 * 60 * 60;
/** Raw events are kept as long as the visitor cookie lives (D227). */
export const EVENT_RETENTION_DAYS = 395;
