/**
 * Public service surface.
 * Other modules may import only this file, never this module's repo.
 */
export {
  analyticsReport,
  trafficReport,
  type TrafficReport,
  forgetVisitor,
  jobViews,
  purgeAnalytics,
  trackPageView,
  trackServerEvent,
} from "./analytics-service";
export {
  runVisitorDigest,
  visitorDigestText,
  type DigestRecipient,
} from "./visitor-digest";
export { VISITOR_COOKIE, VISITOR_MAX_AGE_SECONDS } from "../lib/events";
export { beaconInput, forgetInput } from "../schemas";
export type { AnalyticsReport, JobViews } from "../repo/analytics-repo";
