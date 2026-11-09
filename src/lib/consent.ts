/**
 * Cookie consent by category (D201, D219, D220). Necessary cookies (session,
 * language, bot session, this choice) are always on. Optional ones:
 * "preferences" — remembering things like the last catalog filters;
 * "analytics" — the `_ia` visitor id of our own statistics (D226);
 * cookieless daily counts need no consent (D225).
 * Anything optional must check `consentAllows` and write nothing without it.
 */
export const CONSENT_COOKIE = "cookie_consent";
export const CONSENT_MAX_AGE_SECONDS = 365 * 24 * 60 * 60;

/**
 * Version of the cookie policy the choice was made under. Changing it asks
 * everybody again: a choice under an older version counts as none (D220).
 */
export const CONSENT_POLICY_VERSION = "2026-10-05";

export const CONSENT_CATEGORIES = ["preferences", "analytics"] as const;
export type ConsentCategory = (typeof CONSENT_CATEGORIES)[number];

export type Consent = Record<ConsentCategory, boolean>;

export const NECESSARY_ONLY: Consent = { preferences: false, analytics: false };
export const ACCEPT_ALL: Consent = { preferences: true, analytics: true };

/**
 * Cookies that exist only with consent, by category: withdrawing consent
 * deletes them (D219).
 */
export const OPTIONAL_COOKIES: Record<ConsentCategory, readonly string[]> = {
  preferences: ["last_catalog_query", "recent_jobs"],
  analytics: ["_ia"],
};

/**
 * The categories part: "necessary", "all", or the allowed categories
 * joined by "+", e.g. "preferences".
 */
export function parseChoice(value: string | null | undefined): Consent | null {
  if (value === "necessary") return { ...NECESSARY_ONLY };
  if (value === "all") return { ...ACCEPT_ALL };
  if (!value) return null;
  const parts = value.split("+");
  if (
    !parts.every((part) =>
      (CONSENT_CATEGORIES as readonly string[]).includes(part),
    )
  ) {
    return null;
  }
  return {
    preferences: parts.includes("preferences"),
    analytics: parts.includes("analytics"),
  };
}

export function serializeChoice(consent: Consent): string {
  const allowed = CONSENT_CATEGORIES.filter((category) => consent[category]);
  if (allowed.length === 0) return "necessary";
  if (allowed.length === CONSENT_CATEGORIES.length) return "all";
  return allowed.join("+");
}

export type ConsentRecord = {
  consent: Consent;
  version: string;
  /** Id of the row in `consent_records` that proves this choice. */
  id: string;
};

const ID = /^[0-9a-f-]{36}$/;

/** Cookie value: `<choice>~<policy version>~<record id>`. */
export function parseConsentCookie(
  value: string | null | undefined,
): ConsentRecord | null {
  const [choice, version, id] = (value ?? "").split("~");
  const consent = parseChoice(choice);
  if (!consent || !version || !id || !ID.test(id)) return null;
  return { consent, version, id };
}

export function readCookie(
  cookieHeader: string | null | undefined,
  name: string,
): string | null {
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return rest.join("=");
  }
  return null;
}

/**
 * The choice in force: made under the current policy version. A value from
 * before D220 or an older policy counts as no choice, so the banner asks.
 */
export function readConsent(
  cookieHeader: string | null | undefined,
): Consent | null {
  return consentInForce(readCookie(cookieHeader, CONSENT_COOKIE));
}

/** Same as `readConsent`, from the cookie's value alone. */
export function consentInForce(
  value: string | null | undefined,
): Consent | null {
  const record = parseConsentCookie(value);
  return record?.version === CONSENT_POLICY_VERSION ? record.consent : null;
}

/**
 * Global Privacy Control (`Sec-GPC: 1`, `navigator.globalPrivacyControl`)
 * is a standing "no" to analytics, whatever was clicked (D220).
 */
export function applyGpc(consent: Consent, gpc: boolean): Consent {
  return gpc ? { ...consent, analytics: false } : consent;
}

/** An optional category is allowed only after an explicit yes. */
export function consentAllows(
  consent: Consent | null,
  category: ConsentCategory,
  options: { gpc?: boolean } = {},
): boolean {
  if (category === "analytics" && options.gpc) return false;
  return consent?.[category] === true;
}

export function consentCookie(record: ConsentRecord, secure: boolean): string {
  return [
    `${CONSENT_COOKIE}=${serializeChoice(record.consent)}~${record.version}~${record.id}`,
    "Path=/",
    `Max-Age=${CONSENT_MAX_AGE_SECONDS}`,
    "SameSite=Lax",
    ...(secure ? ["Secure"] : []),
  ].join("; ");
}

/** Optional cookies the new choice no longer allows. */
export function cookiesToDelete(consent: Consent): string[] {
  return CONSENT_CATEGORIES.filter((category) => !consent[category]).flatMap(
    (category) => [...OPTIONAL_COOKIES[category]],
  );
}

/** Browser only: whether the browser sends Global Privacy Control. */
export function browserGpc(): boolean {
  return (
    (navigator as Navigator & { globalPrivacyControl?: boolean })
      .globalPrivacyControl === true
  );
}

/**
 * Browser only: stores the choice for a year, deletes what it revokes and,
 * unless `record: false` (adopting a choice already on file), sends it to
 * the consent journal. Returns the stored categories (GPC applied).
 */
export function writeConsent(
  chosen: Consent,
  source: "banner" | "settings",
  options: { record?: boolean } = {},
): Consent {
  const consent = applyGpc(chosen, browserGpc());
  const entry: ConsentRecord = {
    consent,
    version: CONSENT_POLICY_VERSION,
    id: crypto.randomUUID(),
  };
  document.cookie = consentCookie(entry, window.location.protocol === "https:");
  const visitorId = readCookie(document.cookie, "_ia");
  if (!consent.analytics && visitorId) {
    // Past analytics events of this browser lose their id (D226).
    void fetch("/api/a/forget", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ visitorId }),
      keepalive: true,
    }).catch(() => undefined);
  }
  for (const name of cookiesToDelete(consent)) {
    document.cookie = `${name}=; Path=/; Max-Age=0; SameSite=Lax`;
  }
  if (options.record !== false) {
    void fetch("/api/consent", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        id: entry.id,
        choice: serializeChoice(consent),
        version: entry.version,
        source,
      }),
      keepalive: true,
    }).catch(() => {
      // A lost journal entry never undoes the choice the cookie holds.
    });
  }
  return consent;
}
