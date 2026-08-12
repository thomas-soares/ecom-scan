import { chromium, type Page, type Request } from "playwright";

export type DetectionName =
  | "META"
  | "GOOGLE"
  | "TIKTOK"
  | "PINTEREST"
  | "SNAPCHAT";

export type EventName = "PAGE_VIEW" | "ADD_TO_CART" | "INITIATE_CHECKOUT";

type ValidationState = "PASS" | "WARNING";
type StorePlatformName = "SHOPIFY" | "NUVEMSHOP" | "VTEX" | "TRAY" | "OTHER";

type FinancialAssumptions = {
  monthlyTraffic?: number;
  averageOrderValueCents?: number;
  baseConversionRate?: number;
};

export type ScanOutput = {
  detections: Array<{
    platform: DetectionName;
    isDetected: boolean;
    evidence?: string;
    details?: Record<string, unknown>;
  }>;
  events: Array<{
    event: EventName;
    status: ValidationState;
    details: string;
    metadata?: Record<string, unknown>;
  }>;
  findings: Array<{
    category: "TRACKING" | "PERFORMANCE" | "APPS";
    severity: "LOW" | "MEDIUM" | "HIGH";
    title: string;
    description: string;
    impactScore: number;
  }>;
  estimatedMonthlyLossCents: number;
  summary: {
    totalScripts: number;
    loadTimeMs: number;
    domain: {
      hostname: string;
      registrableDomain: string;
      expiresAt: string | null;
      daysUntilExpiration: number | null;
      registrar: string | null;
      lookupStatus: "FOUND" | "NOT_FOUND" | "FAILED";
      source: "RDAP";
    };
    ecommerce: {
      detected: boolean;
      platform: StorePlatformName;
      productHandle: string | null;
      productUrl: string | null;
      checkoutUrl: string | null;
      addToCartMethod: string | null;
      checkoutMethod: string | null;
    };
    performance: {
      ttfbMs: number | null;
      domContentLoadedMs: number | null;
      totalRequests: number;
      totalTransferKb: number;
      scriptTransferKb: number;
      imageTransferKb: number;
      consoleErrors: number;
    };
    images: {
      total: number;
      oversized: number;
      missingLazyLoading: number;
      legacyFormats: number;
    };
    apps: {
      detected: Array<{
        name: string;
        evidence: string;
      }>;
      totalExternalScripts: number;
    };
    tracking: {
      requests: Array<{
        platform: DetectionName;
        url: string;
        event: string | null;
        payloadQuality: "complete" | "partial" | "missing";
      }>;
    };
    lossAssumptions: {
      monthlyTraffic: number;
      averageOrderValueCents: number;
      baseConversionRate: number;
      severityConversionDrag: number;
    };
  };
};

