"use client";

import { FormEvent, useEffect, useMemo, useState, type ComponentType } from "react";
import Image from "next/image";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  AlertCircle,
  ArrowDownRight,
  CheckCircle2,
  Clock3,
  Copy,
  Download,
  FileText,
  Gauge,
  Globe,
  House,
  ImageIcon,
  Loader2,
  LogOut,
  Megaphone,
  Menu,
  MousePointer,
  PackageSearch,
  Search,
  ShieldCheck,
  UserPlus,
} from "lucide-react";

import { signIn, signOut, signUp, useSession } from "@/lib/auth-client";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";

type Accent = "red" | "blue" | "amber" | "green";
type ScanStatus = "QUEUED" | "RUNNING" | "COMPLETED" | "FAILED";
type Platform = "META" | "GOOGLE" | "TIKTOK" | "PINTEREST" | "SNAPCHAT";
type EventName = "PAGE_VIEW" | "ADD_TO_CART" | "INITIATE_CHECKOUT";
type AppView = "diagnostico" | "historico" | "relatorio";

type ScanData = {
  id: string;
  url: string;
  status: ScanStatus;
  queuedAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  errorMessage: string | null;
  detections: Array<{
    platform: Platform;
    isDetected: boolean;
    evidence?: string | null;
    details?: {
      ids?: string[];
      observedRequests?: Array<{
        event?: string | null;
        evidence?: string;
      }>;
      status?: string;
    } | null;
  }>;
  eventValidations: Array<{
    event: EventName;
    status: "PASS" | "WARNING" | "FAIL";
    details: string | null;
    metadata?: Record<string, unknown> | null;
  }>;
  findings: Array<{
    category?: "TRACKING" | "PERFORMANCE" | "APPS";
    severity?: "LOW" | "MEDIUM" | "HIGH";
    title: string;
    description: string;
    impactScore: number;
  }>;
  report: {
    estimatedMonthlyLossCents: number;
    summary?: {
      loadTimeMs?: number;
      totalScripts?: number;
      domain?: {
        hostname: string;
        registrableDomain: string;
        expiresAt: string | null;
        daysUntilExpiration: number | null;
        registrar: string | null;
        lookupStatus: "FOUND" | "NOT_FOUND" | "FAILED";
        source: "RDAP";
      };
      ecommerce?: {
        detected: boolean;
        platform?: "SHOPIFY" | "NUVEMSHOP" | "VTEX" | "TRAY" | "OTHER";
        productHandle: string | null;
        productUrl: string | null;
        checkoutUrl: string | null;
        addToCartMethod?: string | null;
        checkoutMethod?: string | null;
      };
      shopify?: {
        detected: boolean;
        productHandle: string | null;
        productUrl: string | null;
        checkoutUrl: string | null;
        addToCartMethod?: string | null;
        checkoutMethod?: string | null;
      };
      performance?: {
        ttfbMs: number | null;
        domContentLoadedMs: number | null;
        totalRequests: number;
        totalTransferKb: number;
        scriptTransferKb: number;
        imageTransferKb: number;
        consoleErrors: number;
      };
      images?: {
        total: number;
        oversized: number;
        missingLazyLoading: number;
        legacyFormats: number;
      };
      apps?: {
        detected: Array<{
          name: string;
          evidence: string;
        }>;
        totalExternalScripts: number;
      };
      tracking?: {
        requests: Array<{
          platform: Platform;
          url: string;
          event: string | null;
          payloadQuality?: "complete" | "partial" | "missing";
        }>;
      };
      lossAssumptions?: {
        monthlyTraffic: number;
        averageOrderValueCents: number;
        baseConversionRate: number;
        severityConversionDrag: number;
      };
    } | null;
  } | null;
  store?: {
    platform: "SHOPIFY" | "NUVEMSHOP" | "VTEX" | "TRAY" | "OTHER";
    name: string;
    url: string;
  } | null;
};

type HistoryScan = Pick<
  ScanData,
  "id" | "url" | "status" | "queuedAt" | "finishedAt" | "errorMessage" | "store" | "report"
>;

type Stat = {
  title: string;
  value: string;
  note: string;
  icon: ComponentType<{ className?: string }>;
  accent: Accent;
};

const POLL_INTERVAL_MS = 2200;
const DEFAULT_SCAN_URL = "";

function mapApiError(error: unknown, fallbackMessage: string) {
  if (error instanceof TypeError) {
    return "Falha de conexao com a API interna. Inicie a stack com `pnpm dev:stack` ou API/worker manualmente.";
  }

  if (error instanceof Error && error.message) {
    return error.message;
  }

  return fallbackMessage;
}

async function readApiError(response: Response, fallbackMessage: string) {
  const body = await response.text();

  if (!body) {
    return fallbackMessage;
  }

  try {
    const data = JSON.parse(body) as {
      message?: string | string[];
      error?: string;
    };
    const message = Array.isArray(data.message)
      ? data.message.join(" ")
      : data.message;

    return message || data.error || fallbackMessage;
  } catch {
    return body;
  }
}

function centsToCurrency(cents: number) {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
    maximumFractionDigits: 0,
  }).format(cents / 100);
}

