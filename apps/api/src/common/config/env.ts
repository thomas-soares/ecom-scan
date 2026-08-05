export const env = {
  API_PORT: Number(process.env.PORT ?? process.env.API_PORT ?? 4000),
  WEB_ORIGIN: process.env.WEB_ORIGIN ?? "http://localhost:3000",
  REDIS_URL: process.env.REDIS_URL ?? "redis://localhost:6379",
  SCAN_CACHE_TTL_HOURS: Number(process.env.SCAN_CACHE_TTL_HOURS ?? 6),
};
