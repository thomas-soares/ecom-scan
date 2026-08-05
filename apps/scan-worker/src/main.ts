import "dotenv/config";

import { PrismaClient, ScanStatus, ValidationStatus } from "@prisma/client";
import { Job, Worker } from "bullmq";
import IORedis from "ioredis";

import { type DetectionName, runStoreScan } from "./scan/run-store-scan";

const REDIS_URL = process.env.REDIS_URL ?? "redis://localhost:6379";
const SCANS_QUEUE_NAME = "store-scans";

function isEnabled(envValue: string | undefined) {
  return envValue === "true" || envValue === "1";
}

const disabledPlatforms: DetectionName[] = [];

if (!isEnabled(process.env.ENABLE_TIKTOK_SCAN)) {
  disabledPlatforms.push("TIKTOK");
}

if (!isEnabled(process.env.ENABLE_PINTEREST_SCAN)) {
  disabledPlatforms.push("PINTEREST");
}

if (!isEnabled(process.env.ENABLE_SNAPCHAT_SCAN)) {
  disabledPlatforms.push("SNAPCHAT");
}

const redisConnection = new IORedis(REDIS_URL, {
  maxRetriesPerRequest: null,
});

const prisma = new PrismaClient();

type ScanJobData = {
  scanId: string;
  storeId: string;
  url: string;
};

async function processScan(job: Job<ScanJobData>) {
  await prisma.scan.update({
    where: { id: job.data.scanId },
    data: {
      status: ScanStatus.RUNNING,
      startedAt: new Date(),
      errorMessage: null,
    },
  });

  const output = await runStoreScan(job.data.url, {
    disabledPlatforms,
  });

  await prisma.$transaction(async (tx) => {
    await tx.scanPlatformDetection.deleteMany({
      where: { scanId: job.data.scanId },
    });

    await tx.scanEventValidation.deleteMany({
      where: { scanId: job.data.scanId },
    });

    await tx.scanFinding.deleteMany({
      where: { scanId: job.data.scanId },
    });

    await tx.scanPlatformDetection.createMany({
      data: output.detections.map((d) => ({
        scanId: job.data.scanId,
        platform: d.platform,
        isDetected: d.isDetected,
        evidence: d.evidence,
        details: d.details,
      })),
    });

    await tx.scanEventValidation.createMany({
      data: output.events.map((e) => ({
        scanId: job.data.scanId,
        event: e.event,
        status:
          e.status === "PASS"
            ? ValidationStatus.PASS
            : ValidationStatus.WARNING,
        details: e.details,
      })),
    });

    await tx.scanFinding.createMany({
      data: output.findings.map((f) => ({
        scanId: job.data.scanId,
        category: f.category,
        severity: f.severity,
        title: f.title,
        description: f.description,
        impactScore: f.impactScore,
      })),
    });

    await tx.scanReport.upsert({
      where: {
        scanId: job.data.scanId,
      },
      create: {
        scanId: job.data.scanId,
        estimatedMonthlyLossCents: output.estimatedMonthlyLossCents,
        summary: output.summary,
      },
      update: {
        estimatedMonthlyLossCents: output.estimatedMonthlyLossCents,
        summary: output.summary,
      },
    });

    await tx.scan.update({
      where: { id: job.data.scanId },
      data: {
        status: ScanStatus.COMPLETED,
        finishedAt: new Date(),
      },
    });
  });
}

const worker = new Worker<ScanJobData>(SCANS_QUEUE_NAME, processScan, {
  connection: redisConnection,
  concurrency: Number(process.env.SCAN_WORKER_CONCURRENCY ?? 2),
});

worker.on("completed", (job) => {
  // eslint-disable-next-line no-console
  console.log(`scan completed: ${job.id}`);
});

worker.on("failed", async (job, error) => {
  // eslint-disable-next-line no-console
  console.error(`scan failed: ${job?.id}`, error.message);

  if (!job) {
    return;
  }

  await prisma.scan.update({
    where: { id: job.data.scanId },
    data: {
      status: ScanStatus.FAILED,
      errorMessage: error.message,
      finishedAt: new Date(),
    },
  });
});

worker.on("error", (error) => {
  // eslint-disable-next-line no-console
  console.error("worker error", error.message);
});

// eslint-disable-next-line no-console
console.log("Scan worker started.");
