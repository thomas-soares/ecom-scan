import { EcomScanApp } from "@/components/app/ecom-scan-app";

export default async function RelatorioPage({
  searchParams,
}: {
  searchParams: Promise<{ scanId?: string | string[] }>;
}) {
  const params = await searchParams;
  const scanId = Array.isArray(params.scanId) ? params.scanId[0] : params.scanId;

  return <EcomScanApp view="relatorio" selectedScanId={scanId ?? null} />;
}
