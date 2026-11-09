import { sql } from "drizzle-orm";
import { getDb } from "@intgetion/kit";
import type { Device, EventName } from "../lib/events";

export type EventRow = {
  name: EventName;
  path: string;
  locale: string | null;
  jobId: string | null;
  searchTerm: string | null;
  searchFilters: string[] | null;
  referrerHost: string | null;
  utm: Record<string, string>;
  device: Device;
  /** Two letters from the Vercel edge header, or null (D607). */
  country: string | null;
  dayVisitor: string;
  visitorId: string | null;
  occurredAt: Date;
};

export async function insertEvents(rows: readonly EventRow[]): Promise<void> {
  if (rows.length === 0) return;
  await getDb().execute(sql`
    insert into public.analytics_events (
      occurred_at, name, path, locale, job_id, search_term, search_filters,
      referrer_host, utm_source, utm_medium, utm_campaign, device,
      country, day_visitor, visitor_id
    ) values ${sql.join(
      rows.map(
        (row) => sql`(
          ${row.occurredAt.toISOString()}::timestamptz, ${row.name}, ${row.path},
          ${row.locale}, ${row.jobId}, ${row.searchTerm},
          ${row.searchFilters ? sql`${`{${row.searchFilters.join(",")}}`}::text[]` : null},
          ${row.referrerHost}, ${row.utm.source ?? null}, ${row.utm.medium ?? null},
          ${row.utm.campaign ?? null}, ${row.device}, ${row.country},
          ${row.dayVisitor}, ${row.visitorId}
        )`,
      ),
      sql`, `,
    )}
  `);
}

/** Withdrawn analytics consent: the visitor's events lose their id (D226). */
export async function forgetVisitor(visitorId: string): Promise<number> {
  const rows = await getDb().execute(sql`
    update public.analytics_events set visitor_id = null
    where visitor_id = ${visitorId}
    returning 1
  `);
  return (rows as unknown as unknown[]).length;
}

export async function purgeEvents(before: Date): Promise<number> {
  const rows = await getDb().execute(sql`
    delete from public.analytics_events
    where occurred_at < ${before.toISOString()}::timestamptz
    returning 1
  `);
  return (rows as unknown as unknown[]).length;
}

type Count = { label: string | null; count: number };

const top = (query: ReturnType<typeof sql>) =>
  getDb().execute<Count>(query) as unknown as Promise<Count[]>;

/** Everything the admin analytics page shows, for one period (D227). */
export async function readReport(since: Date) {
  const from = since.toISOString();
  const db = getDb();
  const [totals] = await db.execute<{
    visitors: number;
    views: number;
    consented: number;
    returning: number;
  }>(sql`
    with period as (
      select * from public.analytics_events
      where occurred_at >= ${from}::timestamptz
    ),
    known as (
      select visitor_id, count(distinct date_trunc('day', occurred_at)) as days
      from period where visitor_id is not null group by visitor_id
    )
    select
      (select count(*)::int from (
        select distinct date_trunc('day', occurred_at), day_visitor from period
      ) daily) as visitors,
      (select count(*)::int from period where name = 'page_view') as views,
      (select count(*)::int from known) as consented,
      (select count(*)::int from known where days > 1) as returning
  `);
  const [
    daily,
    pages,
    searches,
    jobs,
    sources,
    devices,
    countries,
    funnel,
    crossVisit,
  ] = await Promise.all([
    db.execute<{ day: string; visitors: number; views: number }>(sql`
        select to_char(date_trunc('day', occurred_at), 'YYYY-MM-DD') as day,
               count(distinct day_visitor)::int as visitors,
               count(*) filter (where name = 'page_view')::int as views
        from public.analytics_events
        where occurred_at >= ${from}::timestamptz
        group by 1 order by 1
      `),
    top(sql`
        select path as label, count(*)::int as count from public.analytics_events
        where occurred_at >= ${from}::timestamptz and name = 'page_view'
        group by path order by count desc limit 10
      `),
    top(sql`
        select search_term as label, count(*)::int as count from public.analytics_events
        where occurred_at >= ${from}::timestamptz and name = 'search'
          and search_term is not null
        group by search_term order by count desc limit 10
      `),
    db.execute<{ jobId: string; title: string | null; count: number }>(sql`
        select e.job_id as "jobId", j.title, count(*)::int as count
        from public.analytics_events e
        left join public.jobs j on j.id = e.job_id
        where e.occurred_at >= ${from}::timestamptz and e.name = 'job_view'
        group by e.job_id, j.title order by count desc limit 10
      `),
    top(sql`
        select coalesce(utm_source, referrer_host, 'direct') as label,
               count(distinct day_visitor)::int as count
        from public.analytics_events
        where occurred_at >= ${from}::timestamptz
        group by 1 order by count desc limit 10
      `),
    top(sql`
        select device as label, count(distinct day_visitor)::int as count
        from public.analytics_events
        where occurred_at >= ${from}::timestamptz
        group by device order by count desc
      `),
    top(sql`
        select country as label, count(distinct day_visitor)::int as count
        from public.analytics_events
        where occurred_at >= ${from}::timestamptz
        group by country order by count desc limit 10
      `),
    db.execute<{ step: string; count: number }>(sql`
        select name as step, count(distinct day_visitor)::int as count
        from public.analytics_events
        where occurred_at >= ${from}::timestamptz
        group by name
      `),
    // Cross-visit funnel for consented visitors only (D226).
    db.execute<{ step: string; count: number }>(sql`
        select name as step, count(distinct visitor_id)::int as count
        from public.analytics_events
        where occurred_at >= ${from}::timestamptz and visitor_id is not null
        group by name
      `),
  ]);
  return {
    totals: totals ?? { visitors: 0, views: 0, consented: 0, returning: 0 },
    daily: [...daily],
    pages,
    searches,
    jobs: [...jobs],
    sources,
    devices,
    countries,
    funnel: Object.fromEntries(funnel.map((row) => [row.step, row.count])),
    crossVisit: Object.fromEntries(
      crossVisit.map((row) => [row.step, row.count]),
    ),
  };
}

