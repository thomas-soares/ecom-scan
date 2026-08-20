import { chromium, type Browser, type Page } from "playwright";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const DEFAULT_REACHED_COUNTRIES = "BR";
const NAVIGATION_TIMEOUT_MS = 45000;
const SCROLL_ROUNDS = 6;

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

function buildMetaAdLibrarySearchUrl(domain: string) {
  const country =
    (process.env.META_AD_LIBRARY_COUNTRIES ?? DEFAULT_REACHED_COUNTRIES)
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean)[0] ?? "BR";
  const params = new URLSearchParams({
    active_status: "active",
    ad_type: "all",
    country,
    is_targeted_country: "false",
    media_type: "all",
    q: domain,
    search_type: "keyword_unordered",
  });

  return `https://www.facebook.com/ads/library/?${params.toString()}`;
}

function getDomainStem(domain: string) {
  return domain.split(".")[0] ?? domain;
}

function titleCase(value: string) {
  return value
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1).toLowerCase()}`)
    .join(" ");
}

function deriveBrandSearchTerm(domain: string) {
  const stem = getDomainStem(domain)
    .replace(/[-_.]+/g, " ")
    .replace(/\d+/g, " ")
    .trim()
    .toLowerCase();

  if (!stem) {
    return null;
  }

  if (stem.includes(" ")) {
    return titleCase(stem);
  }

  const suffixWords = [
    "semijoias",
    "joias",
    "modas",
    "moda",
    "calcados",
    "calçados",
    "cosmeticos",
    "cosméticos",
    "beauty",
    "store",
    "shop",
    "brasil",
  ];
  const suffix = suffixWords.find(
    (word) => stem.endsWith(word) && stem.length > word.length + 2,
  );

  if (suffix) {
    return titleCase(`${stem.slice(0, -suffix.length)} ${suffix}`);
  }

  return titleCase(stem);
}

function getSearchTerms(domain: string) {
  const brandTerm = deriveBrandSearchTerm(domain);

  return Array.from(
    new Set([
      brandTerm,
      getDomainStem(domain),
      domain,
    ].filter((term): term is string => Boolean(term))),
  );
}

function normalizeScrapedText(value: string) {
  return value
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

function detectScrapingBlock(text: string) {
  return /checkpoint|temporarily blocked|captcha|cloudflare|login to facebook|you must log in|entre no facebook|faça login|faca login/i.test(
    text,
  );
}

function hasNoResultsSignal(text: string) {
  return /no ads match|no results|nao encontramos anuncios|nenhum resultado|nenhum anuncio|0 resultados/i.test(
    text,
  );
}

function extractVisibleCount(text: string) {
  const normalizedText = normalizeScrapedText(text)
    .replace(/\u00a0/g, " ")
    .replace(/\./g, "")
    .replace(/,/g, "");
  const countPatterns = [
    /~?\s*(\d+)\s+resultados/i,
    /~?\s*(\d+)\s+results/i,
    /~?\s*(\d+)\s+anuncios/i,
    /~?\s*(\d+)\s+ads/i,
  ];

  for (const pattern of countPatterns) {
    const match = normalizedText.match(pattern);

    if (match) {
      return Number(match[1]);
    }
  }

  return null;
}

function isSpecificBrandSearch(term: string, domain: string) {
  const normalizedTerm = term.toLowerCase();

  return (
    normalizedTerm.includes(" ") ||
    normalizedTerm !== getDomainStem(domain).toLowerCase()
  );
}

function extractAdIds(text: string, domain: string) {
  const normalizedText = normalizeScrapedText(text);
  const idPatterns = [
    /ad_archive_id["'\s:=]+(\d{8,})/gi,
    /adArchiveID["'\s:=]+(\d{8,})/gi,
    /adArchiveId["'\s:=]+(\d{8,})/gi,
    /archiveID["'\s:=]+(\d{8,})/gi,
    /Library ID[:\s]+(\d{8,})/gi,
    /ID da biblioteca[:\s]+(\d{8,})/gi,
    /\/ads\/library\/\?id=(\d{8,})/gi,
    /[?&]id=(\d{8,})/gi,
  ];
  const domainVariants = Array.from(
    new Set([
      domain.toLowerCase(),
      `www.${domain.toLowerCase()}`,
      `https://${domain.toLowerCase()}`,
      `http://${domain.toLowerCase()}`,
    ]),
  );
  const ids = new Set<string>();

  for (const pattern of idPatterns) {
    for (const match of normalizedText.matchAll(pattern)) {
      const id = match[1];
      const index = match.index ?? 0;
      const snippet = normalizedText
        .slice(Math.max(0, index - 3000), index + 3000)
        .toLowerCase();

      if (domainVariants.some((variant) => snippet.includes(variant))) {
        ids.add(id);
      }
    }
  }

  return ids;
}

