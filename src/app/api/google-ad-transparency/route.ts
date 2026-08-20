import { chromium, type Browser, type Page } from "playwright";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const DEFAULT_REGION = "BR";
const NAVIGATION_TIMEOUT_MS = 45000;
const SCROLL_ROUNDS = 5;

function normalizeStoreDomain(rawUrl: string) {
  const trimmedUrl = rawUrl.trim();
  const parsedUrl = new URL(
    /^[a-z][a-z\d+.-]*:\/\//i.test(trimmedUrl)
      ? trimmedUrl
      : `https://${trimmedUrl}`,
  );

  if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
    throw new Error("Invalid protocol");
  }

  return getRegistrableDomain(parsedUrl.hostname);
}

function getRegistrableDomain(hostname: string) {
  const normalizedHostname = hostname.toLowerCase().replace(/\.$/, "").replace(/^www\./, "");
  const parts = normalizedHostname.split(".").filter(Boolean);

  if (parts.length <= 2) {
    return normalizedHostname;
  }

  const secondLevelSuffixes = new Set([
    "com.br",
    "net.br",
    "org.br",
    "co.uk",
    "com.au",
    "com.ar",
    "com.mx",
    "com.co",
  ]);
  const suffix = parts.slice(-2).join(".");

  return secondLevelSuffixes.has(suffix)
    ? parts.slice(-3).join(".")
    : parts.slice(-2).join(".");
}

function buildGoogleAdTransparencyUrl(domain: string) {
  const params = new URLSearchParams({
    region: process.env.GOOGLE_AD_TRANSPARENCY_REGION ?? DEFAULT_REGION,
    domain,
  });

  return `https://adstransparency.google.com/?${params.toString()}`;
}

function normalizeScrapedText(value: string) {
  return value
    .replace(/\u00a0/g, " ")
    .replace(/\\u0025/g, "%")
    .replace(/\\u0026/g, "&")
    .replace(/\\u002F/g, "/")
    .replace(/\\\//g, "/")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function extractVisibleCount(text: string) {
  const normalizedText = normalizeScrapedText(text)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\./g, "")
    .replace(/,/g, "");
  const countPatterns = [
    /(\d+)\s+anuncios/i,
    /(\d+)\s+ads/i,
  ];

  for (const pattern of countPatterns) {
    const match = normalizedText.match(pattern);

    if (match) {
      return Number(match[1]);
    }
  }

  return null;
}

function extractAdvertisers(text: string) {
  const normalizedText = normalizeScrapedText(text);
  const advertisers = new Set<string>();
  const advertiserPatterns = [
    /([A-Z0-9][A-Z0-9 .,&'/-]{2,})\s+Verificado/g,
    /([A-Z0-9][A-Z0-9 .,&'/-]{2,})\s+Verified/g,
  ];

  for (const pattern of advertiserPatterns) {
    for (const match of normalizedText.matchAll(pattern)) {
      const advertiser = match[1].replace(/\s+/g, " ").trim();

      if (advertiser.length <= 80) {
        advertisers.add(advertiser);
      }
    }
  }

  return Array.from(advertisers).slice(0, 10);
}

function hasNoResultsSignal(text: string) {
  return /nenhum anuncio|nenhum resultado|0 anuncios|no ads|no results/i.test(text);
}

function detectScrapingBlock(text: string) {
  return /captcha|unusual traffic|blocked|bloqueado|nao foi possivel verificar|não foi possível verificar/i.test(
    text,
  );
}

async function scrollResults(page: Page) {
  for (let index = 0; index < SCROLL_ROUNDS; index += 1) {
    await page.mouse.wheel(0, 2200);
    await page.waitForTimeout(1000);
  }
}

async function scrapeGoogleAdTransparencySearch(page: Page, domain: string) {
  const searchUrl = buildGoogleAdTransparencyUrl(domain);

  await page.goto(searchUrl, {
    waitUntil: "domcontentloaded",
    timeout: NAVIGATION_TIMEOUT_MS,
  });
  await page.waitForLoadState("networkidle", { timeout: 18000 }).catch(() => {});
  await page.waitForTimeout(3500);
  await scrollResults(page);

  const extracted = await page.evaluate(() => {
    const links = Array.from(document.querySelectorAll("a[href]")).map(
      (node) => (node as HTMLAnchorElement).href,
    );

    return {
      html: document.documentElement.innerHTML,
      links,
      text: document.body.innerText,
      title: document.title,
    };
  });
  const combinedText = [
    extracted.title,
    extracted.text,
    extracted.links.join("\n"),
    extracted.html,
  ].join("\n");
  const visibleCount = extractVisibleCount(extracted.text);
  const advertisers = extractAdvertisers(extracted.text);

  if (typeof visibleCount === "number") {
    return {
      activeAdsCount: visibleCount,
      advertisers,
      searchUrl,
    };
  }

  if (hasNoResultsSignal(combinedText)) {
    return {
      activeAdsCount: 0,
      advertisers: [],
      searchUrl,
    };
  }

  if (detectScrapingBlock(combinedText)) {
    throw new Error("A Central de transparencia bloqueou a consulta automatizada.");
  }

  throw new Error("Central de transparencia carregou, mas nao expos anuncios parseaveis.");
}

async function scrapeGoogleAdTransparency(domain: string) {
  let browser: Browser | null = null;

  try {
    browser = await chromium.launch({
      headless: true,
      args: ["--disable-dev-shm-usage", "--no-sandbox"],
    });
    const context = await browser.newContext({
      locale: "pt-BR",
      userAgent:
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36",
      viewport: {
        width: 1365,
        height: 900,
      },
    });
    const page = await context.newPage();

    page.setDefaultTimeout(NAVIGATION_TIMEOUT_MS);

    return await scrapeGoogleAdTransparencySearch(page, domain);
  } finally {
    await browser?.close();
  }
}

function formatScrapingError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);

  if (/Executable doesn't exist|browserType.launch/i.test(message)) {
    return "Playwright Chromium nao esta instalado. Rode `pnpm exec playwright install chromium` e tente novamente.";
  }

  if (/Timeout|timed out/i.test(message)) {
    return "A consulta de anuncios ativos demorou demais. Tente novamente em alguns minutos.";
  }

  return message;
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const rawUrl = searchParams.get("url");

  if (!rawUrl) {
    return NextResponse.json(
      { message: "Informe a URL da loja." },
      { status: 400 },
    );
  }

  let domain: string;

  try {
    domain = normalizeStoreDomain(rawUrl);
  } catch {
    return NextResponse.json(
      { message: "Informe uma URL http ou https valida." },
      { status: 400 },
    );
  }

  try {
    const result = await scrapeGoogleAdTransparency(domain);

    return NextResponse.json({
      activeAdsCount: result.activeAdsCount,
      advertisers: result.advertisers,
      configured: true,
      domain,
      estimated: true,
      message: "Contagem estimada a partir da Central de transparencia do Google.",
      searchUrl: result.searchUrl,
      source: "scraping",
    });
  } catch (error) {
    const message = formatScrapingError(error);

    console.error("Google ads collection failed", message);

    return NextResponse.json(
      {
        activeAdsCount: null,
        advertisers: [],
        configured: true,
        domain,
        message,
        source: "scraping",
      },
      { status: 502 },
    );
  }
}
