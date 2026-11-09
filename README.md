# intgetion-analytics

First-party analytics of the INTGETION platform as a standalone service:
page views from the site's own beacon (D225), job views, searches, sign-ups
and applications as server events, the analytics and traffic reports for the
admin page, one job's views for its employer (D232), forgetting a visitor
when analytics consent is withdrawn (D226), purging old events, and the
hourly new-visitor digest for the platform owners in Telegram. Not
connected to the platform yet; it is integrated later through a separate
branch and PR. The consent banner and the pages stay in the platform.

- Package `@intgetion/analytics`, HTTP service on port `4190`.
- Depends on `@intgetion/kit` v0.3.1 (by git tag); `./consent` exports the
  consent cookie helpers the banner and the server share.
- Owns `analytics_events` (migration `0001_analytics.sql`, the final state
  of platform migrations 0022 and 0087, with the `app_rw` grants on the
  table and its sequence). Written by hand: the table has an identity column.
- Reads only, outside its table: `jobs.title` for the top viewed jobs.

## Consent

Nothing personal is kept without consent: the event carries a daily visitor
hash only, and the visitor id cookie is read only while the consent cookie
allows analytics (and no Global Privacy Control). The platform forwards the
visitor's `cookie`, `user-agent`, `x-forwarded-for` and
`x-vercel-ip-country` headers unchanged, so the service reads them as before.

## Ports

`rateHit(bucket, subject, now)`: the platform rate limiter (the digest goes
out once per window). Over HTTP: `POST /api/internal/analytics/rate-hit`.

## HTTP

Every route except `/health` needs `authorization: Bearer $ANALYTICS_SERVICE_TOKEN`.

| Method | Path | Does |
| --- | --- | --- |
| POST | `/v1/events/page-view` | `{path, search?, referrer?}`, 204; the platform applies the beacon limit first |
| POST | `/v1/events/server` | `{name: signup\|apply}`, 204 |
| POST | `/v1/forget` | `{visitorId}` |
| GET | `/v1/reports/analytics?days`, `/v1/reports/traffic?days` | admin reports (1–90 days) |
| GET | `/v1/jobs/:id/views?days` | one job's views; the platform checks the employer |
| POST | `/v1/tasks/purge` | cron: drop old events |
| POST | `/v1/tasks/visitor-digest` | cron: `{recipients: [{chatId, locale}]}` |

## Run

```bash
cp .env.example .env
npm ci
npm run migrate
npm start
```

## Tests

Unit tests run without a database. Integration tests run when `DATABASE_URL`
is set, on a database prepared as in CI: `test/sql/pre/*.sql`, then
`npm run migrate`.
