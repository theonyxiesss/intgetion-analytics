import { z } from "zod";

/** `POST /api/a` — one page view from the browser (D225). */
export const beaconInput = z
  .object({
    path: z.string().min(1).max(300),
    search: z.string().max(1000).default(""),
    referrer: z.string().max(500).nullable().default(null),
  })
  .strict();
export type BeaconInput = z.infer<typeof beaconInput>;

/** `POST /api/a/forget` — consent for analytics was withdrawn (D226). */
export const forgetInput = z.object({ visitorId: z.uuid() }).strict();
