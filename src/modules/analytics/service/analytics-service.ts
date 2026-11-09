import { countryFromHeader } from "../../../lib/country";
import { consentAllows, readConsent, readCookie } from "../../../lib/consent";
import { logger } from "@intgetion/kit";
import { clientIp } from "../../../lib/request-ip";
import {
  EVENT_RETENTION_DAYS,
  VISITOR_COOKIE,
  dailyVisitorKey,
  deviceOf,
  isBot,
  jobIdOf,
  localeOf,
  normalizePath,
  referrerHost,
  searchOf,
  utmOf,
  type EventName,
} from "../lib/events";
import * as repo from "../repo/analytics-repo";
import type { BeaconInput } from "../schemas";
import {
  CHANNELS,
  channelOf,
  searchEngineOf,
  type Channel,
} from "../lib/channel";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * Who is asking, as far as analytics may know (D225, D226): the daily key
 * for everybody, the `_ia` id only while the consent cookie allows
 * analytics and the browser does not send Global Privacy Control.
 */
function visitorOf(request: Request, now: Date) {
  const userAgent = request.headers.get("user-agent") ?? "";
  const cookies = request.headers.get("cookie");
  const gpc = request.headers.get("sec-gpc") === "1";
  const allowed = consentAllows(readConsent(cookies), "analytics", { gpc });
  const cookieId = readCookie(cookies, VISITOR_COOKIE);
  return {
    bot: isBot(userAgent),
    device: deviceOf(userAgent),
    // Country only, never the IP or the city (D607).
    country: countryFromHeader(request.headers.get("x-vercel-ip-country")),
    dayVisitor: dailyVisitorKey({
      secret: process.env.PRIVACY_HASH_SECRET ?? "",
      day: now.toISOString().slice(0, 10),
      ip: clientIp(request.headers),
      userAgent,
    }),
    visitorId: allowed && cookieId && UUID.test(cookieId) ? cookieId : null,
  };
}

function siteHost(): string {
  try {
    return new URL(process.env.NEXT_PUBLIC_SITE_URL ?? "").hostname;
  } catch {
    return "";
  }
}

/**
 * One page view from the browser beacon, plus the job view or search it
 * implies. Bots and paths outside the site are dropped silently.
 */
export async function trackPageView(
  request: Request,
  input: BeaconInput,
  now = new Date(),
): Promise<number> {
  const visitor = visitorOf(request, now);
  const path = normalizePath(input.path);
  if (visitor.bot || !path) return 0;
  const base = {
    path,
    locale: localeOf(path),
    jobId: null,
    searchTerm: null,
    searchFilters: null,
    referrerHost: referrerHost(input.referrer, siteHost()),
    utm: utmOf(input.search),
    device: visitor.device,
    country: visitor.country,
    dayVisitor: visitor.dayVisitor,
    visitorId: visitor.visitorId,
    occurredAt: now,
  };
  const rows: repo.EventRow[] = [{ ...base, name: "page_view" }];
  const jobId = jobIdOf(path);
  if (jobId) rows.push({ ...base, name: "job_view", jobId });
  const search = searchOf(path, input.search);
  if (search) {
    rows.push({
      ...base,
      name: "search",
      searchTerm: search.term,
      searchFilters: search.filters,
    });
  }
  await repo.insertEvents(rows);
  return rows.length;
}

/**
 * A step of the funnel recorded by the server (registration, application).
 * Never fails the request it rides on.
 */
export async function trackServerEvent(
  request: Request,
  name: Extract<EventName, "signup" | "apply">,
  now = new Date(),
): Promise<void> {
  try {
    const visitor = visitorOf(request, now);
    if (visitor.bot) return;
    const referer = request.headers.get("referer");
    const path =
      normalizePath(referer ? new URL(referer).pathname : "/") ?? "/";
    await repo.insertEvents([
      {
        name,
        path,
        locale: localeOf(path),
        jobId: null,
        searchTerm: null,
        searchFilters: null,
        referrerHost: null,
        utm: {},
        device: visitor.device,
        country: visitor.country,
        dayVisitor: visitor.dayVisitor,
        visitorId: visitor.visitorId,
        occurredAt: now,
      },
    ]);
  } catch (error) {
    logger.warn({ err: error, event: name }, "analytics event dropped");
  }
}

/** Withdrawn consent: the visitor's past events keep no id (D226). */
export async function forgetVisitor(visitorId: string): Promise<number> {
  return UUID.test(visitorId) ? repo.forgetVisitor(visitorId) : 0;
}

export async function purgeAnalytics(now = new Date()): Promise<number> {
  return repo.purgeEvents(
    new Date(now.getTime() - EVENT_RETENTION_DAYS * 24 * 60 * 60 * 1000),
  );
}

export async function analyticsReport(days: number, now = new Date()) {
  return repo.readReport(new Date(now.getTime() - days * 24 * 60 * 60 * 1000));
}

/** One job's views for its employer, last `days` days (D232). */
export async function jobViews(jobId: string, days: number, now = new Date()) {
  return repo.readJobViews(
    jobId,
    new Date(now.getTime() - days * 24 * 60 * 60 * 1000),
  );
}

/**
 * Where visits come from, and how search traffic moves day by day (D293).
 * Everything is counted from events we already store; nothing new is logged.
 */
export async function trafficReport(days: number, now = new Date()) {
  const since = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
  // One after the other on the pooled connection (D247).
  const sources = await repo.readTrafficSources(since);
  const landings = await repo.readLandingPages(since);

  const byChannel = new Map<Channel, number>();
  const byEngine = new Map<string, number>();
  const byDay = new Map<string, { search: number; total: number }>();
  for (const row of sources) {
    const channel = channelOf(row);
    byChannel.set(channel, (byChannel.get(channel) ?? 0) + row.visitors);
    const day = byDay.get(row.day) ?? { search: 0, total: 0 };
    day.total += row.visitors;
    if (channel === "search") {
      day.search += row.visitors;
      const engine =
        searchEngineOf(row.referrerHost) ??
        searchEngineOf(row.utmSource) ??
        "other";
      byEngine.set(engine, (byEngine.get(engine) ?? 0) + row.visitors);
    }
    byDay.set(row.day, day);
  }

  const byLanding = new Map<string, number>();
  for (const row of landings) {
    if (channelOf(row) !== "search") continue;
    byLanding.set(row.path, (byLanding.get(row.path) ?? 0) + row.visitors);
  }

  const descending = (a: { count: number }, b: { count: number }) =>
    b.count - a.count;
  return {
    channels: CHANNELS.map((channel) => ({
      channel,
      count: byChannel.get(channel) ?? 0,
    })),
    engines: [...byEngine]
      .map(([label, count]) => ({ label, count }))
      .sort(descending),
    daily: [...byDay]
      .map(([day, counts]) => ({ day, ...counts }))
      .sort((a, b) => a.day.localeCompare(b.day)),
    landings: [...byLanding]
      .map(([label, count]) => ({ label, count }))
      .sort(descending)
      .slice(0, 10),
  };
}

export type TrafficReport = Awaited<ReturnType<typeof trafficReport>>;
