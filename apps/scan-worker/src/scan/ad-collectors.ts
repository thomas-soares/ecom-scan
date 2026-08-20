import type { Browser, Page } from "playwright";

const DEFAULT_REACHED_COUNTRIES = "BR";
const DEFAULT_GOOGLE_REGION = "BR";
const NAVIGATION_TIMEOUT_MS = 45000;

type MetaAdsResult = {
  activeAdsCount: number | null;
};

type GoogleAdsResult = {
  activeAdsCount: number | null;
};

type AdCounts = {
  metaAds: MetaAdsResult;
  googleAds: GoogleAdsResult;
};

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

function getDomainFromUrl(rawUrl: string) {
  return getRegistrableDomain(new URL(rawUrl).hostname);
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

function extractGenericVisibleCount(text: string) {
  const normalizedText = normalizeScrapedText(text)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
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
    "cosmeticos",
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

function getMetaSearchTerms(domain: string) {
  const brandTerm = deriveBrandSearchTerm(domain);

  return Array.from(
    new Set([
      brandTerm,
      getDomainStem(domain),
      domain,
    ].filter((term): term is string => Boolean(term))),
  );
}

function buildMetaAdLibrarySearchUrl(searchTerm: string) {
  const country =
    (process.env.META_AD_LIBRARY_COUNTRIES ?? DEFAULT_REACHED_COUNTRIES)
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean)[0] ?? DEFAULT_REACHED_COUNTRIES;
  const params = new URLSearchParams({
    active_status: "active",
    ad_type: "all",
    country,
    is_targeted_country: "false",
    media_type: "all",
    q: searchTerm,
    search_type: "keyword_unordered",
  });

  return `https://www.facebook.com/ads/library/?${params.toString()}`;
}

function buildGoogleAdTransparencyUrl(domain: string) {
  const params = new URLSearchParams({
    region: process.env.GOOGLE_AD_TRANSPARENCY_REGION ?? DEFAULT_GOOGLE_REGION,
    domain,
  });

  return `https://adstransparency.google.com/?${params.toString()}`;
}

async function acceptMetaCookieDialog(page: Page) {
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

async function scrollResults(page: Page, rounds: number) {
  for (let index = 0; index < rounds; index += 1) {
    await page.mouse.wheel(0, 2200);
    await page.waitForTimeout(1000);
  }
}

function hasMetaNoResultsSignal(text: string) {
  return /no ads match|no results|nao encontramos anuncios|nenhum resultado|nenhum anuncio|0 resultados/i.test(
    text,
  );
}

function hasGoogleNoResultsSignal(text: string) {
  return /nenhum anuncio|nenhum resultado|0 anuncios|no ads|no results/i.test(text);
}

function detectMetaBlock(text: string) {
  return /checkpoint|temporarily blocked|captcha|cloudflare|login to facebook|you must log in|entre no facebook|faca login/i.test(
    text,
  );
}

function detectGoogleBlock(text: string) {
  return /captcha|unusual traffic|blocked|bloqueado|nao foi possivel verificar/i.test(
    text,
  );
}

function extractMetaAdIds(text: string, domain: string) {
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

function isSpecificBrandSearch(term: string, domain: string) {
  const normalizedTerm = term.toLowerCase();

  return (
    normalizedTerm.includes(" ") ||
    normalizedTerm !== getDomainStem(domain).toLowerCase()
  );
}

async function collectMetaAds(browser: Browser, domain: string): Promise<MetaAdsResult> {
  const context = await browser.newContext({
    locale: "pt-BR",
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36",
    viewport: {
      width: 1365,
      height: 900,
    },
  });

  try {
    const page = await context.newPage();
    page.setDefaultTimeout(NAVIGATION_TIMEOUT_MS);

    for (const searchTerm of getMetaSearchTerms(domain)) {
      const searchUrl = buildMetaAdLibrarySearchUrl(searchTerm);

      await page.goto(searchUrl, {
        waitUntil: "domcontentloaded",
        timeout: NAVIGATION_TIMEOUT_MS,
      });
      await acceptMetaCookieDialog(page);
      await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {});
      await page.waitForTimeout(2500);
      await scrollResults(page, 6);

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
      const visibleCount = extractGenericVisibleCount(extracted.text);

      if (
        typeof visibleCount === "number" &&
        isSpecificBrandSearch(searchTerm, domain)
      ) {
        return {
          activeAdsCount: visibleCount,
        };
      }

      const adIds = extractMetaAdIds(combinedText, domain);

      if (adIds.size > 0) {
        return {
          activeAdsCount: adIds.size,
        };
      }

      if (hasMetaNoResultsSignal(combinedText)) {
        return {
          activeAdsCount: 0,
        };
      }

      if (detectMetaBlock(combinedText)) {
        return {
          activeAdsCount: null,
        };
      }
    }

    return {
      activeAdsCount: null,
    };
  } finally {
    await context.close();
  }
}

async function collectGoogleAds(browser: Browser, domain: string): Promise<GoogleAdsResult> {
  const context = await browser.newContext({
    locale: "pt-BR",
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36",
    viewport: {
      width: 1365,
      height: 900,
    },
  });

  try {
    const page = await context.newPage();
    page.setDefaultTimeout(NAVIGATION_TIMEOUT_MS);

    await page.goto(buildGoogleAdTransparencyUrl(domain), {
      waitUntil: "domcontentloaded",
      timeout: NAVIGATION_TIMEOUT_MS,
    });
    await page.waitForLoadState("networkidle", { timeout: 18000 }).catch(() => {});
    await page.waitForTimeout(3500);
    await scrollResults(page, 5);

    const extracted = await page.evaluate(() => ({
      html: document.documentElement.innerHTML,
      text: document.body.innerText,
      title: document.title,
    }));
    const combinedText = [
      extracted.title,
      extracted.text,
      extracted.html,
    ].join("\n");
    const visibleCount = extractGenericVisibleCount(extracted.text);

    if (typeof visibleCount === "number") {
      return {
        activeAdsCount: visibleCount,
      };
    }

    if (hasGoogleNoResultsSignal(combinedText)) {
      return {
        activeAdsCount: 0,
      };
    }

    if (detectGoogleBlock(combinedText)) {
      return {
        activeAdsCount: null,
      };
    }

    return {
      activeAdsCount: null,
    };
  } finally {
    await context.close();
  }
}

export async function collectAdCounts(
  browser: Browser,
  storeUrl: string,
): Promise<AdCounts> {
  const domain = getDomainFromUrl(storeUrl);
  const [metaAds, googleAds] = await Promise.all([
    collectMetaAds(browser, domain).catch((error) => {
      console.warn(
        "Meta ads collection failed",
        error instanceof Error ? error.message : String(error),
      );

      return {
        activeAdsCount: null,
      };
    }),
    collectGoogleAds(browser, domain).catch((error) => {
      console.warn(
        "Google ads collection failed",
        error instanceof Error ? error.message : String(error),
      );

      return {
        activeAdsCount: null,
      };
    }),
  ]);

  return {
    metaAds,
    googleAds,
  };
}
