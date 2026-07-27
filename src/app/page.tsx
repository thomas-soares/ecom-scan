"use client";

import { useEffect, useMemo, useState, type ComponentType } from "react";
import {
  AlertCircle,
  ArrowDownRight,
  ChevronRight,
  Clock3,
  FileText,
  Gauge,
  Globe,
  House,
  Loader2,
  Megaphone,
  Menu,
  MousePointer,
  Search,
  Share2,
} from "lucide-react";

import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";

type Accent = "red" | "blue" | "amber";
type ScanStatus = "QUEUED" | "RUNNING" | "COMPLETED" | "FAILED";

type ScanData = {
  id: string;
  url: string;
  status: ScanStatus;
  queuedAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  errorMessage: string | null;
  detections: Array<{
    platform: "META" | "GOOGLE" | "TIKTOK" | "PINTEREST" | "SNAPCHAT";
    isDetected: boolean;
    evidence?: string | null;
    details?: string | null;
  }>;
  eventValidations: Array<{
    event: "PAGE_VIEW" | "ADD_TO_CART" | "INITIATE_CHECKOUT";
    status: "PASS" | "WARNING" | "FAIL";
    details: string | null;
  }>;
  findings: Array<{
    title: string;
    description: string;
    impactScore: number;
  }>;
  report: {
    estimatedMonthlyLossCents: number;
    summary?: {
      loadTimeMs?: number;
      totalScripts?: number;
    } | null;
  } | null;
};

type Stat = {
  title: string;
  value: string;
  note: string;
  icon: ComponentType<{ className?: string }>;
  accent: Accent;
};

type ExecutionStep = {
  label: string;
  detail: string;
  tone: "default" | "secondary" | "destructive";
};

const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000/api";
const POLL_INTERVAL_MS = 2000;
const DEFAULT_SCAN_URL = "https://www.nuvemshop.com.br";

function mapApiError(error: unknown, fallbackMessage: string) {
  if (error instanceof TypeError) {
    return "Falha de conexao com a API. Inicie a API com `pnpm dev:api` na raiz do projeto.";
  }

  if (error instanceof Error && error.message) {
    return error.message;
  }

  return fallbackMessage;
}

function SidebarContent() {
  return (
    <div className="flex h-full flex-col">
      <div className="px-5 py-5">
        <div className="flex items-center gap-3">
          <div className="flex size-9 items-center justify-center rounded-lg bg-primary text-xs font-bold text-primary-foreground">
            ES
          </div>
          <div>
            <p className="text-sm font-semibold">Ecom Scan</p>
          </div>
        </div>
      </div>

      <nav className="px-3">
        <ul className="space-y-1.5 text-sm">
          <li>
            <button className="flex w-full items-center gap-2 rounded-lg bg-primary/10 px-3 py-2 font-medium text-primary">
              <House className="size-4" />
              Diagnostico
            </button>
          </li>
          <li>
            <button className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-muted-foreground hover:bg-muted hover:text-foreground">
              <Clock3 className="size-4" />
              Historico
            </button>
          </li>
          <li>
            <button className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-muted-foreground hover:bg-muted hover:text-foreground">
              <FileText className="size-4" />
              Relatorios
            </button>
          </li>
        </ul>
      </nav>

      <div className="mt-auto px-4 pb-4">
        <Separator className="mb-4" />
        <button className="flex w-full items-center justify-between rounded-xl border border-border bg-card px-3 py-2 text-sm hover:bg-muted">
          <div className="flex items-center gap-2">
            <Avatar className="size-8">
              <AvatarFallback>TS</AvatarFallback>
            </Avatar>
            <span>Thomas Soares</span>
          </div>
          <ChevronRight className="size-4 text-muted-foreground" />
        </button>
      </div>
    </div>
  );
}

