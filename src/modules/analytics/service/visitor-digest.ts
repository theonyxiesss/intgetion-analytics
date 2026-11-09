import { messagesFor } from "../../../i18n/messages";
import { analyticsPorts } from "../../../ports";

/** The digest goes out once per day window (platform rule `visitorDigest`). */
const VISITOR_DIGEST_LIMIT = 1;
import type { TelegramSender } from "@intgetion/kit";
import * as repo from "../repo/analytics-repo";

const HOUR_MS = 60 * 60 * 1000;
/** Lines in one message; the rest is one "and N more" line. */
export const DIGEST_MAX_LINES = 30;

export type DigestRecipient = { chatId: number; locale: string };
export type DigestWindow = { from: Date; to: Date };

/** The last full UTC hour before `now`. */
export function digestWindow(now: Date): DigestWindow {
  const to = new Date(Math.floor(now.getTime() / HOUR_MS) * HOUR_MS);
  return { from: new Date(to.getTime() - HOUR_MS), to };
}

function fill(template: string, values: Record<string, string | number>) {
  return template.replace(/\{(\w+)\}/g, (_, key: string) =>
    String(values[key] ?? ""),
  );
}

/** "DE" → 🇩🇪 */
function flagOf(country: string): string {
  return [...country]
    .map((letter) => String.fromCodePoint(0x1f1e6 + letter.charCodeAt(0) - 65))
    .join("");
}

/**
 * One Telegram message: how many new visitors came in the hour, then one
 * line each — time, country, source, first page, device. Nothing names a
 * person (D607).
 */
export function visitorDigestText(
  locale: string,
  window: DigestWindow,
  rows: readonly repo.NewVisitorRow[],
): string {
  const { analytics, visitorDigest } = messagesFor(locale).metrics;
  let regions: Intl.DisplayNames | null = null;
  try {
    regions = new Intl.DisplayNames([locale], { type: "region" });
  } catch {
    regions = null;
  }
  const hhmm = (date: Date) => date.toISOString().slice(11, 16);
  const lines = rows
    .slice(0, DIGEST_MAX_LINES)
    .map((row) =>
      [
        row.occurredAt,
        row.country
          ? `${flagOf(row.country)} ${regions?.of(row.country) ?? row.country}`
          : analytics.unknownCountry,
        row.utmSource ?? row.referrerHost ?? visitorDigest.direct,
        row.path,
        analytics.deviceNames[row.device],
      ].join(" · "),
    );
  if (rows.length > DIGEST_MAX_LINES) {
    lines.push(
      fill(visitorDigest.more, { count: rows.length - DIGEST_MAX_LINES }),
    );
  }
  const title = fill(visitorDigest.title, {
    from: hhmm(window.from),
    to: hhmm(window.to),
    count: rows.length,
  });
  return [title, "", ...lines].join("\n");
}

/**
 * Hourly digest of new visitors to the platform owners (D607). Runs inside
 * the five-minute Telegram cron; the first run after the hour sends it and
 * a counter keeps later runs from sending it again. An hour without new
 * visitors sends nothing.
 */
export async function runVisitorDigest(input: {
  sender: TelegramSender;
  recipients: readonly DigestRecipient[];
  now?: Date;
}): Promise<{ visitors: number; sent: number; skipped?: string }> {
  const now = input.now ?? new Date();
  if (input.recipients.length === 0) {
    return { visitors: 0, sent: 0, skipped: "no_recipients" };
  }
  const window = digestWindow(now);
  const rows = await repo.readNewVisitors(window.from, window.to);
  if (rows.length === 0) return { visitors: 0, sent: 0 };
  const count = await analyticsPorts().rateHit(
    "visitorDigest",
    window.from.toISOString(),
    now,
  );
  if (count > VISITOR_DIGEST_LIMIT) {
    return { visitors: rows.length, sent: 0, skipped: "already_sent" };
  }
  let sent = 0;
  for (const recipient of input.recipients) {
    const text = visitorDigestText(recipient.locale, window, rows);
    if ((await input.sender(recipient.chatId, text)) === "sent") sent += 1;
  }
  return { visitors: rows.length, sent };
}
