/** What analytics needs from the platform. */
export type AnalyticsPorts = {
  /**
   * The platform rate limiter: counts one hit for the bucket and subject in
   * its window and returns the count (the visitor digest goes out once a day).
   */
  rateHit: (bucket: string, subject: string, now: Date) => Promise<number>;
};

let ports: AnalyticsPorts | null = null;

export function setAnalyticsPorts(next: AnalyticsPorts): void {
  ports = next;
}

export function analyticsPorts(): AnalyticsPorts {
  if (!ports) throw new Error("analytics ports are not configured");
  return ports;
}