const detectionRules: Record<DetectionName, RegExp> = {
  META: /(connect\.facebook\.net|facebook\.com\/tr|fbq\()/i,
  GOOGLE:
    /(gtag\(|googletagmanager\.com|google-analytics\.com|googleadservices\.com|analytics\.google\.com)/i,
  TIKTOK: /(analytics\.tiktok\.com|business-api\.tiktok\.com|ttq\()/i,
  PINTEREST: /(ct\.pinterest\.com|pinimg\.com|pintrk\()/i,
  SNAPCHAT: /(sc-static\.net|tr\.snapchat\.com|snaptr\()/i,
};

const appRules = [
  { name: "Klaviyo", pattern: /klaviyo/i },
  { name: "Yotpo", pattern: /yotpo/i },
  { name: "Recharge", pattern: /rechargeapps|rechargepayments/i },
  { name: "Gorgias", pattern: /gorgias/i },
  { name: "Judge.me", pattern: /judge\.me|judgeme/i },
  { name: "Loox", pattern: /loox/i },
  { name: "Stamped", pattern: /stamped/i },
  { name: "Privy", pattern: /privy/i },
  { name: "Shopify Reviews", pattern: /shopify-product-reviews/i },
  { name: "AfterShip", pattern: /aftership/i },
  { name: "Hotjar", pattern: /hotjar/i },
  { name: "Microsoft Clarity", pattern: /clarity\.ms/i },
];

const eventPatterns: Record<EventName, RegExp[]> = {
  PAGE_VIEW: [/PageView/i, /page_view/i, /collect\?/i, /\/tr\?/i],
  ADD_TO_CART: [/AddToCart/i, /add_to_cart/i, /addToCart/i],
  INITIATE_CHECKOUT: [/InitiateCheckout/i, /begin_checkout/i, /checkout/i],
};

export type ScanOptions = {
  disabledPlatforms?: DetectionName[];
  storePlatform?: StorePlatformName;
  financialAssumptions?: FinancialAssumptions;
};

type RdapBootstrapResponse = {
  services?: Array<[string[], string[]]>;
};

type RdapDomainResponse = {
  events?: Array<{
    eventAction?: string;
    eventDate?: string;
  }>;
  entities?: Array<{
    roles?: string[];
    vcardArray?: [
      string,
      Array<[string, Record<string, unknown>, string, string]>,
    ];
  }>;
};

type NetworkEntry = {
  url: string;
  resourceType: string;
  method: string;
  postData: string | null;
};

type ResourceMetric = {
  name: string;
  initiatorType: string;
  transferSize: number;
  encodedBodySize: number;
  responseStart: number;
  startTime: number;
};

type ImageAudit = {
  total: number;
  oversized: number;
  missingLazyLoading: number;
  legacyFormats: number;
  samples: string[];
};

const COMMON_SECOND_LEVEL_SUFFIXES = new Set([
  "com.br",
  "net.br",
  "org.br",
  "ind.br",
  "inf.br",
  "eco.br",
  "app.br",
  "dev.br",
  "blog.br",
  "shop.br",
  "store.br",
  "co.uk",
  "com.au",
  "com.ar",
  "com.mx",
  "com.co",
]);

function getRegistrableDomain(hostname: string) {
  const normalizedHostname = hostname
    .toLowerCase()
    .replace(/\.$/, "")
    .replace(/^www\./, "");
  const parts = normalizedHostname.split(".").filter(Boolean);

  if (parts.length < 2) {
    return normalizedHostname;
  }

  const twoPartSuffix = parts.slice(-2).join(".");

  if (parts.length >= 3 && COMMON_SECOND_LEVEL_SUFFIXES.has(twoPartSuffix)) {
    return parts.slice(-3).join(".");
  }

  return parts.slice(-2).join(".");
}

async function fetchJson<T>(url: string, timeoutMs = 6000): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        accept: "application/json",
        "user-agent": "EcomScan/0.1 RDAP lookup",
      },
    });

    if (!response.ok) {
      throw new Error(`RDAP request failed with ${response.status}`);
    }

    return (await response.json()) as T;
  } finally {
    clearTimeout(timeout);
  }
}

function findRdapBaseUrl(
  bootstrap: RdapBootstrapResponse,
  topLevelDomain: string,
) {
  const service = bootstrap.services?.find(([tlds]) =>
    tlds.some((tld) => tld.toLowerCase() === topLevelDomain),
  );

  return service?.[1]?.[0] ?? null;
}

function getRegistrarName(domain: RdapDomainResponse) {
  const registrarEntity = domain.entities?.find((entity) =>
    entity.roles?.some((role) => role.toLowerCase() === "registrar"),
  );
  const vcardItems = registrarEntity?.vcardArray?.[1] ?? [];
  const nameItem = vcardItems.find(([key]) => key.toLowerCase() === "fn");

  return nameItem?.[3] ?? null;
}

function getExpirationDate(domain: RdapDomainResponse) {
  const expirationEvent = domain.events?.find((event) => {
    const action = event.eventAction?.toLowerCase() ?? "";

    return action === "expiration" || action === "expiry";
  });

  if (!expirationEvent?.eventDate) {
    return null;
  }

  const expiresAt = new Date(expirationEvent.eventDate);

  if (Number.isNaN(expiresAt.getTime())) {
    return null;
  }

  return expiresAt;
}

async function lookupDomainExpiration(url: string): Promise<
  ScanOutput["summary"]["domain"]
> {
  const hostname = new URL(url).hostname;
  const registrableDomain = getRegistrableDomain(hostname);
  const topLevelDomain = registrableDomain.split(".").at(-1);
  const fallback = {
    hostname,
    registrableDomain,
    expiresAt: null,
    daysUntilExpiration: null,
    registrar: null,
    lookupStatus: "FAILED" as const,
    source: "RDAP" as const,
  };

  if (!topLevelDomain) {
    return fallback;
  }

  try {
    const bootstrap = await fetchJson<RdapBootstrapResponse>(
      "https://data.iana.org/rdap/dns.json",
    );
    const rdapBaseUrl = findRdapBaseUrl(bootstrap, topLevelDomain);

    if (!rdapBaseUrl) {
      return {
        ...fallback,
        lookupStatus: "NOT_FOUND",
      };
    }

    const domainUrl = new URL(
      `domain/${encodeURIComponent(registrableDomain)}`,
      rdapBaseUrl.endsWith("/") ? rdapBaseUrl : `${rdapBaseUrl}/`,
    );
    const domain = await fetchJson<RdapDomainResponse>(domainUrl.toString());
    const expiresAt = getExpirationDate(domain);

    return {
      hostname,
      registrableDomain,
      expiresAt: expiresAt?.toISOString() ?? null,
      daysUntilExpiration: expiresAt
        ? Math.ceil((expiresAt.getTime() - Date.now()) / 86_400_000)
        : null,
      registrar: getRegistrarName(domain),
      lookupStatus: expiresAt ? "FOUND" : "NOT_FOUND",
      source: "RDAP",
    };
  } catch {
    return fallback;
  }
}

