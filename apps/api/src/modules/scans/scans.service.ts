import { Injectable, NotFoundException } from "@nestjs/common";
import { ScanStatus } from "@prisma/client";

import { env } from "../../common/config/env";
import { PrismaService } from "../../common/prisma/prisma.service";
import { scansQueue } from "../../common/queue/scan-queue";

type CreateScanInput = {
  userId?: string;
  storeId: string;
  url: string;
};

@Injectable()
export class ScansService {
  constructor(private readonly prisma: PrismaService) {}

  async createScan(input: CreateScanInput) {
    const store = await this.prisma.store.findFirst({
      where: {
        id: input.storeId,
      },
      select: {
        id: true,
      },
    });

    if (!store) {
      throw new NotFoundException("Store not found.");
    }

    const cacheWindowStart = new Date(
      Date.now() - env.SCAN_CACHE_TTL_HOURS * 60 * 60 * 1000,
    );

    const cachedScan = await this.prisma.scan.findFirst({
      where: {
        storeId: input.storeId,
        url: input.url,
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
        storeId: input.storeId,
        requestedByUserId: input.userId,
        url: input.url,
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
        storeId: input.storeId,
        url: input.url,
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
