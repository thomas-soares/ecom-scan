import { Injectable, NotFoundException } from "@nestjs/common";
import { resolveCname } from "node:dns/promises";
import { ScanStatus, StorePlatform } from "@prisma/client";

import { env } from "../../common/config/env";
import { PrismaService } from "../../common/prisma/prisma.service";
import { scansQueue } from "../../common/queue/scan-queue";

type CreateScanInput = {
  userId?: string;
  storeId?: string;
  url: string;
};

function detectStorePlatformFromText(text: string): StorePlatform {
  const normalizedText = text.toLowerCase();

  if (
    normalizedText.includes("nuvemshop") ||
    normalizedText.includes("tiendanube")
  ) {
    return StorePlatform.NUVEMSHOP;
  }

  if (
    normalizedText.includes("myshopify") ||
    normalizedText.includes("cdn.shopify") ||
    normalizedText.includes("shopify")
  ) {
    return StorePlatform.SHOPIFY;
  }

  if (
    normalizedText.includes("vtex") ||
    normalizedText.includes("vtexcommercestable") ||
    normalizedText.includes("vtexassets") ||
    normalizedText.includes("vteximg")
  ) {
    return StorePlatform.VTEX;
  }

  if (
    normalizedText.includes("tray") ||
    normalizedText.includes("traycdn") ||
    normalizedText.includes("corecommerce") ||
    normalizedText.includes("x-commerce-hash") ||
    normalizedText.includes("commercesuite")
  ) {
    return StorePlatform.TRAY;
  }

  return StorePlatform.OTHER;
}

async function inferStorePlatform(url: string): Promise<StorePlatform> {
  const hostname = new URL(url).hostname.toLowerCase();
  const fromHostname = detectStorePlatformFromText(hostname);

  if (fromHostname !== StorePlatform.OTHER) {
    return fromHostname;
  }

  try {
    const response = await fetch(url, {
      redirect: "follow",
      headers: {
        "user-agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36",
      },
    });
    const headerText = Array.from(response.headers.entries())
      .map(([key, value]) => `${key}: ${value}`)
      .join("\n");
    const bodyText = await response.text();
    const fromResponse = detectStorePlatformFromText(
      `${response.url}\n${headerText}\n${bodyText}`,
    );

    if (fromResponse !== StorePlatform.OTHER) {
      return fromResponse;
    }
  } catch {
    // Ignore HTTP inference errors and fall back to DNS.
  }

  try {
    const cnameRecords = await resolveCname(hostname);
    const fromCname = detectStorePlatformFromText(cnameRecords.join("\n"));

    if (fromCname !== StorePlatform.OTHER) {
      return fromCname;
    }
  } catch {
    // Ignore DNS errors and keep the fallback below.
  }

  return StorePlatform.OTHER;
}

@Injectable()
export class ScansService {
  constructor(private readonly prisma: PrismaService) {}

  async createScan(input: CreateScanInput) {
    const normalizedUrl = new URL(input.url).toString();
    const storePlatform = await inferStorePlatform(normalizedUrl);
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
          platform: storePlatform,
        },
        create: {
          name: hostname,
          url: normalizedUrl,
          platform: storePlatform,
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
        store: {
          select: {
            platform: true,
            name: true,
            url: true,
          },
        },
        detections: true,
        eventValidations: true,
        findings: true,
        report: true,
      },
    });

    if (!scan) {
      throw new NotFoundException("Scan not found.");
    }

    if (scan.store.platform === StorePlatform.OTHER) {
      const inferredPlatform = await inferStorePlatform(scan.url);

      if (inferredPlatform !== StorePlatform.OTHER) {
        await this.prisma.store.update({
          where: {
            id: scan.storeId,
          },
          data: {
            platform: inferredPlatform,
          },
        });

        scan.store.platform = inferredPlatform;
      }
    }

    return scan;
  }
}
