export const env = {
  API_PORT: Number(process.env.PORT ?? process.env.API_PORT ?? 4000),
  WEB_ORIGIN: process.env.WEB_ORIGIN ?? "http://localhost:3000",
  REDIS_URL: process.env.REDIS_URL ?? "redis://localhost:6379",
  ENABLE_RECENT_SCAN_REUSE:
    process.env.ENABLE_RECENT_SCAN_REUSE !== "false" &&
    process.env.ENABLE_RECENT_SCAN_REUSE !== "0",
  RECENT_SCAN_REUSE_WINDOW_MINUTES: Number(
    process.env.RECENT_SCAN_REUSE_WINDOW_MINUTES ?? 30,
  ),
};
