import { chromium } from "playwright";

export type DetectionName =
  | "META"
  | "GOOGLE"
  | "TIKTOK"
  | "PINTEREST"
  | "SNAPCHAT";

export type EventName = "PAGE_VIEW" | "ADD_TO_CART" | "INITIATE_CHECKOUT";

export type ScanOutput = {
  detections: Array<{
    platform: DetectionName;
    isDetected: boolean;
    evidence?: string;
    details?: string;
  }>;
  events: Array<{
    event: EventName;
    status: "PASS" | "WARNING";
    details: string;
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
  };
};

const detectionRules: Record<DetectionName, RegExp> = {
  META: /(connect\.facebook\.net|fbq\()/i,
  GOOGLE: /(gtag\(|googletagmanager\.com|google-analytics\.com)/i,
  TIKTOK: /(analytics\.tiktok\.com|ttq\()/i,
  PINTEREST: /(ct\.pinterest\.com|pintrk\()/i,
  SNAPCHAT: /(sc-static\.net|snaptr\()/i,
};

export type ScanOptions = {
  disabledPlatforms?: DetectionName[];
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

export async function runStoreScan(
  url: string,
  options: ScanOptions = {},
): Promise<ScanOutput> {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  const startedAt = Date.now();
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 });
  await page.waitForTimeout(1500);

  const html = await page.content();
  const scripts = await page
    .locator("script[src]")
    .evaluateAll((nodes) => nodes.map((n) => n.getAttribute("src") ?? ""));

  await browser.close();

  const joined = `${html}\n${scripts.join("\n")}`;
  const disabledPlatforms = new Set(options.disabledPlatforms ?? []);

  const detections = (Object.keys(detectionRules) as DetectionName[]).map(
    (platform) => {
      if (disabledPlatforms.has(platform)) {
        return {
          platform,
          isDetected: false,
          details: "Desativado por feature flag.",
        };
      }

      const matched = joined.match(detectionRules[platform]);
      return {
        platform,
        isDetected: Boolean(matched),
        evidence: matched?.[0],
      };
    },
  );

  const missingTracking = detections.filter((item) => !item.isDetected).length;

  const events: ScanOutput["events"] = [
    {
      event: "PAGE_VIEW",
      status: detections.some((d) => d.isDetected) ? "PASS" : "WARNING",
      details:
        "Eventos inferidos via presenca de scripts/pixels. Em breve, validacao ativa de disparo em fluxo de compra.",
    },
    {
      event: "ADD_TO_CART",
      status: "WARNING",
      details:
        "Validacao completa depende de navegacao guiada e interceptacao de requests durante interacao.",
    },
    {
      event: "INITIATE_CHECKOUT",
      status: "WARNING",
      details:
        "Validacao completa depende de simulacao do checkout em ambiente controlado.",
    },
  ];

  const loadTimeMs = Date.now() - startedAt;
  const findings: ScanOutput["findings"] = [];

  if (missingTracking > 0) {
    findings.push({
      category: "TRACKING",
      severity: missingTracking >= 3 ? "HIGH" : "MEDIUM",
      title: "Cobertura incompleta de pixels",
      description:
        "Nem todas as plataformas de tracking esperadas foram detectadas na loja.",
      impactScore: missingTracking * 12,
    });
  }

  if (loadTimeMs > 5000) {
    findings.push({
      category: "PERFORMANCE",
      severity: "HIGH",
      title: "Tempo inicial de carregamento elevado",
      description:
        "A pagina demorou mais de 5s para estabilizar o carregamento inicial.",
      impactScore: 18,
    });
  }

  const estimatedMonthlyLossCents = findings.reduce(
    (sum, finding) => sum + finding.impactScore * 5000,
    0,
  );
  const domain = await lookupDomainExpiration(url);

  return {
    detections,
    events,
    findings,
    estimatedMonthlyLossCents,
    summary: {
      totalScripts: scripts.length,
      loadTimeMs,
      domain,
    },
  };
}
