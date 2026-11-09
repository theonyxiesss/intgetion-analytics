import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { getDb } from "@intgetion/kit";
import { CONSENT_POLICY_VERSION } from "../../lib/consent";
import {
  analyticsReport,
  forgetVisitor,
  jobViews,
  purgeAnalytics,
  trackPageView,
} from "./service";

const chrome =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Safari/537.36";
// A unique search term marks this run's rows.
const marker = `itest-${randomUUID().slice(0, 8)}`;
const visitorId = randomUUID();
// A job id no real job has: its views belong to this run only.
const jobId = randomUUID();
const consentAll = `cookie_consent=all~${CONSENT_POLICY_VERSION}~${randomUUID()}`;

function request(headers: Record<string, string>) {
  return new Request("http://127.0.0.1:3000/api/a", {
    method: "POST",
    headers: {
      "user-agent": chrome,
      "x-forwarded-for": "198.18.7.7",
      ...headers,
    },
  });
}

afterAll(async () => {
  await getDb().execute(sql`
    delete from public.analytics_events
    where search_term = ${marker} or visitor_id = ${visitorId}
       or job_id = ${jobId}
  `);
});

async function rows() {
  return getDb().execute<{
    name: string;
    visitor_id: string | null;
    search_term: string | null;
  }>(sql`
    select name, visitor_id, search_term from public.analytics_events
    where search_term = ${marker} or visitor_id = ${visitorId}
    order by id
  `);
}

describe("own analytics against the database (D225-D227)", () => {
  it("records a search as page view plus search, without a visitor id", async () => {
    const written = await trackPageView(
      request({ cookie: `_ia=${visitorId}` }),
      { path: "/en/jobs", search: `?q=${marker}`, referrer: null },
    );
    expect(written).toBe(2);
    const found = await getDb().execute<{
      name: string;
      visitor_id: string | null;
    }>(sql`
      select name, visitor_id from public.analytics_events
      where search_term = ${marker}
    `);
    expect(found.map((row) => row.name)).toEqual(["search"]);
    // No analytics consent: the _ia cookie is ignored.
    expect(found[0]!.visitor_id).toBeNull();
  });

  it("links visits only with consent and not with GPC", async () => {
    await trackPageView(
      request({ cookie: `${consentAll}; _ia=${visitorId}`, "sec-gpc": "1" }),
      { path: "/en/jobs", search: `?q=${marker}`, referrer: null },
    );
    expect((await rows()).filter((row) => row.visitor_id)).toHaveLength(0);
    await trackPageView(
      request({ cookie: `${consentAll}; _ia=${visitorId}` }),
      {
        path: "/en/jobs",
        search: `?q=${marker}`,
        referrer: null,
      },
    );
    expect(
      (await rows()).filter((row) => row.visitor_id === visitorId).length,
    ).toBe(2);
  });

  it("counts a job's views for its employer (D232)", async () => {
    for (const ip of ["198.18.9.1", "198.18.9.1", "198.18.9.2"]) {
      await trackPageView(request({ "x-forwarded-for": ip }), {
        path: `/en/jobs/${jobId}`,
        search: "",
        referrer: "https://t.me/channel",
      });
    }
    const views = await jobViews(jobId, 1);
    expect(views.views).toBe(3);
    expect(views.visitors).toBe(2);
    expect(views.sources).toEqual([{ label: "t.me", count: 3 }]);
  });

  it("ignores bots", async () => {
    const written = await trackPageView(
      request({ "user-agent": "Googlebot/2.1" }),
      { path: "/en/jobs", search: `?q=${marker}`, referrer: null },
    );
    expect(written).toBe(0);
  });

  it("forgets a visitor id when consent is withdrawn", async () => {
    await forgetVisitor(visitorId);
    expect((await rows()).some((row) => row.visitor_id)).toBe(false);
  });

  it("reports this run's search among the top searches", async () => {
    const report = await analyticsReport(1);
    expect(report.searches.some((row) => row.label === marker)).toBe(true);
    expect(report.totals.visitors).toBeGreaterThan(0);
  });

  it("purges events older than 13 months", async () => {
    await getDb().execute(sql`
      insert into public.analytics_events (occurred_at, name, path, device, day_visitor, search_term)
      values (now() - interval '400 days', 'page_view', '/en', 'desktop', 'x', ${marker})
    `);
    await purgeAnalytics();
    const old = await getDb().execute(sql`
      select 1 from public.analytics_events
      where search_term = ${marker} and occurred_at < now() - interval '395 days'
    `);
    expect(old).toHaveLength(0);
  });
});
