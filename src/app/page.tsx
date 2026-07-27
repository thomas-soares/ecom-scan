import {
  AlertCircle,
  ArrowDownRight,
  ChevronRight,
  Clock3,
  FileText,
  Gauge,
  Globe,
  House,
  Megaphone,
  Menu,
  MousePointer,
  Share2,
} from "lucide-react";

import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";

type Stat = {
  title: string;
  value: string;
  note: string;
  icon: React.ComponentType<{ className?: string }>;
  accent: "red" | "blue" | "amber";
};

const stats: Stat[] = [
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

const issues = [
  "Site com carregamento lento em dispositivos moveis",
  "Meta Pixel nao encontrado ou inativo",
  "Eventos essenciais nao estao sendo rastreados corretamente",
  "Titulo da pagina muito longo",
  "Imagens sem compressao adequada",
  "Nenhum anuncio ativo encontrado",
];

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

function ScoreRing({ value }: { value: number }) {
  return (
    <div className="relative grid size-36 place-items-center">
      <div
        className="absolute inset-0 rounded-full"
        style={{
          background: `conic-gradient(var(--destructive) ${value}%, #e6edf9 0)`,
        }}
      />
      <div className="absolute inset-2 rounded-full bg-card" />
      <div className="relative text-center">
        <p className="text-5xl leading-none font-semibold text-destructive">
          34
        </p>
        <p className="text-sm text-muted-foreground">/100</p>
      </div>
    </div>
  );
}

export default function Home() {
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

          <section className="grid gap-5 rounded-2xl border border-border bg-card p-5 shadow-sm md:grid-cols-[1.2fr_0.8fr] md:p-7">
            <div>
              <h1 className="text-3xl font-semibold tracking-tight text-foreground">
                Relatorio de diagnostico
              </h1>
              <p className="mt-2 text-sm text-muted-foreground">
                https://seudominio.com.br
              </p>
              <p className="mt-1 text-sm text-muted-foreground">
                Analisado em 24 de maio de 2025 as 11:32
              </p>
            </div>
            <div className="flex flex-col items-start gap-3 md:items-end">
              <ScoreRing value={34} />
              <div className="max-w-xs text-sm text-muted-foreground md:text-right">
                <p className="font-medium text-foreground">Pontuacao geral</p>
                <p>
                  Seu site esta abaixo da media e precisa de melhorias urgentes
                  para evitar perdas.
                </p>
              </div>
            </div>
          </section>

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
                  R$ 12.400/mes
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
                      className={`text-3xl font-semibold ${item.accent === "red" ? "text-red-600" : "text-amber-600"}`}
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
