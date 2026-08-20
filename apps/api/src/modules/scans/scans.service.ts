import { BadRequestException, Injectable, NotFoundException, UnauthorizedException } from "@nestjs/common";
import { resolveCname } from "node:dns/promises";
import { ScanStatus, StorePlatform } from "@prisma/client";

import { env } from "../../common/config/env";
import { PrismaService } from "../../common/prisma/prisma.service";
import { scansQueue } from "../../common/queue/scan-queue";

type CreateScanInput = {
  userId?: string;
  userEmail?: string;
  userName?: string;
  storeId?: string;
  url: string;
  financialAssumptions: {
    monthlyTraffic: number;
    averageOrderValueCents: number;
  };
  metaAds?: {
    activeAdsCount: number | null;
  };
};

type FinancialAssumptions = NonNullable<CreateScanInput["financialAssumptions"]>;
type AuthUserInput = {
  userId?: string;
  userEmail?: string;
  userName?: string;
};

function normalizeFinancialAssumptions(
  assumptions: FinancialAssumptions,
) {
  return {
    monthlyTraffic: Math.max(0, assumptions.monthlyTraffic),
    averageOrderValueCents: Math.max(0, assumptions.averageOrderValueCents),
  };
}

function getSummaryLossAssumptions(summary: unknown) {
  if (!summary || typeof summary !== "object" || Array.isArray(summary)) {
    return null;
  }

  const lossAssumptions = (summary as { lossAssumptions?: unknown })
    .lossAssumptions;

  if (
    !lossAssumptions ||
    typeof lossAssumptions !== "object" ||
    Array.isArray(lossAssumptions)
  ) {
    return null;
  }

  const candidate = lossAssumptions as Record<string, unknown>;
  const monthlyTraffic = Number(candidate.monthlyTraffic);
  const averageOrderValueCents = Number(candidate.averageOrderValueCents);

  if (
    !Number.isFinite(monthlyTraffic) ||
    !Number.isFinite(averageOrderValueCents)
  ) {
    return null;
  }

  return {
    monthlyTraffic,
    averageOrderValueCents,
  };
}

function financialAssumptionsMatch(
  current: ReturnType<typeof normalizeFinancialAssumptions>,
  previous: ReturnType<typeof normalizeFinancialAssumptions> | null,
) {
  if (!previous) {
    return false;
  }

  return (
    current.monthlyTraffic === previous.monthlyTraffic &&
    current.averageOrderValueCents === previous.averageOrderValueCents
  );
}

