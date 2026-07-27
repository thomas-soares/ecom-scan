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
        "Eventos inferidos via presença de scripts/pixels. Em breve, validação ativa de disparo em fluxo de compra.",
    },
    {
      event: "ADD_TO_CART",
      status: "WARNING",
      details:
        "Validação completa depende de navegação guiada e interceptação de requests durante interação.",
    },
    {
      event: "INITIATE_CHECKOUT",
      status: "WARNING",
      details:
        "Validação completa depende de simulação do checkout em ambiente controlado.",
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
        "A página demorou mais de 5s para estabilizar o carregamento inicial.",
      impactScore: 18,
    });
  }

  const estimatedMonthlyLossCents = findings.reduce(
    (sum, finding) => sum + finding.impactScore * 5000,
    0,
  );

  return {
    detections,
    events,
    findings,
    estimatedMonthlyLossCents,
    summary: {
      totalScripts: scripts.length,
      loadTimeMs,
    },
  };
}