function formatScanTime(value: string | null | undefined) {
  if (!value) {
    return "Aguardando conclusao";
  }

  return new Date(value).toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function statusLabel(status: ScanStatus | null | undefined) {
  if (!status) {
    return "Sem scan";
  }

  const labels: Record<ScanStatus, string> = {
    QUEUED: "Na fila",
    RUNNING: "Em execucao",
    COMPLETED: "Concluido",
    FAILED: "Falhou",
  };

  return labels[status];
}

function statusVariant(
  status: ScanStatus | null | undefined,
): "default" | "secondary" | "destructive" {
  if (status === "FAILED") {
    return "destructive";
  }

  if (status === "COMPLETED") {
    return "default";
  }

  return "secondary";
}

function platformLabel(platform: Platform) {
  const labels: Record<Platform, string> = {
    META: "Meta Pixel",
    GOOGLE: "Google Tags",
    TIKTOK: "TikTok Pixel",
    PINTEREST: "Pinterest Tag",
    SNAPCHAT: "Snap Pixel",
  };

  return labels[platform];
}

function eventLabel(event: EventName) {
  const labels: Record<EventName, string> = {
    PAGE_VIEW: "Page view",
    ADD_TO_CART: "Add to cart",
    INITIATE_CHECKOUT: "Initiate checkout",
  };

  return labels[event];
}

function storePlatformLabel(platform?: NonNullable<ScanData["store"]>["platform"] | null) {
  const labels = {
    SHOPIFY: "Shopify",
    NUVEMSHOP: "Nuvemshop",
    VTEX: "VTEX",
    TRAY: "Tray",
    OTHER: "Nao identificado",
  } as const;

  return platform ? labels[platform] : "Nao identificado";
}

function scoreFromScan(scan: ScanData | null) {
  if (!scan || scan.status !== "COMPLETED") {
    return 0;
  }

  const totalImpact = scan.findings.reduce(
    (sum, item) => sum + item.impactScore,
    0,
  );

  return Math.max(1, Math.min(99, 100 - totalImpact));
}

function getInitials(name?: string | null, email?: string | null) {
  const source = name || email || "ES";
  const parts = source.split(/[ @._-]/).filter(Boolean);

  return parts
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");
}

function isDisabledDetection(
  detection: ScanData["detections"][number],
) {
  return detection.details?.status === "Desativado por feature flag.";
}

function ScoreRing({ score }: { score: number }) {
  const color =
    score >= 75
      ? "var(--chart-4)"
      : score >= 50
        ? "var(--chart-3)"
        : "var(--destructive)";

  return (
    <div className="relative grid size-36 place-items-center">
      <div
        className="absolute inset-0 rounded-full"
        style={{
          background: `conic-gradient(${color} ${score}%, #e6edf9 0)`,
        }}
      />
      <div className="absolute inset-2 rounded-full bg-card" />
      <div className="relative text-center">
        <p className="text-5xl leading-none font-semibold" style={{ color }}>
          {score}
        </p>
        <p className="text-sm text-muted-foreground">/100</p>
      </div>
    </div>
  );
}

function LogoMark({ className = "h-12 w-40" }: { className?: string }) {
  return (
    <div className={`relative shrink-0 ${className}`}>
      <Image
        src="/logo.jpeg"
        alt="Ecom Scan"
        fill
        className="object-contain"
        sizes="192px"
        priority
      />
    </div>
  );
}

function SidebarContent({
  user,
  onSignOut,
}: {
  user?: { name?: string | null; email?: string | null } | null;
  onSignOut: () => void;
}) {
  const pathname = usePathname();
  const navItems = [
    { label: "Diagnostico", icon: House, href: "/diagnostico" },
    { label: "Historico", icon: Clock3, href: "/historico" },
    { label: "Relatorio", icon: FileText, href: "/relatorio" },
  ];

  return (
    <div className="flex h-full flex-col">
      <div className="px-5 py-5">
        <Link href="/" className="flex justify-center rounded-lg outline-none focus-visible:ring-3 focus-visible:ring-ring/50">
          <LogoMark className="h-16 w-56" />
        </Link>
      </div>

      <nav className="px-3">
        <ul className="space-y-1.5 text-sm">
          {navItems.map((item) => {
            const isActive = pathname === item.href;

            return (
            <li key={item.label}>
              <Link
                href={item.href}
                className={
                  isActive
                    ? "flex w-full items-center gap-2 rounded-lg bg-primary/10 px-3 py-2 font-medium text-primary"
                    : "flex w-full items-center gap-2 rounded-lg px-3 py-2 text-muted-foreground hover:bg-muted hover:text-foreground"
                }
              >
                <item.icon className="size-4" />
                {item.label}
              </Link>
            </li>
            );
          })}
        </ul>
      </nav>

      <div className="mt-auto px-4 pb-4">
        <Separator className="mb-4" />
        <div className="flex items-center justify-between rounded-xl border border-border bg-card px-3 py-2 text-sm">
          <div className="flex min-w-0 items-center gap-2">
            <Avatar className="size-8">
              <AvatarFallback>{getInitials(user?.name, user?.email)}</AvatarFallback>
            </Avatar>
            <div className="min-w-0">
              <p className="truncate font-medium">{user?.name || "Operador"}</p>
              <p className="truncate text-xs text-muted-foreground">{user?.email}</p>
            </div>
          </div>
          <Button variant="ghost" size="icon-sm" onClick={onSignOut} title="Sair">
            <LogOut className="size-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}

function AuthGate() {
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSubmitting(true);
    setErrorMessage(null);

    try {
      const result =
        mode === "login"
          ? await signIn.email({ email, password })
          : await signUp.email({ email, password, name });

      if (result.error) {
        setErrorMessage(result.error.message || "Nao foi possivel autenticar.");
        return;
      }

      window.location.reload();
    } catch (error) {
      setErrorMessage(mapApiError(error, "Erro inesperado ao autenticar."));
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <main className="grid min-h-screen place-items-center bg-[radial-gradient(circle_at_top,_#e7efff,_#f7f9fc_48%,_#f7f9fc_100%)] p-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <LogoMark className="mb-3 h-14 w-48" />
          <CardTitle>{mode === "login" ? "Entrar no Ecom Scan" : "Criar acesso interno"}</CardTitle>
          <p className="text-sm text-muted-foreground">
            Use email e senha para acessar a plataforma de diagnostico.
          </p>
        </CardHeader>
        <CardContent>
          <form className="space-y-4" onSubmit={handleSubmit}>
            {mode === "signup" && (
              <div className="grid gap-2">
                <Label htmlFor="name">Nome</Label>
                <Input
                  id="name"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  placeholder="Seu nome"
                  required
                />
              </div>
            )}
            <div className="grid gap-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="voce@empresa.com"
                required
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="password">Senha</Label>
              <Input
                id="password"
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                minLength={8}
                required
              />
            </div>
            {errorMessage && <p className="text-sm text-destructive">{errorMessage}</p>}
            <Button type="submit" className="h-10 w-full" disabled={isSubmitting}>
              {isSubmitting ? (
                <>
                  <Loader2 className="size-4 animate-spin" />
                  Processando...
                </>
              ) : mode === "login" ? (
                "Entrar"
              ) : (
                <>
                  <UserPlus className="size-4" />
                  Criar conta
                </>
              )}
            </Button>
          </form>
          <Button
            className="mt-3 w-full"
            variant="ghost"
            onClick={() => {
              setMode((current) => (current === "login" ? "signup" : "login"));
              setErrorMessage(null);
            }}
          >
            {mode === "login" ? "Criar novo acesso" : "Ja tenho acesso"}
          </Button>
        </CardContent>
      </Card>
    </main>
  );
}

export function EcomScanApp({ view }: { view: AppView }) {
  const router = useRouter();
  const { data: session, isPending } = useSession();
  const [scanUrl, setScanUrl] = useState(DEFAULT_SCAN_URL);
  const [scan, setScan] = useState<ScanData | null>(null);
  const [history, setHistory] = useState<HistoryScan[]>([]);
  const [historySearch, setHistorySearch] = useState("");
  const [historyStatusFilter, setHistoryStatusFilter] = useState<ScanStatus | "ALL">("ALL");
  const [activeScanId, setActiveScanId] = useState<string | null>(null);
  const [scanStatus, setScanStatus] = useState<ScanStatus | null>(null);
  const [detectedPlatform, setDetectedPlatform] = useState<
    NonNullable<ScanData["store"]>["platform"] | null
  >(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isHistoryLoading, setIsHistoryLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [noticeMessage, setNoticeMessage] = useState<string | null>(null);
  const [shareMessage, setShareMessage] = useState<string | null>(null);
  const [monthlyTraffic, setMonthlyTraffic] = useState("30000");
  const [averageOrderValue, setAverageOrderValue] = useState("180");
  const [baseConversionRate, setBaseConversionRate] = useState("1.8");
  const isPolling =
    Boolean(activeScanId) &&
    (scanStatus === "QUEUED" || scanStatus === "RUNNING");
  const score = useMemo(() => scoreFromScan(scan), [scan]);
  const summary = scan?.report?.summary;
  const ecommerceFlow = summary?.ecommerce ?? summary?.shopify;
  const estimatedLoss = centsToCurrency(scan?.report?.estimatedMonthlyLossCents ?? 0);
  const pageLabel =
    view === "diagnostico"
      ? "Diagnostico"
      : view === "historico"
        ? "Historico"
        : "Relatorio e-commerce";
  const pageTitle =
    view === "diagnostico"
      ? "Novo diagnostico"
      : view === "historico"
        ? "Historico de analises"
        : "Relatorio";

  async function handleSignOut() {
    await signOut();
    window.location.reload();
  }

  const stats = useMemo<Stat[]>(() => {
    if (!scan || scan.status !== "COMPLETED") {
      return [];
    }

    const performance = summary?.performance;
    const images = summary?.images;
    const apps = summary?.apps;
    const visibleDetections = scan.detections.filter(
      (item) => !isDisabledDetection(item),
    );
    const detectedPlatforms = visibleDetections.filter((item) => item.isDetected).length;
    const eventPassCount = scan.eventValidations.filter((item) => item.status === "PASS").length;
    const eventTotal = scan.eventValidations.length || 3;
    const domainDays = summary?.domain?.daysUntilExpiration;
    const speedScore = performance?.domContentLoadedMs
      ? Math.max(5, Math.min(99, 100 - Math.floor(performance.domContentLoadedMs / 80)))
      : 50;

    return [
      {
        title: "Velocidade",
        value: `${speedScore}/100`,
        note: `${performance?.totalRequests ?? 0} requests, ${performance?.totalTransferKb ?? 0} KB transferidos.`,
        icon: Gauge,
        accent: speedScore < 55 ? "red" : speedScore < 75 ? "amber" : "green",
      },
      {
        title: "Anuncios",
        value: detectedPlatforms > 0 ? `${detectedPlatforms} ativos` : "Inativo",
        note: "Pixels/tags identificados por scripts e requests observados.",
        icon: Megaphone,
        accent: detectedPlatforms >= 2 ? "green" : detectedPlatforms === 1 ? "amber" : "red",
      },
      {
        title: "Eventos",
        value: `${eventPassCount}/${eventTotal}`,
        note: "Eventos confirmados por requests durante o fluxo automatizado.",
        icon: MousePointer,
        accent: eventPassCount >= 3 ? "green" : eventPassCount >= 1 ? "amber" : "red",
      },
      {
        title: "Imagens",
        value: `${images?.oversized ?? 0} alertas`,
        note: `${images?.total ?? 0} imagens analisadas; ${images?.missingLazyLoading ?? 0} sem lazy loading.`,
        icon: ImageIcon,
        accent: (images?.oversized ?? 0) > 3 ? "red" : "blue",
      },
      {
        title: "Apps",
        value: `${apps?.detected.length ?? 0} apps`,
        note: `${apps?.totalExternalScripts ?? 0} hosts externos de scripts encontrados.`,
        icon: PackageSearch,
        accent: (apps?.totalExternalScripts ?? 0) > 18 ? "amber" : "blue",
      },
      {
        title: "Dominio",
        value: typeof domainDays === "number" ? `${domainDays} dias` : "N/D",
        note: summary?.domain?.expiresAt
          ? `Expira em ${formatScanTime(summary.domain.expiresAt)}.`
          : "Expiracao nao confirmada via RDAP.",
        icon: Globe,
        accent: typeof domainDays === "number" && domainDays <= 30 ? "red" : "blue",
      },
    ];
  }, [scan, summary]);

  const filteredHistory = useMemo(() => {
    const normalizedSearch = historySearch.trim().toLowerCase();

    return history.filter((item) => {
      const matchesSearch =
        !normalizedSearch ||
        item.url.toLowerCase().includes(normalizedSearch) ||
        storePlatformLabel(item.store?.platform).toLowerCase().includes(normalizedSearch);
      const matchesStatus =
        historyStatusFilter === "ALL" || item.status === historyStatusFilter;

      return matchesSearch && matchesStatus;
    });
  }, [history, historySearch, historyStatusFilter]);

  async function loadHistory() {
    setIsHistoryLoading(true);

    try {
      const response = await fetch("/api/scans", {
        method: "GET",
        cache: "no-store",
      });

      if (!response.ok) {
        throw new Error(
          await readApiError(response, "Nao foi possivel carregar o historico."),
        );
      }

      setHistory((await response.json()) as HistoryScan[]);
    } catch (error) {
      setErrorMessage(mapApiError(error, "Erro ao carregar historico."));
    } finally {
      setIsHistoryLoading(false);
    }
  }

  async function fetchScanById(scanId: string) {
    const response = await fetch(`/api/scans/${scanId}`, {
      method: "GET",
      cache: "no-store",
    });

    if (!response.ok) {
      throw new Error(
        await readApiError(response, "Nao foi possivel consultar o scan."),
      );
    }

    const data = (await response.json()) as ScanData;
    setScan(data);
    setScanStatus(data.status);
    setDetectedPlatform(data.store?.platform ?? null);
    setErrorMessage(data.status === "FAILED" ? data.errorMessage || "Scan falhou." : null);

    return data;
  }

  async function handleRunScan() {
    const trimmedUrl = scanUrl.trim();

    if (!trimmedUrl) {
      setErrorMessage("Informe a URL completa de uma loja suportada.");
      return;
    }

    setIsSubmitting(true);
    setErrorMessage(null);
    setNoticeMessage(null);
    setShareMessage(null);

    try {
      const response = await fetch("/api/scans", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          url: trimmedUrl,
          monthlyTraffic: Math.max(0, Number(monthlyTraffic) || 0),
          averageOrderValueCents: Math.max(
            0,
            Math.round((Number(averageOrderValue.replace(",", ".")) || 0) * 100),
          ),
          baseConversionRate: Math.max(
            0,
            (Number(baseConversionRate.replace(",", ".")) || 0) / 100,
          ),
        }),
      });

      if (!response.ok) {
        throw new Error(
          await readApiError(response, "Nao foi possivel iniciar o scan."),
        );
      }

      const data = (await response.json()) as {
        scanId: string;
        status: ScanStatus;
        platform?: NonNullable<ScanData["store"]>["platform"];
        reused?: boolean;
        message?: string | null;
      };

      setActiveScanId(data.scanId);
      setScanStatus(data.status);
      setDetectedPlatform(data.platform ?? null);
      setNoticeMessage(data.reused ? data.message || "Diagnostico recente reutilizado do historico." : null);
      router.push(`/relatorio?scanId=${data.scanId}`);
      await fetchScanById(data.scanId);
      await loadHistory();
    } catch (error) {
      setErrorMessage(mapApiError(error, "Erro inesperado ao iniciar scan."));
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleShare() {
    if (!scan) {
      return;
    }

    const url = `${window.location.origin}/relatorio?scanId=${scan.id}`;
    await navigator.clipboard.writeText(url);
    setShareMessage("Link copiado.");
  }

  useEffect(() => {
    if (!session?.user) {
      return;
    }

    const params = new URLSearchParams(window.location.search);
    const scanId = params.get("scanId");

    window.setTimeout(() => {
      void loadHistory();

      if (view === "relatorio" && scanId) {
        setActiveScanId(scanId);
        void fetchScanById(scanId);
      }
    }, 0);
  }, [session?.user, view]);

  useEffect(() => {
    if (!activeScanId || scanStatus === "COMPLETED" || scanStatus === "FAILED") {
      return;
    }

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const poll = async () => {
      let nextStatus: ScanStatus | null = null;

      try {
        const data = await fetchScanById(activeScanId);
        nextStatus = data.status;

        if (nextStatus === "COMPLETED" || nextStatus === "FAILED") {
          await loadHistory();
        }
      } catch (error) {
        if (!cancelled) {
          setErrorMessage(mapApiError(error, "Erro ao atualizar status do scan."));
        }
      } finally {
        if (!cancelled && (nextStatus === "QUEUED" || nextStatus === "RUNNING")) {
          timer = setTimeout(poll, POLL_INTERVAL_MS);
        }
      }
    };

    timer = setTimeout(poll, POLL_INTERVAL_MS);

    return () => {
      cancelled = true;

      if (timer) {
        clearTimeout(timer);
      }
    };
  }, [activeScanId, scanStatus]);

  if (isPending) {
    return (
      <main className="grid min-h-screen place-items-center bg-background">
        <Loader2 className="size-8 animate-spin text-primary" />
      </main>
    );
  }

  if (!session?.user) {
    return <AuthGate />;
  }

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top,_#e7efff,_#f7f9fc_45%,_#f7f9fc_100%)]">
      <div className="mx-auto w-full max-w-[1500px]">
        <aside className="fixed inset-y-0 left-0 z-30 hidden w-[270px] border-r border-border bg-white lg:block">
          <SidebarContent user={session.user} onSignOut={() => void handleSignOut()} />
        </aside>

        <main className="p-4 md:p-6 lg:ml-[270px] lg:p-8">
          <header className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-3">
              <Sheet>
                <SheetTrigger
                  render={<Button variant="outline" size="icon-sm" className="lg:hidden" />}
                >
                  <Menu className="size-4" />
                </SheetTrigger>
                <SheetContent side="left" className="w-[270px] p-0">
                  <SidebarContent user={session.user} onSignOut={() => void handleSignOut()} />
                </SheetContent>
              </Sheet>
              <LogoMark className="h-11 w-36 lg:hidden" />
              <div>
                <p className="text-sm text-muted-foreground">
                  Ecom Scan <span className="mx-1">&gt;</span>{" "}
                  <span className="font-medium text-foreground">{pageLabel}</span>
                </p>
                <h1 className="mt-1 text-2xl font-semibold tracking-tight text-foreground">
                  {pageTitle}
                </h1>
              </div>
            </div>

            {view === "relatorio" && (
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" size="sm" onClick={() => window.print()} disabled={!scan}>
                <Download className="size-4" />
                Exportar PDF
              </Button>
              <Button variant="outline" size="sm" onClick={handleShare} disabled={!scan}>
                <Copy className="size-4" />
                Compartilhar
              </Button>
            </div>
            )}
          </header>

          {(view === "diagnostico" || view === "historico") && (
          <section
            id={view}
            className={
              view === "diagnostico"
                ? "grid scroll-mt-6 gap-5"
                : "grid scroll-mt-6 gap-5"
            }
          >
            {view === "diagnostico" && (
            <Card>
              <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Search className="size-4" />
                  Nova analise de e-commerce
                  </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="grid gap-2">
                  <Label htmlFor="scan-url">URL da loja</Label>
                  <Input
                    id="scan-url"
                    value={scanUrl}
                    onChange={(event) => setScanUrl(event.target.value)}
                    placeholder="https://sualoja.com"
                  />
                </div>
                <div className="grid gap-3 sm:grid-cols-3">
                  <div className="grid gap-2">
                    <Label htmlFor="monthly-traffic">Visitas/mês</Label>
                    <Input
                      id="monthly-traffic"
                      inputMode="numeric"
                      value={monthlyTraffic}
                      onChange={(event) => setMonthlyTraffic(event.target.value)}
                    />
                  </div>
                  <div className="grid gap-2">
                    <Label htmlFor="average-order-value">Ticket médio</Label>
                    <Input
                      id="average-order-value"
                      inputMode="decimal"
                      value={averageOrderValue}
                      onChange={(event) => setAverageOrderValue(event.target.value)}
                    />
                  </div>
                  <div className="grid gap-2">
                    <Label htmlFor="base-conversion-rate">Conversão %</Label>
                    <Input
                      id="base-conversion-rate"
                      inputMode="decimal"
                      value={baseConversionRate}
                      onChange={(event) => setBaseConversionRate(event.target.value)}
                    />
                  </div>
                </div>
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                  <Button onClick={handleRunScan} disabled={isSubmitting || isPolling}>
                    {isSubmitting ? (
                      <>
                        <Loader2 className="size-4 animate-spin" />
                        Iniciando scan...
                      </>
                    ) : isPolling ? (
                      <>
                        <Loader2 className="size-4 animate-spin" />
                        Scan em andamento...
                      </>
                    ) : (
                      <>
                        <ShieldCheck className="size-4" />
                        Rodar diagnostico
                      </>
                    )}
                  </Button>
                  {scanStatus && (
                    <Badge variant={statusVariant(scanStatus)}>
                      {statusLabel(scanStatus)}
                    </Badge>
                  )}
                  {detectedPlatform && (
                    <Badge variant="secondary">
                      Plataforma: {storePlatformLabel(detectedPlatform)}
                    </Badge>
                  )}
                  {shareMessage && <span className="text-sm text-primary">{shareMessage}</span>}
                </div>
                {(isSubmitting || isPolling) && (
                  <Progress value={scanStatus === "QUEUED" ? 35 : 72} />
                )}
                {errorMessage && <p className="text-sm text-destructive">{errorMessage}</p>}
                {noticeMessage && <p className="text-sm text-primary">{noticeMessage}</p>}
              </CardContent>
            </Card>
            )}

            {view === "historico" && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center justify-between">
                  Historico
                  {isHistoryLoading && <Loader2 className="size-4 animate-spin text-muted-foreground" />}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                <div className="grid gap-2 sm:grid-cols-[1fr_150px]">
                  <Input
                    value={historySearch}
                    onChange={(event) => setHistorySearch(event.target.value)}
                    placeholder="Buscar por URL ou plataforma"
                  />
                  <select
                    className="h-8 rounded-lg border border-input bg-background px-2 text-sm"
                    value={historyStatusFilter}
                    onChange={(event) =>
                      setHistoryStatusFilter(event.target.value as ScanStatus | "ALL")
                    }
                  >
                    <option value="ALL">Todos</option>
                    <option value="COMPLETED">Concluidos</option>
                    <option value="RUNNING">Em execucao</option>
                    <option value="QUEUED">Na fila</option>
                    <option value="FAILED">Falhos</option>
                  </select>
                </div>
                {history.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Nenhum scan salvo para este usuario.</p>
                ) : filteredHistory.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Nenhum item corresponde aos filtros.</p>
                ) : (
                  filteredHistory.slice(0, 8).map((item) => (
                    <button
                      key={item.id}
                      className="flex w-full items-center justify-between gap-3 rounded-lg border border-border px-3 py-2 text-left hover:bg-muted"
                      onClick={() => {
                        setNoticeMessage(null);
                        setActiveScanId(item.id);
                        router.push(`/relatorio?scanId=${item.id}`);
                        void fetchScanById(item.id);
                      }}
                    >
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">{item.url}</p>
                        <p className="text-xs text-muted-foreground">
                          {formatScanTime(item.finishedAt ?? item.queuedAt)}
                        </p>
                      </div>
                      <Badge variant={statusVariant(item.status)}>{statusLabel(item.status)}</Badge>
                    </button>
                  ))
                )}
              </CardContent>
            </Card>
            )}
          </section>
          )}

          {view === "relatorio" && (scan ? (
            <div id="relatorio" className="mt-5 scroll-mt-6 space-y-5">
              <section className="grid gap-5 rounded-2xl border border-border bg-card p-5 shadow-sm md:grid-cols-[1.2fr_0.8fr] md:p-7">
                <div>
                  <Badge variant={statusVariant(scan.status)}>{statusLabel(scan.status)}</Badge>
                  <h2 className="mt-4 text-3xl font-semibold tracking-tight text-foreground">
                    Relatorio de diagnostico
                  </h2>
                  <p className="mt-2 break-all text-sm text-muted-foreground">{scan.url}</p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Plataforma identificada: {storePlatformLabel(scan.store?.platform)}
                  </p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Analisado em {formatScanTime(scan.finishedAt ?? scan.queuedAt)}
                  </p>
                </div>
                {scan.status === "COMPLETED" ? (
                  <div className="flex flex-col items-start gap-3 md:items-end">
                    <ScoreRing score={score} />
                    <div className="max-w-xs text-sm text-muted-foreground md:text-right">
                      <p className="font-medium text-foreground">Pontuacao geral</p>
                      <p>
                        A pontuacao combina tracking, eventos, performance, imagens e apps detectados.
                      </p>
                    </div>
                  </div>
                ) : (
                  <div className="flex flex-col items-start gap-3 md:items-end">
                    <div className="grid size-36 place-items-center rounded-full border-8 border-secondary bg-white text-primary">
                      <Loader2 className="size-10 animate-spin" />
                    </div>
                    <div className="max-w-xs text-sm text-muted-foreground md:text-right">
                      <p className="font-medium text-foreground">Scan em processamento</p>
                      <p>
                        O relatorio final aparece quando o worker terminar a varredura.
                      </p>
                    </div>
                  </div>
                )}
              </section>

              {scan.status === "QUEUED" || scan.status === "RUNNING" ? (
                <Card>
                  <CardContent className="flex flex-col items-center justify-center gap-4 py-12 text-center">
                    <Loader2 className="size-9 animate-spin text-primary" />
                    <div>
                      <p className="text-lg font-semibold text-foreground">
                        Executando diagnostico da loja
                      </p>
                      <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
                        Estamos carregando a pagina, buscando pixels, tentando o fluxo de produto,
                        carrinho e checkout, e calculando os sinais de performance.
                      </p>
                    </div>
                    <Progress value={scan.status === "QUEUED" ? 35 : 72} className="max-w-md" />
                  </CardContent>
                </Card>
              ) : scan.status === "FAILED" ? (
                <Card className="border-red-200 bg-red-50/60">
                  <CardContent className="flex items-start gap-3 py-6">
                    <AlertCircle className="mt-0.5 size-5 text-red-600" />
                    <div>
                      <p className="font-semibold text-red-700">Scan falhou</p>
                      <p className="text-sm text-red-700/80">
                        {scan.errorMessage || "Nao foi possivel concluir a varredura desta URL."}
                      </p>
                    </div>
                  </CardContent>
                </Card>
              ) : (
                <>
              <Card>
                <CardHeader>
                  <CardTitle>Resumo executivo</CardTitle>
                </CardHeader>
                <CardContent className="grid gap-4 md:grid-cols-3">
                  <div>
                    <p className="text-sm text-muted-foreground">Prioridade</p>
                    <p className="mt-1 text-xl font-semibold">
                      {scan.findings.some((finding) => finding.severity === "HIGH")
                        ? "Correcao urgente"
                        : scan.findings.length > 0
                          ? "Otimizar proximos passos"
                          : "Monitorar"}
                    </p>
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">Tracking</p>
                    <p className="mt-1 text-xl font-semibold">
                      {scan.eventValidations.filter((event) => event.status === "PASS").length}/
                      {scan.eventValidations.length} eventos OK
                    </p>
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">Primeira acao</p>
                    <p className="mt-1 text-xl font-semibold">
                      {scan.findings[0]?.title ?? "Sem acao critica"}
                    </p>
                  </div>
                  <p className="md:col-span-3 text-sm text-muted-foreground">
                    Use este relatorio para priorizar correcoes que afetam mensuracao,
                    velocidade e caminho de compra antes de investir mais trafego pago.
                  </p>
                </CardContent>
              </Card>

              <Card className="border-red-200 bg-red-50/60">
                <CardContent className="flex flex-col gap-4 py-6 sm:flex-row sm:items-center">
                  <div className="grid size-16 place-items-center rounded-full border border-red-300 bg-white text-red-600">
                    <ArrowDownRight className="size-7" />
                  </div>
                  <div>
                    <p className="text-sm font-medium uppercase tracking-wide text-red-700">
                      Perda mensal estimada
                    </p>
                    <p className="text-4xl font-semibold text-red-600">{estimatedLoss}/mes</p>
                    <p className="text-sm text-red-700/80">
                      Premissa: {summary?.lossAssumptions?.monthlyTraffic.toLocaleString("pt-BR") ?? "30.000"} visitas/m,
                      ticket medio {centsToCurrency(summary?.lossAssumptions?.averageOrderValueCents ?? 18000)}
                      e queda estimada de conversao por severidade.
                    </p>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Premissas da estimativa</CardTitle>
                </CardHeader>
                <CardContent className="grid gap-4 sm:grid-cols-4">
                  <div>
                    <p className="text-sm text-muted-foreground">Visitas/mês</p>
                    <p className="text-xl font-semibold">
                      {(summary?.lossAssumptions?.monthlyTraffic ?? 30000).toLocaleString("pt-BR")}
                    </p>
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">Ticket médio</p>
                    <p className="text-xl font-semibold">
                      {centsToCurrency(summary?.lossAssumptions?.averageOrderValueCents ?? 18000)}
                    </p>
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">Conversão base</p>
                    <p className="text-xl font-semibold">
                      {((summary?.lossAssumptions?.baseConversionRate ?? 0.018) * 100).toFixed(2)}%
                    </p>
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">Queda estimada</p>
                    <p className="text-xl font-semibold">
                      {((summary?.lossAssumptions?.severityConversionDrag ?? 0) * 100).toFixed(2)} p.p.
                    </p>
                  </div>
                </CardContent>
              </Card>

              {stats.length > 0 && (
                <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                  {stats.map((item) => {
                    const accentClass =
                      item.accent === "red"
                        ? "text-red-600 border-red-200 bg-red-50"
                        : item.accent === "amber"
                          ? "text-amber-600 border-amber-200 bg-amber-50"
                          : item.accent === "green"
                            ? "text-emerald-600 border-emerald-200 bg-emerald-50"
                            : "text-primary border-primary/30 bg-primary/10";

                    return (
                      <Card key={item.title}>
                        <CardHeader>
                          <CardTitle className="flex items-center gap-3 text-base">
                            <span className={`grid size-9 place-items-center rounded-full border ${accentClass}`}>
                              <item.icon className="size-4" />
                            </span>
                            {item.title}
                          </CardTitle>
                        </CardHeader>
                        <CardContent>
                          <p className="text-3xl font-semibold text-foreground">{item.value}</p>
                          <p className="mt-2 text-sm text-muted-foreground">{item.note}</p>
                        </CardContent>
                      </Card>
                    );
                  })}
                </section>
              )}

              <section className="grid gap-5 xl:grid-cols-2">
                <Card>
                  <CardHeader>
                    <CardTitle>Pixels e tags detectados</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    {scan.detections.filter((item) => !isDisabledDetection(item)).map((item) => (
                      <div key={item.platform} className="rounded-lg border border-border p-3">
                        <div className="flex items-center justify-between gap-3">
                          <div>
                            <p className="font-medium">{platformLabel(item.platform)}</p>
                            <p className="text-sm text-muted-foreground">
                              {item.evidence || item.details?.status || "Sem evidencia observada."}
                            </p>
                          </div>
                          <Badge variant={item.isDetected ? "default" : "destructive"}>
                            {item.isDetected ? "Detectado" : "Nao achou"}
                          </Badge>
                        </div>
                        {item.details?.ids && item.details.ids.length > 0 && (
                          <p className="mt-2 text-xs text-muted-foreground">
                            IDs: {item.details.ids.join(", ")}
                          </p>
                        )}
                      </div>
                    ))}
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle>Eventos de conversao</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    {scan.eventValidations.map((item) => (
                      <div key={item.event} className="flex items-start gap-3 rounded-lg border border-border p-3">
                        {item.status === "PASS" ? (
                          <CheckCircle2 className="mt-0.5 size-5 text-emerald-600" />
                        ) : (
                          <AlertCircle className="mt-0.5 size-5 text-amber-600" />
                        )}
                        <div>
                          <div className="flex flex-wrap items-center gap-2">
                            <p className="font-medium">{eventLabel(item.event)}</p>
                            {typeof item.metadata?.payloadQuality === "string" && (
                              <Badge variant={item.metadata.payloadQuality === "complete" ? "default" : "secondary"}>
                                Payload {item.metadata.payloadQuality}
                              </Badge>
                            )}
                          </div>
                          <p className="text-sm text-muted-foreground">
                            {item.details || "Sem detalhe retornado pelo worker."}
                          </p>
                        </div>
                      </div>
                    ))}
                  </CardContent>
                </Card>
              </section>

              <section className="grid gap-5 xl:grid-cols-[1.1fr_0.9fr]">
                <Card>
                  <CardHeader>
                    <CardTitle>Problemas priorizados</CardTitle>
                  </CardHeader>
                  <CardContent>
                    {scan.findings.length === 0 ? (
                      <p className="text-sm text-muted-foreground">
                        Nenhum problema critico detectado nesta varredura.
                      </p>
                    ) : (
                      <ul>
                        {scan.findings.map((issue) => (
                          <li
                            key={`${issue.title}-${issue.impactScore}`}
                            className="flex items-start justify-between gap-3 border-t border-border py-3 first:border-t-0"
                          >
                            <div className="flex items-start gap-2 text-sm">
                              <AlertCircle className="mt-0.5 size-4 text-red-500" />
                              <div>
                                <p className="font-medium">{issue.title}</p>
                                <p className="text-muted-foreground">{issue.description}</p>
                              </div>
                            </div>
                            <Badge variant={issue.severity === "HIGH" ? "destructive" : "secondary"}>
                              {issue.severity ?? "MEDIUM"}
                            </Badge>
                          </li>
                        ))}
                      </ul>
                    )}
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle>Detalhes do e-commerce</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3 text-sm">
                    <div className="flex items-center justify-between border-b border-border pb-2">
                      <span className="text-muted-foreground">Produto testado</span>
                      <span className="max-w-[220px] truncate font-medium">
                        {ecommerceFlow?.productHandle ?? "Nao localizado"}
                      </span>
                    </div>
                    <div className="flex items-center justify-between border-b border-border pb-2">
                      <span className="text-muted-foreground">Checkout observado</span>
                      <span className="max-w-[220px] truncate font-medium">
                        {ecommerceFlow?.checkoutUrl ? "Sim" : "Nao"}
                      </span>
                    </div>
                    <div className="flex items-center justify-between border-b border-border pb-2">
                      <span className="text-muted-foreground">Add to cart</span>
                      <span className="max-w-[220px] truncate font-medium">
                        {ecommerceFlow?.addToCartMethod ? "Interagiu" : "Nao confirmado"}
                      </span>
                    </div>
                    <div className="flex items-center justify-between border-b border-border pb-2">
                      <span className="text-muted-foreground">Metodo checkout</span>
                      <span className="max-w-[220px] truncate font-medium">
                        {ecommerceFlow?.checkoutMethod ? "Interagiu" : "Nao confirmado"}
                      </span>
                    </div>
                    <div className="flex items-center justify-between border-b border-border pb-2">
                      <span className="text-muted-foreground">Scripts</span>
                      <span className="font-medium">{summary?.totalScripts ?? 0}</span>
                    </div>
                    <div className="flex items-center justify-between border-b border-border pb-2">
                      <span className="text-muted-foreground">JS transferido</span>
                      <span className="font-medium">{summary?.performance?.scriptTransferKb ?? 0} KB</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-muted-foreground">Erros console</span>
                      <span className="font-medium">{summary?.performance?.consoleErrors ?? 0}</span>
                    </div>
                  </CardContent>
                </Card>
              </section>

              {(summary?.apps?.detected.length ?? 0) > 0 && (
                <Card>
                  <CardHeader>
                    <CardTitle>Apps identificados</CardTitle>
                  </CardHeader>
                  <CardContent className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                    {summary?.apps?.detected.map((app) => (
                      <div key={`${app.name}-${app.evidence}`} className="rounded-lg border border-border p-3">
                        <p className="font-medium">{app.name}</p>
                        <p className="truncate text-sm text-muted-foreground">{app.evidence}</p>
                      </div>
                    ))}
                  </CardContent>
                </Card>
              )}
                </>
              )}
            </div>
          ) : (
            <Card className="mt-5 border-dashed">
              <CardContent className="flex flex-col items-center justify-center py-14 text-center">
                <Search className="size-10 text-muted-foreground" />
                <h2 className="mt-4 text-2xl font-semibold text-foreground">
                  Nenhum diagnostico executado ainda
                </h2>
                <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
                  Selecione uma analise no historico ou rode um novo diagnostico para
                  carregar pixels, eventos, performance, perda estimada e relatorio.
                </p>
                <Button className="mt-5" render={<Link href="/diagnostico" />}>
                  Novo diagnostico
                </Button>
              </CardContent>
            </Card>
          ))}
        </main>
      </div>
    </div>
  );
}