function detectStorePlatformFromText(text: string): StorePlatform {
  const normalizedText = text.toLowerCase();

  if (
    normalizedText.includes("nuvemshop") ||
    normalizedText.includes("tiendanube") ||
    normalizedText.includes("nuvem shop") ||
    normalizedText.includes("cdn.nuvemshop.com.br") ||
    normalizedText.includes("d26lpennugtm8s.cloudfront.net") ||
    normalizedText.includes("ls.store")
  ) {
    return StorePlatform.NUVEMSHOP;
  }

  if (
    normalizedText.includes("myshopify") ||
    normalizedText.includes("cdn.shopify") ||
    normalizedText.includes("shopify") ||
    normalizedText.includes("shopifyanalytics") ||
    normalizedText.includes("x-shopify")
  ) {
    return StorePlatform.SHOPIFY;
  }

  if (
    normalizedText.includes("vtex") ||
    normalizedText.includes("vtexcommercestable") ||
    normalizedText.includes("vtexassets") ||
    normalizedText.includes("vteximg") ||
    normalizedText.includes("vtex.render-runtime") ||
    normalizedText.includes("io.vtex") ||
    normalizedText.includes("checkout.vtex.com")
  ) {
    return StorePlatform.VTEX;
  }

  if (
    normalizedText.includes("tray") ||
    normalizedText.includes("traycdn") ||
    normalizedText.includes("corecommerce") ||
    normalizedText.includes("x-commerce-hash") ||
    normalizedText.includes("commercesuite") ||
    normalizedText.includes("traycommerce") ||
    normalizedText.includes("tray checkout") ||
    normalizedText.includes("traycheckout")
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

function assertAuthenticated(userId?: string): asserts userId is string {
  if (!userId) {
    throw new UnauthorizedException("User is required.");
  }
}

function fallbackUserEmail(userId: string) {
  return `${userId}@local.ecom-scan`;
}

function normalizeScannableUrl(rawUrl: string) {
  const trimmedUrl = rawUrl.trim();
  const urlWithProtocol = /^[a-z][a-z\d+.-]*:\/\//i.test(trimmedUrl)
    ? trimmedUrl
    : `https://${trimmedUrl}`;

  let parsedUrl: URL;

  try {
    parsedUrl = new URL(urlWithProtocol);
  } catch {
    throw new BadRequestException("Informe uma URL valida da loja.");
  }

  if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
    throw new BadRequestException("Informe uma URL http ou https.");
  }

  if (!parsedUrl.hostname.includes(".")) {
    throw new BadRequestException("Informe o dominio completo da loja.");
  }

  parsedUrl.hash = "";

  if (parsedUrl.pathname === "/") {
    parsedUrl.pathname = "/";
  }

  return parsedUrl.toString();
}

@Injectable()
export class ScansService {
  constructor(private readonly prisma: PrismaService) {}

  private async resolveUserId(input: {
    userId: string;
    userEmail?: string;
    userName?: string;
  }) {
    const userById = await this.prisma.user.findUnique({
      where: {
        id: input.userId,
      },
      select: {
        id: true,
      },
    });

    if (userById) {
      return userById.id;
    }

    const email = input.userEmail?.trim();

    if (email) {
      const userByEmail = await this.prisma.user.findUnique({
        where: {
          email,
        },
        select: {
          id: true,
        },
      });

      if (userByEmail) {
        return userByEmail.id;
      }
    }

    const createdUser = await this.prisma.user.create({
      data: {
        id: input.userId,
        email: email || fallbackUserEmail(input.userId),
        name: input.userName?.trim() || null,
      },
      select: {
        id: true,
      },
    });

    return createdUser.id;
  }

  async listScans(input: AuthUserInput) {
    assertAuthenticated(input.userId);
    const userId = await this.resolveUserId({
      userId: input.userId,
      userEmail: input.userEmail,
      userName: input.userName,
    });

    return this.prisma.scan.findMany({
      where: {
        requestedByUserId: userId,
      },
      orderBy: {
        queuedAt: "desc",
      },
      take: 25,
      include: {
        store: {
          select: {
            platform: true,
            name: true,
            url: true,
          },
        },
        report: true,
      },
    });
  }

  async createScan(input: CreateScanInput) {
    assertAuthenticated(input.userId);
    const userId = await this.resolveUserId({
      userId: input.userId,
      userEmail: input.userEmail,
      userName: input.userName,
    });

    const normalizedUrl = normalizeScannableUrl(input.url);
    const storePlatform = await inferStorePlatform(normalizedUrl);
    const financialAssumptions = normalizeFinancialAssumptions(
      input.financialAssumptions,
    );
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

    if (env.ENABLE_RECENT_SCAN_REUSE) {
      const reuseWindowStart = new Date(
        Date.now() - env.RECENT_SCAN_REUSE_WINDOW_MINUTES * 60 * 1000,
      );

      const recentScan = await this.prisma.scan.findFirst({
        where: {
          storeId: resolvedStoreId,
          url: normalizedUrl,
          requestedByUserId: userId,
          status: ScanStatus.COMPLETED,
          finishedAt: {
            gte: reuseWindowStart,
          },
        },
        orderBy: {
          finishedAt: "desc",
        },
        select: {
          id: true,
          status: true,
          finishedAt: true,
          report: {
            select: {
              summary: true,
            },
          },
        },
      });

      const recentScanAssumptions = getSummaryLossAssumptions(
        recentScan?.report?.summary,
      );

      if (
        recentScan &&
        financialAssumptionsMatch(financialAssumptions, recentScanAssumptions)
      ) {
        return {
          scanId: recentScan.id,
          status: recentScan.status,
          platform: storePlatform,
          reused: true,
          reusedFinishedAt: recentScan.finishedAt,
          reuseWindowMinutes: env.RECENT_SCAN_REUSE_WINDOW_MINUTES,
          message: `Ja existe um diagnostico concluido para esta URL nos ultimos ${env.RECENT_SCAN_REUSE_WINDOW_MINUTES} minutos com as mesmas premissas financeiras. O resultado do historico foi reutilizado.`,
        };
      }
    }

    const scan = await this.prisma.scan.create({
      data: {
        storeId: resolvedStoreId,
        requestedByUserId: userId,
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
        storePlatform,
        financialAssumptions,
        metaAds: input.metaAds,
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
      platform: storePlatform,
      reused: false,
      message: null,
    };
  }

  async getScanById(scanId: string, input: AuthUserInput) {
    assertAuthenticated(input.userId);
    const userId = await this.resolveUserId({
      userId: input.userId,
      userEmail: input.userEmail,
      userName: input.userName,
    });

    const scan = await this.prisma.scan.findFirst({
      where: {
        id: scanId,
        requestedByUserId: userId,
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
