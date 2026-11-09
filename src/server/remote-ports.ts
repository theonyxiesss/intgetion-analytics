import type { AnalyticsPorts } from "../ports";

export type Endpoint = { url: string; token: string };

/**
 * The rate limiter lives in the platform: `POST /api/internal/analytics/rate-hit`
 * with `{args: [bucket, subject, now]}` answers `{result: count}`.
 */
export function httpAnalyticsPorts(config: { platform: Endpoint; fetchImpl?: typeof fetch }): AnalyticsPorts {
  const doFetch = config.fetchImpl ?? fetch;
  const base = config.platform.url.replace(/\/+$/, "");
  return {
    rateHit: async (bucket, subject, now) => {
      const response = await doFetch(`${base}/api/internal/analytics/rate-hit`, {
        method: "POST",
        headers: { authorization: `Bearer ${config.platform.token}`, "content-type": "application/json" },
        body: JSON.stringify({ args: [bucket, subject, now.toISOString()] }),
        signal: AbortSignal.timeout(10_000),
      });
      if (!response.ok) throw new Error(`rate-hit answered ${response.status}`);
      const json = (await response.json()) as { result: number };
      return Number(json.result);
    },
  };
}
