import { Injectable, NotFoundException } from "@nestjs/common";
import { ScanStatus } from "@prisma/client";

import { env } from "../../common/config/env";
import { PrismaService } from "../../common/prisma/prisma.service";
import { scansQueue } from "../../common/queue/scan-queue";

type CreateScanInput = {
  userId?: string;
  storeId?: string;
  url: string;
};

@Injectable()
export class ScansService {
  constructor(private readonly prisma: PrismaService) {}

  async createScan(input: CreateScanInput) {
    const normalizedUrl = new URL(input.url).toString();
    let resolvedStoreId = input.storeId;

    if (resolvedStoreId) {
      const store = await this.prisma.store.findFirst({
        where: {
          id: resolvedStoreId,
        },
        select: {
          id: true,
        },
      });

      if (!store) {
        throw new NotFoundException("Store not found.");
      }
    } else {
      const hostname = new URL(normalizedUrl).hostname.replace(/^www\./i, "");
      const store = await this.prisma.store.upsert({
        where: {
          url: normalizedUrl,
        },
        update: {
          name: hostname,
        },
        create: {
          name: hostname,
          url: normalizedUrl,
        },
        select: {
          id: true,
        },
      });

      resolvedStoreId = store.id;
    }

    const cacheWindowStart = new Date(
      Date.now() - env.SCAN_CACHE_TTL_HOURS * 60 * 60 * 1000,
    );

    const cachedScan = await this.prisma.scan.findFirst({
      where: {
        storeId: resolvedStoreId,
        url: normalizedUrl,
        status: ScanStatus.COMPLETED,
        finishedAt: {
          gte: cacheWindowStart,
        },
      },
      orderBy: {
        finishedAt: "desc",
      },
      select: {
        id: true,
        status: true,
        finishedAt: true,
      },
    });

    if (cachedScan) {
      return {
        scanId: cachedScan.id,
        status: cachedScan.status,
        reused: true,
      };
    }

    const scan = await this.prisma.scan.create({
      data: {
        storeId: resolvedStoreId,
        requestedByUserId: input.userId,
        url: normalizedUrl,
        status: ScanStatus.QUEUED,
        queuedAt: new Date(),
      },
      select: {
        id: true,
        status: true,
      },
    });

    await scansQueue.add(
      "scan-store-url",
      {
        scanId: scan.id,
        storeId: resolvedStoreId,
        url: normalizedUrl,
      },
      {
        attempts: 4,
        backoff: {
          type: "exponential",
          delay: 1000,
        },
        removeOnComplete: true,
        removeOnFail: 200,
      },
    );

    return {
      scanId: scan.id,
      status: scan.status,
      reused: false,
    };
  }

  async getScanById(scanId: string) {
    const scan = await this.prisma.scan.findFirst({
      where: {
        id: scanId,
      },
      include: {
        detections: true,
        eventValidations: true,
        findings: true,
        report: true,
      },
    });

    if (!scan) {
      throw new NotFoundException("Scan not found.");
    }

    return scan;
  }
}