function ScoreRing({ score }: { score: number }) {
  return (
    <div className="relative grid size-36 place-items-center">
      <div
        className="absolute inset-0 rounded-full"
        style={{
          background: `conic-gradient(var(--destructive) ${score}%, #e6edf9 0)`,
        }}
      />
      <div className="absolute inset-2 rounded-full bg-card" />
      <div className="relative text-center">
        <p className="text-5xl leading-none font-semibold text-destructive">
          {score}
        </p>
        <p className="text-sm text-muted-foreground">/100</p>
      </div>
    </div>
  );
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

function statusLabel(status: ScanStatus | null) {
  if (!status) {
    return "Sem scan";
  }

  if (status === "QUEUED") {
    return "Na fila";
  }

  if (status === "RUNNING") {
    return "Em execucao";
  }

  if (status === "COMPLETED") {
    return "Concluido";
  }

  return "Falhou";
}

function getStatusVariant(
  status: ScanStatus | null,
): "default" | "secondary" | "destructive" {
  if (!status) {
    return "secondary";
  }

  if (status === "FAILED") {
    return "destructive";
  }

  if (status === "COMPLETED") {
    return "default";
  }

  return "secondary";
}

function platformLabel(platform: ScanData["detections"][number]["platform"]) {
  const labels: Record<ScanData["detections"][number]["platform"], string> = {
    META: "Meta Pixel",
    GOOGLE: "Google Tags",
    TIKTOK: "TikTok Pixel",
    PINTEREST: "Pinterest Tag",
    SNAPCHAT: "Snap Pixel",
  };

  return labels[platform];
}

function eventLabel(event: ScanData["eventValidations"][number]["event"]) {
  const labels: Record<ScanData["eventValidations"][number]["event"], string> =
    {
      PAGE_VIEW: "page_view",
      ADD_TO_CART: "add_to_cart",
      INITIATE_CHECKOUT: "initiate_checkout",
    };

  return labels[event];
}

export default function Home() {
  const [scanUrl, setScanUrl] = useState(DEFAULT_SCAN_URL);
  const [scan, setScan] = useState<ScanData | null>(null);
  const [activeScanId, setActiveScanId] = useState<string | null>(null);
  const [scanStatus, setScanStatus] = useState<ScanStatus | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const isPolling =
    Boolean(activeScanId) &&
    (scanStatus === "QUEUED" || scanStatus === "RUNNING");

  const score = useMemo(() => {
    if (!scan || scan.status !== "COMPLETED") {
      return 34;
    }

    const totalImpact = scan.findings.reduce(
      (sum, item) => sum + item.impactScore,
      0,
    );
    return Math.max(5, Math.min(99, 100 - totalImpact));
  }, [scan]);

  const estimatedLoss = useMemo(() => {
    const cents = scan?.report?.estimatedMonthlyLossCents ?? 1_240_000;
    return new Intl.NumberFormat("pt-BR", {
      style: "currency",
      currency: "BRL",
      maximumFractionDigits: 0,
    }).format(cents / 100);
  }, [scan]);

  const stats = useMemo<Stat[]>(() => {
    if (!scan || scan.status !== "COMPLETED") {
      return [
        {
          title: "Velocidade",
          value: "42/100",
          note: "Desempenho abaixo do ideal. Site mais lento que 77% dos concorrentes.",
          icon: Gauge,
          accent: "red",
        },
        {
          title: "Anuncios",
          value: "Inativo",
          note: "Nenhuma conta de anuncios ativa foi detectada ou integrada.",
          icon: Megaphone,
          accent: "red",
        },
        {
          title: "Rastreamento",
          value: "1/4",
          note: "Apenas 1 de 4 eventos essenciais esta sendo rastreado.",
          icon: MousePointer,
          accent: "amber",
        },
        {
          title: "Dominio",
          value: "14 meses",
          note: "Dominio expira em 14 meses. Planeje a renovacao sem risco.",
          icon: Globe,
          accent: "amber",
        },
      ];
    }

    const loadTimeMs = Number(scan.report?.summary?.loadTimeMs);
    const normalizedSpeed = Number.isFinite(loadTimeMs)
      ? Math.max(10, Math.min(99, 100 - Math.floor(loadTimeMs / 100)))
      : 42;

    const detectedPlatforms = scan.detections.filter(
      (item) => item.isDetected,
    ).length;
    const eventPassCount = scan.eventValidations.filter(
      (item) => item.status === "PASS",
    ).length;
    const eventTotal = scan.eventValidations.length || 4;

    return [
      {
        title: "Velocidade",
        value: `${normalizedSpeed}/100`,
        note: `Tempo estimado de carregamento inicial observado no scan.`,
        icon: Gauge,
        accent: normalizedSpeed < 55 ? "red" : "blue",
      },
      {
        title: "Anuncios",
        value:
          detectedPlatforms > 0 ? `${detectedPlatforms} ativos` : "Inativo",
        note: "Plataformas de anuncios detectadas por scripts e tags na pagina.",
        icon: Megaphone,
        accent: detectedPlatforms > 0 ? "blue" : "red",
      },
      {
        title: "Rastreamento",
        value: `${eventPassCount}/${eventTotal}`,
        note: "Eventos essenciais validados com base no resultado atual.",
        icon: MousePointer,
        accent: eventPassCount >= 2 ? "blue" : "amber",
      },
      {
        title: "Dominio",
        value: "N/D",
        note: "Informacao de expiracao de dominio sera adicionada nas proximas versoes.",
        icon: Globe,
        accent: "amber",
      },
    ];
  }, [scan]);

  const issues = useMemo(() => {
    if (!scan || scan.status !== "COMPLETED") {
      return [
        "Site com carregamento lento em dispositivos moveis",
        "Meta Pixel nao encontrado ou inativo",
        "Eventos essenciais nao estao sendo rastreados corretamente",
        "Titulo da pagina muito longo",
        "Imagens sem compressao adequada",
        "Nenhum anuncio ativo encontrado",
      ];
    }

    const findingIssues = scan.findings.map((item) => item.title);
    const eventWarnings = scan.eventValidations
      .filter((item) => item.status !== "PASS")
      .map(
        (item) =>
          item.details || `Evento ${item.event} com validacao incompleta`,
      );

    const merged = [...findingIssues, ...eventWarnings];
    return merged.length > 0
      ? merged
      : ["Nenhum problema critico detectado nesta varredura."];
  }, [scan]);

  const executionSteps = useMemo<ExecutionStep[]>(() => {
    if (!scan) {
      return [
        {
          label: "Abrir a URL da loja",
          detail: "Aguardando o primeiro scan para mostrar o resultado real.",
          tone: "secondary",
        },
        {
          label: "Capturar HTML e scripts",
          detail:
            "HTML, scripts inline e fontes externas ainda nao foram lidos.",
          tone: "secondary",
        },
        {
          label: "Buscar pixels de anuncio",
          detail:
            "Meta, Google, TikTok, Pinterest e Snapchat serao verificados.",
          tone: "secondary",
        },
        {
          label: "Validar eventos principais",
          detail:
            "page_view, add_to_cart e initiate_checkout ainda nao foram testados.",
          tone: "secondary",
        },
      ];
    }

    const detectionSteps = scan.detections.map((item) => {
      const found = item.isDetected;
      const disabled = Boolean(item.details);

      return {
        label: disabled
          ? `${platformLabel(item.platform)} desativado`
          : found
            ? `${platformLabel(item.platform)} detectado`
            : `${platformLabel(item.platform)} nao encontrado`,
        detail: disabled
          ? item.details || "Desativado por feature flag."
          : found
            ? `Encontrado no carregamento inicial${item.evidence ? `: ${item.evidence}` : ""}.`
            : `Nao encontrado em ${scan.url}.`,
        tone: disabled ? "secondary" : found ? "default" : "destructive",
      } satisfies ExecutionStep;
    });

    const eventSteps = scan.eventValidations.map((item) => {
      const passed = item.status === "PASS";

      return {
        label: `Evento ${eventLabel(item.event)}`,
        detail: passed
          ? item.details || "Capturado com sucesso."
          : item.details || "Nao conseguiu confirmar o disparo desse evento.",
        tone: passed ? "default" : "destructive",
      } satisfies ExecutionStep;
    });

    const performanceStep = scan.report?.summary?.loadTimeMs
      ? [
          {
            label: "Medir tempo de carregamento",
            detail: `Tempo inicial observado: ${scan.report.summary.loadTimeMs}ms.`,
            tone:
              scan.report.summary.loadTimeMs > 5000 ? "destructive" : "default",
          } satisfies ExecutionStep,
        ]
      : [];

    return [
      {
        label: "Abrir a URL da loja",
        detail: `A URL ${scan.url} foi carregada e observada pelo Ecom Scan.`,
        tone: "default",
      },
      {
        label: "Capturar HTML e scripts",
        detail: `Foram lidos ${scan.report?.summary?.totalScripts ?? 0} scripts para buscar pixels e tags.`,
        tone: "default",
      },
      ...detectionSteps,
      ...eventSteps,
      ...performanceStep,
    ];
  }, [scan]);

  async function fetchScanById(scanId: string) {
    const response = await fetch(`${API_BASE_URL}/scans/${scanId}`, {
      method: "GET",
      cache: "no-store",
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(body || "Nao foi possivel consultar o scan.");
    }

    const data = (await response.json()) as ScanData;
    setScan(data);
    setScanStatus(data.status);
    setErrorMessage(
      data.status === "FAILED" ? data.errorMessage || "Scan falhou." : null,
    );

    return data;
  }

  async function handleRunScan() {
    const trimmedUrl = scanUrl.trim();

    if (!trimmedUrl) {
      setErrorMessage("Informe uma URL valida para iniciar o scan.");
      return;
    }

    setIsSubmitting(true);
    setErrorMessage(null);

    try {
      const response = await fetch(`${API_BASE_URL}/scans`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          url: trimmedUrl,
        }),
      });

      if (!response.ok) {
        const body = await response.text();
        throw new Error(body || "Nao foi possivel iniciar o scan.");
      }

      const data = (await response.json()) as {
        scanId: string;
        status: ScanStatus;
      };

      setActiveScanId(data.scanId);
      setScanStatus(data.status);
      await fetchScanById(data.scanId);
    } catch (error) {
      setErrorMessage(mapApiError(error, "Erro inesperado ao iniciar scan."));
    } finally {
      setIsSubmitting(false);
    }
  }

  useEffect(() => {
    if (!activeScanId) {
      return;
    }

    if (scanStatus === "COMPLETED" || scanStatus === "FAILED") {
      return;
    }

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const poll = async () => {
      let nextStatus: ScanStatus | null = null;

      try {
        const data = await fetchScanById(activeScanId);
        nextStatus = data.status;
      } catch (error) {
        if (!cancelled) {
          setErrorMessage(
            mapApiError(error, "Erro ao atualizar status do scan."),
          );
        }
      } finally {
        if (!cancelled) {
          if (nextStatus === "QUEUED" || nextStatus === "RUNNING") {
            timer = setTimeout(poll, POLL_INTERVAL_MS);
          }
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

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top,_#e7efff,_#f7f9fc_45%,_#f7f9fc_100%)]">
      <div className="mx-auto flex w-full max-w-[1400px]">
        <aside className="hidden min-h-screen w-[260px] border-r border-border bg-white lg:block">
          <SidebarContent />
        </aside>

        <main className="flex-1 p-4 md:p-6 lg:p-8">
          <header className="mb-6 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Sheet>
                <SheetTrigger
                  render={
                    <Button
                      variant="outline"
                      size="icon-sm"
                      className="lg:hidden"
                    />
                  }
                >
                  <Menu className="size-4" />
                </SheetTrigger>
                <SheetContent side="left" className="w-[260px] p-0">
                  <SidebarContent />
                </SheetContent>
              </Sheet>

              <p className="text-sm text-muted-foreground">
                Diagnostico <span className="mx-1">&gt;</span>{" "}
                <span className="font-medium text-foreground">Relatorio</span>
              </p>
            </div>

            <div className="flex gap-2">
              <Button variant="outline" size="sm">
                Exportar PDF
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="hidden sm:inline-flex"
              >
                <Share2 className="size-4" />
                Compartilhar
              </Button>
            </div>
          </header>

          <Card className="mb-5">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Search className="size-4" />
                Nova analise de URL
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
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                <Button
                  onClick={handleRunScan}
                  disabled={isSubmitting || isPolling}
                >
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
                    "Rodar diagnostico"
                  )}
                </Button>
                <Badge variant={getStatusVariant(scanStatus)}>
                  {statusLabel(scanStatus)}
                </Badge>
              </div>
              {(isSubmitting || isPolling) && (
                <Progress value={scanStatus === "QUEUED" ? 35 : 70} />
              )}
              {errorMessage && (
                <p className="text-sm text-destructive">{errorMessage}</p>
              )}
            </CardContent>
          </Card>

          <section className="grid gap-5 rounded-2xl border border-border bg-card p-5 shadow-sm md:grid-cols-[1.2fr_0.8fr] md:p-7">
            <div>
              <h1 className="text-3xl font-semibold tracking-tight text-foreground">
                Relatorio de diagnostico
              </h1>
              <p className="mt-2 text-sm text-muted-foreground">
                {scan?.url ?? "https://seudominio.com.br"}
              </p>
              <p className="mt-1 text-sm text-muted-foreground">
                Analisado em{" "}
                {formatScanTime(scan?.finishedAt ?? scan?.queuedAt)}
              </p>
            </div>
            <div className="flex flex-col items-start gap-3 md:items-end">
              <ScoreRing score={score} />
              <div className="max-w-xs text-sm text-muted-foreground md:text-right">
                <p className="font-medium text-foreground">Pontuacao geral</p>
                <p>
                  Seu site esta abaixo da media e precisa de melhorias urgentes
                  para evitar perdas.
                </p>
              </div>
            </div>
          </section>

          <Card className="mt-5">
            <CardHeader>
              <CardTitle>O que o Ecom Scan tentou fazer</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 pt-0">
              {executionSteps.map((step) => (
                <div
                  key={`${step.label}-${step.detail}`}
                  className="flex items-start gap-3 rounded-lg border border-border/60 bg-muted/20 px-3 py-2"
                >
                  <Badge
                    variant={
                      step.tone === "destructive"
                        ? "destructive"
                        : step.tone === "default"
                          ? "default"
                          : "secondary"
                    }
                    className="mt-0.5 shrink-0"
                  >
                    {step.tone === "destructive"
                      ? "Nao achou"
                      : step.tone === "default"
                        ? "OK"
                        : "Desativado"}
                  </Badge>
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-foreground">
                      {step.label}
                    </p>
                    <p className="text-sm text-muted-foreground">
                      {step.detail}
                    </p>
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>

          <Card className="mt-5 border-red-200 bg-red-50/60">
            <CardContent className="flex flex-col gap-4 py-6 sm:flex-row sm:items-center">
              <div className="grid size-16 place-items-center rounded-full border border-red-300 bg-white text-red-600">
                <ArrowDownRight className="size-7" />
              </div>
              <div>
                <p className="text-sm font-medium uppercase tracking-wide text-red-700">
                  Perda estimada
                </p>
                <p className="text-4xl font-semibold text-red-600">
                  {estimatedLoss}/mes
                </p>
                <p className="text-sm text-red-700/80">
                  Este e o valor que voce pode estar perdendo por mes devido aos
                  problemas encontrados.
                </p>
              </div>
            </CardContent>
          </Card>

          <section className="mt-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {stats.map((item) => {
              const accentClass =
                item.accent === "red"
                  ? "text-red-600 border-red-200 bg-red-50"
                  : item.accent === "amber"
                    ? "text-amber-600 border-amber-200 bg-amber-50"
                    : "text-primary border-primary/30 bg-primary/10";

              return (
                <Card key={item.title}>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-3 text-base">
                      <span
                        className={`grid size-9 place-items-center rounded-full border ${accentClass}`}
                      >
                        <item.icon className="size-4" />
                      </span>
                      {item.title}
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <p
                      className={`text-3xl font-semibold ${item.accent === "red" ? "text-red-600" : item.accent === "amber" ? "text-amber-600" : "text-primary"}`}
                    >
                      {item.value}
                    </p>
                    <p className="mt-2 text-sm text-muted-foreground">
                      {item.note}
                    </p>
                  </CardContent>
                </Card>
              );
            })}
          </section>

          <Card className="mt-5">
            <CardHeader>
              <CardTitle>Problemas detectados</CardTitle>
            </CardHeader>
            <CardContent className="pt-0">
              <ul>
                {issues.map((issue) => (
                  <li
                    key={issue}
                    className="flex items-center justify-between border-t border-border py-3 first:border-t-0"
                  >
                    <div className="flex items-center gap-2 text-sm">
                      <AlertCircle className="size-4 text-red-500" />
                      <span>{issue}</span>
                    </div>
                    <ChevronRight className="size-4 text-muted-foreground" />
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>

          <Button className="mt-5 h-12 w-full text-base">
            Quero recuperar esse potencial
          </Button>

          <p className="mt-4 text-center text-xs text-muted-foreground">
            Seus dados estao seguros e nao sao compartilhados com terceiros.
          </p>
        </main>
      </div>
    </div>
  );
}
