import { z, ZodError } from "zod";
import { HttpError, httpErrorResponse, notFound, reportError, telegramSender, validationError } from "@intgetion/kit";
import * as analytics from "../modules/analytics/service";
import { isUuid, requireServiceToken } from "./auth";

export type AppConfig = {
  serviceToken: string;
  /** Telegram bot token for the visitor digest; absent turns it off. */
  telegramToken?: string;
};

const MAX_JSON = 8 * 1024;

const daysQuery = z.coerce.number().int().min(1).max(90).default(30);
const serverEvent = z.object({ name: z.enum(["signup", "apply"]) }).strict();
const digestBody = z
  .object({
    recipients: z
      .array(z.object({ chatId: z.number().int(), locale: z.string().max(10) }).strict())
      .max(20),
  })
  .strict();

async function parsed<T>(request: Request, schema: z.ZodType<T>): Promise<T> {
  const text = await request.text();
  if (text.length > MAX_JSON) throw new HttpError(413, "PAYLOAD_TOO_LARGE", "Body too large");
  let json: unknown;
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    throw validationError([{ path: [], message: "invalid_json" }]);
  }
  return schema.parse(json);
}

/**
 * The visitor's own request as the platform received it: the platform
 * forwards the cookie, user agent, client address and country headers, so
 * consent and the visitor id are read the same way.
 */
const visitorRequest = (request: Request) => new Request(request.url, { headers: request.headers });

const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { "cache-control": "no-store" } });

type Route = {
  method: string;
  pattern: RegExp;
  run: (request: Request, params: string[], url: URL, config: AppConfig) => Promise<Response>;
};

const routes: Route[] = [
  {
    // One page view (D225). The platform applies the beacon rate limit first.
    method: "POST",
    pattern: /^\/v1\/events\/page-view$/,
    run: async (request) => {
      const input = await parsed(request.clone(), analytics.beaconInput);
      await analytics.trackPageView(visitorRequest(request), input);
      return new Response(null, { status: 204 });
    },
  },
  {
    method: "POST",
    pattern: /^\/v1\/events\/server$/,
    run: async (request) => {
      const { name } = await parsed(request.clone(), serverEvent);
      await analytics.trackServerEvent(visitorRequest(request), name);
      return new Response(null, { status: 204 });
    },
  },
  {
    // Consent for analytics was withdrawn (D226).
    method: "POST",
    pattern: /^\/v1\/forget$/,
    run: async (request) => {
      const { visitorId } = await parsed(request, analytics.forgetInput);
      return json({ forgotten: await analytics.forgetVisitor(visitorId) });
    },
  },
  {
    method: "GET",
    pattern: /^\/v1\/reports\/(analytics|traffic)$/,
    run: async (_request, [kind], url) => {
      const days = daysQuery.parse(url.searchParams.get("days") ?? undefined);
      return json(kind === "analytics" ? await analytics.analyticsReport(days) : await analytics.trafficReport(days));
    },
  },
  {
    // One job's views for its employer (D232); the platform checks the employer.
    method: "GET",
    pattern: /^\/v1\/jobs\/([^/]+)\/views$/,
    run: async (_request, [jobId], url) => {
      if (!jobId || !isUuid(jobId)) throw notFound();
      const days = daysQuery.parse(url.searchParams.get("days") ?? undefined);
      return json(await analytics.jobViews(jobId, days));
    },
  },
  {
    method: "POST",
    pattern: /^\/v1\/tasks\/purge$/,
    run: async () => json({ deleted: await analytics.purgeAnalytics() }),
  },
  {
    // Cron: the new-visitor digest for the platform owners (Telegram).
    method: "POST",
    pattern: /^\/v1\/tasks\/visitor-digest$/,
    run: async (request, _p, _u, config) => {
      if (!config.telegramToken) throw new HttpError(503, "TELEGRAM_OFF", "Telegram is not configured");
      const { recipients } = await parsed(request, digestBody);
      return json(
        await analytics.runVisitorDigest({
          sender: telegramSender(config.telegramToken),
          recipients,
        }),
      );
    },
  },
];

export function toResponse(error: unknown): Response {
  if (error instanceof HttpError) return httpErrorResponse(error);
  if (error instanceof ZodError) return httpErrorResponse(validationError(error.issues));
  reportError(error, "analytics-service");
  return Response.json({ error: { code: "INTERNAL", message: "Internal error" } }, { status: 500 });
}

export function createApp(config: AppConfig) {
  return async function handle(request: Request): Promise<Response> {
    const url = new URL(request.url);
    try {
      if (request.method === "GET" && url.pathname === "/health") return Response.json({ ok: true });
      requireServiceToken(request, config.serviceToken);
      for (const route of routes) {
        if (route.method !== request.method) continue;
        const match = route.pattern.exec(url.pathname);
        if (!match) continue;
        return await route.run(request, match.slice(1), url, config);
      }
      throw notFound();
    } catch (error) {
      return toResponse(error);
    }
  };
}