function extractIds(platform: DetectionName, text: string) {
  if (platform === "META") {
    return Array.from(
      new Set([
        ...Array.from(text.matchAll(/fbq\(['"]init['"],\s*['"](\d+)['"]/gi)).map(
          (match) => match[1],
        ),
        ...Array.from(text.matchAll(/[?&]id=(\d{8,})/gi)).map(
          (match) => match[1],
        ),
      ]),
    );
  }

  if (platform === "GOOGLE") {
    return Array.from(
      new Set(
        Array.from(
          text.matchAll(/\b(GTM-[A-Z0-9]+|G-[A-Z0-9]+|AW-\d+|UA-\d+-\d+)\b/gi),
        ).map((match) => match[1]),
      ),
    );
  }

  return [];
}

function parseRequestPayload(entry: NetworkEntry) {
  const payload: Record<string, string> = {};

  try {
    const parsedUrl = new URL(entry.url);

    for (const [key, value] of parsedUrl.searchParams.entries()) {
      payload[key] = value;
    }
  } catch {
    // Keep the payload collected so far.
  }

  if (!entry.postData) {
    return payload;
  }

  try {
    const body = JSON.parse(entry.postData) as unknown;

    if (body && typeof body === "object" && !Array.isArray(body)) {
      for (const [key, value] of Object.entries(body)) {
        if (typeof value === "string" || typeof value === "number") {
          payload[key] = String(value);
        }
      }
    }
  } catch {
    try {
      const params = new URLSearchParams(entry.postData);

      for (const [key, value] of params.entries()) {
        payload[key] = value;
      }
    } catch {
      payload.rawBody = entry.postData.slice(0, 500);
    }
  }

  return payload;
}

function normalizeEventName(value: string | null | undefined): EventName | null {
  if (!value) {
    return null;
  }

  const normalized = value.toLowerCase();

  if (
    normalized.includes("pageview") ||
    normalized === "page_view" ||
    normalized === "pageview"
  ) {
    return "PAGE_VIEW";
  }

  if (
    normalized.includes("addtocart") ||
    normalized === "add_to_cart" ||
    normalized === "add-to-cart"
  ) {
    return "ADD_TO_CART";
  }

  if (
    normalized.includes("initiatecheckout") ||
    normalized === "begin_checkout" ||
    normalized === "checkout" ||
    normalized === "initiate_checkout"
  ) {
    return "INITIATE_CHECKOUT";
  }

  return null;
}

function detectEventFromEntry(entry: NetworkEntry) {
  const payload = parseRequestPayload(entry);
  const explicitEvent = normalizeEventName(
    payload.ev ?? payload.en ?? payload.event ?? payload.event_name ?? payload.name,
  );

  if (explicitEvent) {
    return explicitEvent;
  }

  for (const [event, patterns] of Object.entries(eventPatterns) as Array<
    [EventName, RegExp[]]
  >) {
    if (patterns.some((pattern) => pattern.test(entry.url) || pattern.test(entry.postData ?? ""))) {
      return event;
    }
  }

  return null;
}

function validatePayloadQuality(
  platform: DetectionName,
  event: EventName | null,
  payload: Record<string, string>,
) {
  if (!event) {
    return {
      quality: "missing" as const,
      missing: ["event_name"],
      present: Object.keys(payload),
    };
  }

  const commonKeys =
    platform === "META"
      ? ["id", "ev"]
      : platform === "GOOGLE"
        ? ["tid", "en"]
        : ["event"];
  const conversionKeys =
    event === "PAGE_VIEW"
      ? []
      : ["currency", "value", "content_ids", "items", "item_id", "product_id"];
  const hasCommon = commonKeys.some((key) => Boolean(payload[key]));
  const hasValue =
    event === "PAGE_VIEW" ||
    ["value", "price", "revenue"].some((key) => Boolean(payload[key]));
  const hasCurrency =
    event === "PAGE_VIEW" ||
    ["currency", "cu"].some((key) => Boolean(payload[key]));
  const hasItem =
    event === "PAGE_VIEW" ||
    conversionKeys.some((key) => Boolean(payload[key]));
  const missing = [
    !hasCommon ? "tracking_id_or_event_name" : null,
    !hasValue ? "value" : null,
    !hasCurrency ? "currency" : null,
    !hasItem ? "product_or_item_id" : null,
  ].filter((item): item is string => Boolean(item));

  return {
    quality:
      missing.length === 0
        ? ("complete" as const)
        : missing.length <= 2
          ? ("partial" as const)
          : ("missing" as const),
    missing,
    present: Object.keys(payload),
  };
}

function platformFromRequest(url: string): DetectionName | null {
  const found = (Object.keys(detectionRules) as DetectionName[]).find(
    (platform) => detectionRules[platform].test(url),
  );

  return found ?? null;
}

function getTrackingRequests(networkEntries: NetworkEntry[]) {
  return networkEntries
    .map((entry) => {
      const platform = platformFromRequest(entry.url);

      if (!platform) {
        return null;
      }

      const payload = parseRequestPayload(entry);
      const event = detectEventFromEntry(entry);
      const payloadValidation = validatePayloadQuality(platform, event, payload);

      return {
        platform,
        url: entry.url,
        event,
        payload,
        payloadValidation,
      };
    })
    .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry));
}

function requestEvidence(url: string) {
  try {
    const parsed = new URL(url);
    return `${parsed.hostname}${parsed.pathname}`;
  } catch {
    return url.slice(0, 120);
  }
}

async function getShopifyProductHandle(baseUrl: string) {
  try {
    const productsUrl = new URL("/products.json?limit=1", baseUrl).toString();
    const response = await fetch(productsUrl, {
      headers: {
        accept: "application/json",
        "user-agent": "EcomScan/0.1 product lookup",
      },
      signal: AbortSignal.timeout(8000),
    });

    if (!response.ok) {
      return null;
    }

    const data = (await response.json()) as {
      products?: Array<{ handle?: string }>;
    };

    return data.products?.[0]?.handle ?? null;
  } catch {
    return null;
  }
}

async function findProductUrl(
  page: Page,
  baseUrl: string,
  shopifyHandle: string | null,
  platform: StorePlatformName,
) {
  if (shopifyHandle) {
    return new URL(`/products/${shopifyHandle}`, baseUrl).toString();
  }

  const productPatterns = [
    ...getStrategy(platform).productPatterns,
    ...ecommerceStrategies.OTHER.productPatterns,
  ].map((pattern) => pattern.source);

  return page.evaluate((patternSources) => {
    const productHrefPatterns = patternSources.map(
      (source) => new RegExp(source, "i"),
    );
    const anchors = Array.from(document.querySelectorAll<HTMLAnchorElement>("a[href]"));
    const productLink = anchors.find((anchor) => {
      const href = anchor.href;
      const text = anchor.textContent?.toLowerCase() ?? "";

      if (!href || href.includes("#") || href.startsWith("mailto:")) {
        return false;
      }

      return (
        productHrefPatterns.some((pattern) => pattern.test(href)) ||
        /\b(comprar|ver produto|produto)\b/i.test(text)
      );
    });

    return productLink?.href ?? null;
  }, productPatterns);
}

const ecommerceStrategies: Record<
  StorePlatformName,
  {
    productPatterns: RegExp[];
    addToCartSelectors: string[];
    checkoutSelectors: string[];
  }
> = {
  SHOPIFY: {
    productPatterns: [/\/products\//i],
    addToCartSelectors: [
      'form[action*="/cart/add"] button[type="submit"]',
      'button[name="add"]',
      '[data-add-to-cart]',
      '[data-testid*="add-to-cart"]',
    ],
    checkoutSelectors: [
      'a[href*="/checkout"]',
      'button[name="checkout"]',
      'form[action*="/cart"] button[type="submit"]',
    ],
  },
  NUVEMSHOP: {
    productPatterns: [/\/produtos?\//i, /\/p\//i],
    addToCartSelectors: [
      '[data-store*="product-buy-button"]',
      '[data-component="product.add-to-cart"]',
      'input[name="add_to_cart"]',
    ],
    checkoutSelectors: [
      'a[href*="/checkout"]',
      'a[href*="/comprar"]',
      'button:has-text("Finalizar compra")',
    ],
  },
  VTEX: {
    productPatterns: [/\/p$/i, /\/p\?/i, /\/produto\//i],
    addToCartSelectors: [
      '.vtex-add-to-cart-button-0-x-buttonText',
      'button[class*="add-to-cart"]',
      'button:has-text("Adicionar ao carrinho")',
    ],
    checkoutSelectors: [
      'a[href*="/checkout"]',
      'a[href*="/cart"]',
      'button:has-text("Fechar pedido")',
    ],
  },
  TRAY: {
    productPatterns: [/\/produto\//i, /\/produtos?\//i],
    addToCartSelectors: [
      'button[class*="botao-comprar"]',
      'button[class*="buy"]',
      'input[value*="Comprar"]',
    ],
    checkoutSelectors: [
      'a[href*="/checkout"]',
      'a[href*="/finalizar"]',
      'button:has-text("Finalizar compra")',
    ],
  },
  OTHER: {
    productPatterns: [/\/products\//i, /\/produto\//i, /\/produtos\//i, /\/p(\/|-|\?)/i],
    addToCartSelectors: [],
    checkoutSelectors: [],
  },
};

function getStrategy(platform: StorePlatformName) {
  return ecommerceStrategies[platform] ?? ecommerceStrategies.OTHER;
}

function uniqueSelectors(platform: StorePlatformName, kind: "add" | "checkout") {
  const strategy = getStrategy(platform);
  const genericAdd = [
    'button:has-text("Adicionar")',
    'button:has-text("Adicionar ao carrinho")',
    'button:has-text("Comprar")',
    'button:has-text("Add to cart")',
    'button:has-text("Comprar agora")',
    'a:has-text("Comprar")',
  ];
  const genericCheckout = [
    'a[href*="/checkout"]',
    'a[href*="/finalizar"]',
    'a[href*="/carrinho"]',
    'a[href*="/cart"]',
    'button[name="checkout"]',
    'button:has-text("Checkout")',
    'button:has-text("Finalizar")',
    'button:has-text("Finalizar compra")',
    'button:has-text("Comprar agora")',
  ];

  return Array.from(
    new Set([
      ...(kind === "add" ? strategy.addToCartSelectors : strategy.checkoutSelectors),
      ...(kind === "add" ? genericAdd : genericCheckout),
    ]),
  );
}

async function clickFirstVisible(page: Page, selectors: string[]) {
  for (const selector of selectors) {
    const locator = page.locator(selector).first();

    try {
      if ((await locator.count()) > 0 && (await locator.isVisible())) {
        await locator.click({ timeout: 5000 });
        return selector;
      }
    } catch {
      // Try the next likely selector.
    }
  }

  return null;
}

async function auditImages(page: Page): Promise<ImageAudit> {
  return page.evaluate(() => {
    const images = Array.from(document.images).map((image) => {
      const source = image.currentSrc || image.src;
      const renderedWidth = image.clientWidth || image.width;
      const renderedHeight = image.clientHeight || image.height;
      const naturalWidth = image.naturalWidth;
      const naturalHeight = image.naturalHeight;
      const oversized =
        renderedWidth > 0 &&
        renderedHeight > 0 &&
        (naturalWidth > renderedWidth * 2 || naturalHeight > renderedHeight * 2);
      const loading = image.getAttribute("loading");
      const isLikelyAboveFold = image.getBoundingClientRect().top < innerHeight;
      const legacyFormat = /\.(jpe?g|png)(\?|$)/i.test(source);

      return {
        source,
        oversized,
        missingLazyLoading: !isLikelyAboveFold && loading !== "lazy",
        legacyFormat,
      };
    });

    return {
      total: images.length,
      oversized: images.filter((image) => image.oversized).length,
      missingLazyLoading: images.filter((image) => image.missingLazyLoading)
        .length,
      legacyFormats: images.filter((image) => image.legacyFormat).length,
      samples: images
        .filter(
          (image) =>
            image.oversized || image.missingLazyLoading || image.legacyFormat,
        )
        .slice(0, 5)
        .map((image) => image.source),
    };
  });
}

async function getResourceMetrics(page: Page) {
  return page.evaluate(() =>
    performance.getEntriesByType("resource").map((entry) => {
      const resource = entry as PerformanceResourceTiming;

      return {
        name: resource.name,
        initiatorType: resource.initiatorType,
        transferSize: resource.transferSize || 0,
        encodedBodySize: resource.encodedBodySize || 0,
        responseStart: resource.responseStart || 0,
        startTime: resource.startTime || 0,
      };
    }),
  ) as Promise<ResourceMetric[]>;
}

async function getNavigationMetrics(page: Page) {
  return page.evaluate(() => {
    const navigation = performance.getEntriesByType(
      "navigation",
    )[0] as PerformanceNavigationTiming | undefined;

    if (!navigation) {
      return {
        ttfbMs: null,
        domContentLoadedMs: null,
      };
    }

    return {
      ttfbMs: Math.round(navigation.responseStart),
      domContentLoadedMs: Math.round(navigation.domContentLoadedEventEnd),
    };
  });
}

function summarizeApps(scriptUrls: string[]) {
  const detected = appRules
    .map((rule) => {
      const evidence = scriptUrls.find((script) => rule.pattern.test(script));

      if (!evidence) {
        return null;
      }

      return {
        name: rule.name,
        evidence: requestEvidence(evidence),
      };
    })
    .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry));

  const hostnames = new Set(
    scriptUrls
      .map((script) => {
        try {
          return new URL(script).hostname;
        } catch {
          return null;
        }
      })
      .filter((hostname): hostname is string => Boolean(hostname)),
  );

  return {
    detected,
    totalExternalScripts: hostnames.size,
  };
}

function buildEventValidation(
  event: EventName,
  trackingRequests: ReturnType<typeof getTrackingRequests>,
  context: {
    clickedAddToCart: boolean;
    clickedCheckout: boolean;
    checkoutUrl: string | null;
  },
) {
  const matches = trackingRequests.filter((request) => request.event === event);

  if (matches.length > 0) {
    const completeMatches = matches.filter(
      (request) => request.payloadValidation.quality === "complete",
    );
    const bestMatch = completeMatches[0] ?? matches[0];
    const missingFields = Array.from(
      new Set(matches.flatMap((request) => request.payloadValidation.missing)),
    );

    return {
      event,
      status: completeMatches.length > 0 ? ("PASS" as const) : ("WARNING" as const),
      details:
        completeMatches.length > 0
          ? `${matches.length} request(s) confirmaram ${event} com payload suficiente.`
          : `${matches.length} request(s) confirmaram ${event}, mas faltam dados importantes: ${missingFields.join(", ")}.`,
      metadata: {
        payloadQuality: bestMatch.payloadValidation.quality,
        missingFields,
        requests: matches.slice(0, 5).map((request) => ({
          platform: request.platform,
          evidence: requestEvidence(request.url),
          event: request.event,
          payloadQuality: request.payloadValidation.quality,
          missingFields: request.payloadValidation.missing,
          presentFields: request.payloadValidation.present.slice(0, 12),
        })),
      },
    };
  }

  if (event === "ADD_TO_CART" && context.clickedAddToCart) {
    return {
      event,
      status: "WARNING" as const,
      details:
        "O clique de adicionar ao carrinho ocorreu, mas nenhum request de evento foi confirmado.",
      metadata: {
        interacted: true,
      },
    };
  }

  if (event === "INITIATE_CHECKOUT" && (context.clickedCheckout || context.checkoutUrl)) {
    return {
      event,
      status: "WARNING" as const,
      details:
        "O fluxo chegou ao checkout, mas nenhum request de evento foi confirmado.",
      metadata: {
        checkoutUrl: context.checkoutUrl,
      },
    };
  }

  return {
    event,
    status: "WARNING" as const,
    details:
      "Nao foi possivel confirmar o disparo do evento durante a navegacao automatizada.",
    metadata: {},
  };
}

function createFindings(input: {
  detections: ScanOutput["detections"];
  events: ScanOutput["events"];
  loadTimeMs: number;
  performance: ScanOutput["summary"]["performance"];
  images: ImageAudit;
  apps: ScanOutput["summary"]["apps"];
  domain: ScanOutput["summary"]["domain"];
}) {
  const findings: ScanOutput["findings"] = [];
  const missingPrimaryTracking = input.detections.filter(
    (detection) =>
      (detection.platform === "META" || detection.platform === "GOOGLE") &&
      !detection.isDetected,
  );
  const warningEvents = input.events.filter((event) => event.status !== "PASS");

  if (missingPrimaryTracking.length > 0) {
    findings.push({
      category: "TRACKING",
      severity: missingPrimaryTracking.length >= 2 ? "HIGH" : "MEDIUM",
      title: "Pixels principais incompletos",
      description:
        "Meta e Google sao canais prioritarios para a V1; ao menos um deles nao foi detectado com evidencia suficiente.",
      impactScore: missingPrimaryTracking.length * 18,
    });
  }

  if (warningEvents.length > 0) {
    findings.push({
      category: "TRACKING",
      severity: warningEvents.length >= 2 ? "HIGH" : "MEDIUM",
      title: "Eventos de conversao sem confirmacao completa",
      description:
        "Um ou mais eventos essenciais nao tiveram disparo confirmado durante o fluxo automatizado.",
      impactScore: warningEvents.length * 14,
    });
  }

  if (input.loadTimeMs > 5000 || (input.performance.domContentLoadedMs ?? 0) > 3500) {
    findings.push({
      category: "PERFORMANCE",
      severity: input.loadTimeMs > 8000 ? "HIGH" : "MEDIUM",
      title: "Carregamento inicial lento",
      description:
        "A pagina demorou alem do esperado para carregar e estabilizar os recursos iniciais.",
      impactScore: input.loadTimeMs > 8000 ? 20 : 12,
    });
  }

  if (input.performance.scriptTransferKb > 900) {
    findings.push({
      category: "PERFORMANCE",
      severity: input.performance.scriptTransferKb > 1600 ? "HIGH" : "MEDIUM",
      title: "JavaScript pesado",
      description:
        "O volume transferido de scripts pode estar atrasando a renderizacao e a interacao.",
      impactScore: input.performance.scriptTransferKb > 1600 ? 18 : 10,
    });
  }

  if (input.images.oversized > 0 || input.images.missingLazyLoading > 3) {
    findings.push({
      category: "PERFORMANCE",
      severity: input.images.oversized > 4 ? "HIGH" : "MEDIUM",
      title: "Imagens com oportunidade de otimizacao",
      description:
        "Foram encontradas imagens maiores que o necessario ou sem carregamento sob demanda.",
      impactScore: Math.min(20, input.images.oversized * 4 + input.images.missingLazyLoading),
    });
  }

  if (input.apps.totalExternalScripts > 18 || input.apps.detected.length > 6) {
    findings.push({
      category: "APPS",
      severity: input.apps.totalExternalScripts > 28 ? "HIGH" : "MEDIUM",
      title: "Muitos scripts externos e apps ativos",
      description:
        "A loja carrega um volume alto de scripts de terceiros, o que pode prejudicar velocidade e rastreamento.",
      impactScore: input.apps.totalExternalScripts > 28 ? 18 : 10,
    });
  }

  if (
    typeof input.domain.daysUntilExpiration === "number" &&
    input.domain.daysUntilExpiration <= 30
  ) {
    findings.push({
      category: "PERFORMANCE",
      severity: "MEDIUM",
      title: "Dominio proximo do vencimento",
      description:
        "O dominio esta proximo do vencimento e pode causar risco operacional se nao for renovado.",
      impactScore: 8,
    });
  }

  return findings;
}

function estimateMonthlyLossCents(
  findings: ScanOutput["findings"],
  inputAssumptions: FinancialAssumptions = {},
) {
  const assumptions = {
    monthlyTraffic: Math.max(0, inputAssumptions.monthlyTraffic ?? 30000),
    averageOrderValueCents: Math.max(
      0,
      inputAssumptions.averageOrderValueCents ?? 18000,
    ),
    baseConversionRate: Math.max(
      0,
      Math.min(1, inputAssumptions.baseConversionRate ?? 0.018),
    ),
    severityConversionDrag: findings.reduce((sum, finding) => {
      const severityMultiplier =
        finding.severity === "HIGH" ? 0.003 : finding.severity === "MEDIUM" ? 0.0018 : 0.0008;

      return sum + severityMultiplier * Math.max(1, finding.impactScore / 10);
    }, 0),
  };
  const cappedDrag = Math.min(
    Math.max(0.001, assumptions.baseConversionRate * 0.65),
    assumptions.severityConversionDrag,
  );
  const lostOrders = assumptions.monthlyTraffic * cappedDrag;

  return {
    cents: Math.round(lostOrders * assumptions.averageOrderValueCents),
    assumptions: {
      ...assumptions,
      severityConversionDrag: cappedDrag,
    },
  };
}

export async function runStoreScan(
  url: string,
  options: ScanOptions = {},
): Promise<ScanOutput> {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({
    viewport: {
      width: 1365,
      height: 900,
    },
  });
  const networkEntries: NetworkEntry[] = [];
  const storePlatform = options.storePlatform ?? "OTHER";
  let consoleErrors = 0;

  page.on("request", (request: Request) => {
    networkEntries.push({
      url: request.url(),
      method: request.method(),
      resourceType: request.resourceType(),
      postData: request.postData(),
    });
  });

  page.on("console", (message) => {
    if (message.type() === "error") {
      consoleErrors += 1;
    }
  });

  const startedAt = Date.now();
  let productHandle: string | null = null;
  let productUrl: string | null = null;
  let checkoutUrl: string | null = null;
  let clickedAddToCart = false;
  let clickedCheckout = false;
  let addToCartMethod: string | null = null;
  let checkoutMethod: string | null = null;

  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 });
    await page.waitForLoadState("networkidle", { timeout: 12000 }).catch(() => {});
    await page.waitForTimeout(1200);

    const productHandlePromise = getShopifyProductHandle(url);
    const html = await page.content();
    const scripts = await page
      .locator("script[src]")
      .evaluateAll((nodes) => nodes.map((n) => n.getAttribute("src") ?? ""));
    const resources = await getResourceMetrics(page);
    const navigationMetrics = await getNavigationMetrics(page);
    const imageAudit = await auditImages(page);
    productHandle = await productHandlePromise;
    productUrl = await findProductUrl(page, url, productHandle, storePlatform);

    if (productUrl) {
      await page.goto(productUrl, { waitUntil: "domcontentloaded", timeout: 45000 });
      await page.waitForLoadState("networkidle", { timeout: 12000 }).catch(() => {});
      await page.waitForTimeout(800);
    }

    addToCartMethod = await clickFirstVisible(
      page,
      uniqueSelectors(storePlatform, "add"),
    );
    clickedAddToCart = Boolean(addToCartMethod);

    if (clickedAddToCart) {
      await page.waitForTimeout(2500);
    }

    checkoutMethod = await clickFirstVisible(
      page,
      uniqueSelectors(storePlatform, "checkout"),
    );
    clickedCheckout = Boolean(checkoutMethod);

    if (clickedCheckout) {
      await page.waitForTimeout(3000);
      checkoutUrl = page.url().includes("checkout") ? page.url() : null;
    }

    if (!checkoutUrl) {
      checkoutUrl = networkEntries.find((entry) =>
        /\/checkout|checkout\.shopify\.com|\/finalizar|\/carrinho|\/cart/i.test(entry.url),
      )?.url ?? null;
    }

    const allObservedText = `${html}\n${scripts.join("\n")}\n${networkEntries
      .map((entry) => entry.url)
      .join("\n")}`;
    const disabledPlatforms = new Set(options.disabledPlatforms ?? []);
    const trackingRequests = getTrackingRequests(networkEntries);
    const detections = (Object.keys(detectionRules) as DetectionName[]).map(
      (platform) => {
        if (disabledPlatforms.has(platform)) {
          return {
            platform,
            isDetected: false,
            details: {
              status: "Desativado por feature flag.",
            },
          };
        }

        const requestMatch = trackingRequests.find(
          (request) => request.platform === platform,
        );
        const matched = allObservedText.match(detectionRules[platform]);
        const ids = extractIds(platform, allObservedText);

        return {
          platform,
          isDetected: Boolean(requestMatch || matched),
          evidence: requestMatch ? requestEvidence(requestMatch.url) : matched?.[0],
          details: {
            ids,
            observedRequests: trackingRequests
              .filter((request) => request.platform === platform)
              .slice(0, 5)
              .map((request) => ({
                event: request.event,
                evidence: requestEvidence(request.url),
              })),
          },
        };
      },
    );

    const events: ScanOutput["events"] = [
      buildEventValidation("PAGE_VIEW", trackingRequests, {
        clickedAddToCart,
        clickedCheckout,
        checkoutUrl,
      }),
      buildEventValidation("ADD_TO_CART", trackingRequests, {
        clickedAddToCart,
        clickedCheckout,
        checkoutUrl,
      }),
      buildEventValidation("INITIATE_CHECKOUT", trackingRequests, {
        clickedAddToCart,
        clickedCheckout,
        checkoutUrl,
      }),
    ];
    const loadTimeMs = Date.now() - startedAt;
    const totalTransferKb = Math.round(
      resources.reduce(
        (sum, resource) => sum + (resource.transferSize || resource.encodedBodySize),
        0,
      ) / 1024,
    );
    const scriptTransferKb = Math.round(
      resources
        .filter((resource) => resource.initiatorType === "script")
        .reduce(
          (sum, resource) => sum + (resource.transferSize || resource.encodedBodySize),
          0,
        ) / 1024,
    );
    const imageTransferKb = Math.round(
      resources
        .filter((resource) => resource.initiatorType === "img")
        .reduce(
          (sum, resource) => sum + (resource.transferSize || resource.encodedBodySize),
          0,
        ) / 1024,
    );
    const apps = summarizeApps(scripts);
    const performance = {
      ttfbMs: navigationMetrics.ttfbMs,
      domContentLoadedMs: navigationMetrics.domContentLoadedMs,
      totalRequests: networkEntries.length,
      totalTransferKb,
      scriptTransferKb,
      imageTransferKb,
      consoleErrors,
    };
    const domain = await lookupDomainExpiration(url);
    const findings = createFindings({
      detections,
      events,
      loadTimeMs,
      performance,
      images: imageAudit,
      apps,
      domain,
    });
    const estimate = estimateMonthlyLossCents(
      findings,
      options.financialAssumptions,
    );

    return {
      detections,
      events,
      findings,
      estimatedMonthlyLossCents: estimate.cents,
      summary: {
        totalScripts: scripts.length,
        loadTimeMs,
        domain,
        ecommerce: {
          detected: /Shopify|cdn\.shopify|myshopify|ShopifyAnalytics|nuvemshop|tiendanube|vtex|tray|traycdn/i.test(
            allObservedText,
          ),
          platform: storePlatform,
          productHandle,
          productUrl,
          checkoutUrl,
          addToCartMethod,
          checkoutMethod,
        },
        performance,
        images: {
          total: imageAudit.total,
          oversized: imageAudit.oversized,
          missingLazyLoading: imageAudit.missingLazyLoading,
          legacyFormats: imageAudit.legacyFormats,
        },
        apps,
        tracking: {
          requests: trackingRequests.slice(0, 25).map((request) => ({
            platform: request.platform,
            url: requestEvidence(request.url),
            event: request.event,
            payloadQuality: request.payloadValidation.quality,
          })),
        },
        lossAssumptions: estimate.assumptions,
      },
    };
  } finally {
    await browser.close();
  }
}