async function acceptCookieDialog(page: Page) {
  const labels = [
    "Allow all cookies",
    "Allow essential and optional cookies",
    "Permitir todos os cookies",
    "Permitir cookies essenciais e opcionais",
    "Aceitar todos",
    "Accept all",
  ];

  for (const label of labels) {
    const button = page.getByRole("button", { name: new RegExp(label, "i") });

    if ((await button.count()) > 0) {
      await button.first().click({ timeout: 2500 }).catch(() => {});
      return;
    }
  }
}

async function scrollResults(page: Page) {
  for (let index = 0; index < SCROLL_ROUNDS; index += 1) {
    await page.mouse.wheel(0, 2200);
    await page.waitForTimeout(1200);
  }
}

async function scrapeMetaAdLibrarySearch(page: Page, domain: string, searchTerm: string) {
  const searchUrl = buildMetaAdLibrarySearchUrl(searchTerm);

  await page.goto(searchUrl, {
    waitUntil: "domcontentloaded",
    timeout: NAVIGATION_TIMEOUT_MS,
  });
  await acceptCookieDialog(page);
  await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(2500);
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
  const adIds = extractAdIds(combinedText, domain);

  if (
    typeof visibleCount === "number" &&
    isSpecificBrandSearch(searchTerm, domain)
  ) {
    return {
      activeAdsCount: visibleCount,
      searchTerm,
      searchUrl,
      sampledAdIds: Array.from(adIds).slice(0, 10),
    };
  }

  if (adIds.size > 0) {
    return {
      activeAdsCount: adIds.size,
      searchTerm,
      searchUrl,
      sampledAdIds: Array.from(adIds).slice(0, 10),
    };
  }

  if (hasNoResultsSignal(combinedText)) {
    return {
      activeAdsCount: 0,
      searchTerm,
      searchUrl,
      sampledAdIds: [],
    };
  }

  if (detectScrapingBlock(combinedText)) {
    throw new Error("A biblioteca de anuncios bloqueou a consulta automatizada.");
  }

  throw new Error("Biblioteca de anuncios carregou, mas nao expos anuncios parseaveis.");
}

async function scrapeMetaAdLibrary(domain: string) {
  let browser: Browser | null = null;
  const searchTerms = getSearchTerms(domain);
  const failures: string[] = [];

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

    for (const searchTerm of searchTerms) {
      try {
        const result = await scrapeMetaAdLibrarySearch(page, domain, searchTerm);

        if (result.activeAdsCount > 0 || searchTerm === searchTerms.at(-1)) {
          return result;
        }
      } catch (error) {
        failures.push(
          `${searchTerm}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }

    throw new Error(failures.join(" | ") || "Nenhum termo de busca retornou dados parseaveis.");
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
    const result = await scrapeMetaAdLibrary(domain);

    return NextResponse.json({
      activeAdsCount: result.activeAdsCount,
      configured: true,
      domain,
      estimated: true,
      message: "Contagem estimada a partir da biblioteca de anuncios.",
      sampledAdIds: result.sampledAdIds,
      searchTerm: result.searchTerm,
      searchUrl: result.searchUrl,
      source: "scraping",
    });
  } catch (error) {
    const message = formatScrapingError(error);

    console.error("Ad Library collection failed", message);

    return NextResponse.json(
      {
        activeAdsCount: null,
        configured: true,
        domain,
        message,
        source: "scraping",
      },
      { status: 502 },
    );
  }
}
