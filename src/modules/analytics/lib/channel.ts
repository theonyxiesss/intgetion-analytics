/**
 * Where a visit came from (D293). The raw referrer host answers "which site";
 * the channel answers the question the founder actually asks — is search
 * bringing people in, and is it growing.
 */
export const CHANNELS = ["search", "social", "referral", "direct"] as const;
export type Channel = (typeof CHANNELS)[number];

/** Host endings, so "www.google.de" and "news.google.com" both count. */
const SEARCH_ENGINES: readonly [string, readonly string[]][] = [
  ["google", ["google."]],
  ["yandex", ["yandex.", "ya.ru"]],
  ["bing", ["bing.com"]],
  ["duckduckgo", ["duckduckgo.com"]],
  ["yahoo", ["yahoo.com", "search.yahoo."]],
  ["baidu", ["baidu.com"]],
  ["ecosia", ["ecosia.org"]],
  ["brave", ["search.brave.com"]],
];

const SOCIAL = [
  "t.me",
  "telegram.org",
  "telegram.me",
  "web.telegram.org",
  "twitter.com",
  "x.com",
  "linkedin.com",
  "lnkd.in",
  "reddit.com",
  "facebook.com",
  "instagram.com",
  "news.ycombinator.com",
  "producthunt.com",
  "vk.com",
  "discord.com",
];

function normalizeHost(host: string): string {
  return host
    .trim()
    .toLowerCase()
    .replace(/^www\./, "");
}

/** The search engine behind a referrer host, or null when it is not one. */
export function searchEngineOf(host: string | null): string | null {
  if (!host) return null;
  const name = normalizeHost(host);
  for (const [engine, needles] of SEARCH_ENGINES) {
    // A campaign tag names the engine plainly ("google"); a referrer gives a
    // host ("www.google.de").
    if (name === engine) return engine;
    if (needles.some((needle) => name === needle || name.includes(needle))) {
      return engine;
    }
  }
  return null;
}

/**
 * A visit's channel. A campaign tag wins over the referrer: a link we tagged
 * ourselves is what we meant it to be.
 */
export function channelOf(input: {
  referrerHost: string | null;
  utmSource?: string | null;
  utmMedium?: string | null;
}): Channel {
  const medium = input.utmMedium?.trim().toLowerCase();
  if (medium === "organic") return "search";
  if (medium === "social") return "social";
  const source = input.utmSource?.trim().toLowerCase() ?? null;
  if (source && searchEngineOf(source)) return "search";
  if (source && SOCIAL.some((item) => source.includes(item))) return "social";
  const host = input.referrerHost ? normalizeHost(input.referrerHost) : null;
  if (!host && !source) return "direct";
  if (searchEngineOf(host)) return "search";
  if (host && SOCIAL.some((item) => host === item || host.endsWith(`.${item}`)))
    return "social";
  return "referral";
}