export type AnalyticsReport = Awaited<ReturnType<typeof readReport>>;

/** Views of one job for its employer (D232): no visitor-level data leaves. */
export async function readJobViews(jobId: string, since: Date) {
  const from = since.toISOString();
  const db = getDb();
  const [totals] = await db.execute<{ views: number; visitors: number }>(sql`
    select count(*)::int as views,
           count(distinct (date_trunc('day', occurred_at), day_visitor))::int as visitors
    from public.analytics_events
    where name = 'job_view' and job_id = ${jobId}
      and occurred_at >= ${from}::timestamptz
  `);
  const [daily, sources, devices] = await Promise.all([
    db.execute<{ day: string; views: number }>(sql`
      select to_char(date_trunc('day', occurred_at), 'YYYY-MM-DD') as day,
             count(*)::int as views
      from public.analytics_events
      where name = 'job_view' and job_id = ${jobId}
        and occurred_at >= ${from}::timestamptz
      group by 1 order by 1
    `),
    top(sql`
      select coalesce(utm_source, referrer_host, 'direct') as label,
             count(*)::int as count
      from public.analytics_events
      where name = 'job_view' and job_id = ${jobId}
        and occurred_at >= ${from}::timestamptz
      group by 1 order by count desc limit 8
    `),
    top(sql`
      select device as label, count(*)::int as count
      from public.analytics_events
      where name = 'job_view' and job_id = ${jobId}
        and occurred_at >= ${from}::timestamptz
      group by device order by count desc
    `),
  ]);
  return {
    views: totals?.views ?? 0,
    visitors: totals?.visitors ?? 0,
    daily: [...daily],
    sources,
    devices,
  };
}

export type JobViews = Awaited<ReturnType<typeof readJobViews>>;

export type SourceRow = {
  day: string;
  referrerHost: string | null;
  utmSource: string | null;
  utmMedium: string | null;
  visitors: number;
};

/** Visits by day and by where they came from; the channel is worked out in
 * TypeScript so one list of search engines serves the whole app (D293). */
export async function readTrafficSources(since: Date): Promise<SourceRow[]> {
  const rows = await getDb().execute<SourceRow>(sql`
    select to_char(date_trunc('day', occurred_at), 'YYYY-MM-DD') as day,
           referrer_host as "referrerHost",
           utm_source as "utmSource",
           utm_medium as "utmMedium",
           count(distinct day_visitor)::int as visitors
    from public.analytics_events
    where occurred_at >= ${since.toISOString()}::timestamptz
    group by 1, 2, 3, 4
  `);
  return [...rows];
}

export type LandingRow = {
  path: string;
  referrerHost: string | null;
  utmSource: string | null;
  utmMedium: string | null;
  visitors: number;
};

/** Which pages a visit started on, by source (D293). */
export async function readLandingPages(since: Date): Promise<LandingRow[]> {
  const rows = await getDb().execute<LandingRow>(sql`
    select path,
           referrer_host as "referrerHost",
           utm_source as "utmSource",
           utm_medium as "utmMedium",
           count(distinct day_visitor)::int as visitors
    from public.analytics_events
    where occurred_at >= ${since.toISOString()}::timestamptz
      and name = 'page_view'
    group by 1, 2, 3, 4
    order by visitors desc
    limit 500
  `);
  return [...rows];
}

export type NewVisitorRow = {
  occurredAt: string;
  path: string;
  country: string | null;
  device: Device;
  referrerHost: string | null;
  utmSource: string | null;
};

/**
 * Visitors whose first page view of the UTC day falls in [from, to) (D607).
 * A visitor is the daily key, so "new" means new for that day.
 */
export async function readNewVisitors(
  from: Date,
  to: Date,
): Promise<NewVisitorRow[]> {
  const rows = await getDb().execute<NewVisitorRow>(sql`
    with firsts as (
      select distinct on (day_visitor)
             occurred_at, path, country, device, referrer_host, utm_source
      from public.analytics_events
      where name = 'page_view'
        and occurred_at >= date_trunc('day', ${from.toISOString()}::timestamptz)
        and occurred_at < ${to.toISOString()}::timestamptz
      order by day_visitor, occurred_at
    )
    select to_char(occurred_at at time zone 'UTC', 'HH24:MI') as "occurredAt",
           path, country, device,
           referrer_host as "referrerHost", utm_source as "utmSource"
    from firsts
    where occurred_at >= ${from.toISOString()}::timestamptz
    order by occurred_at
  `);
  return [...rows];
}
