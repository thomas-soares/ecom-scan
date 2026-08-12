import { Queue } from "bullmq";
import IORedis from "ioredis";

import { env } from "../config/env";

export const SCANS_QUEUE_NAME = "store-scans";

const redisConnection = new IORedis(env.REDIS_URL, {
  maxRetriesPerRequest: null,
});

export type ScanJobData = {
  scanId: string;
  storeId: string;
  url: string;
  storePlatform: "SHOPIFY" | "NUVEMSHOP" | "VTEX" | "TRAY" | "OTHER";
  financialAssumptions?: {
    monthlyTraffic?: number;
    averageOrderValueCents?: number;
    baseConversionRate?: number;
  };
};

export const scansQueue = new Queue<ScanJobData>(SCANS_QUEUE_NAME, {
  connection: redisConnection,
});
