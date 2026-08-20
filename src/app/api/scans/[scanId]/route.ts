import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { NextResponse } from "next/server";

const API_BASE_URL =
  process.env.API_INTERNAL_URL ??
  process.env.NEXT_PUBLIC_API_URL ??
  "http://localhost:4000/api";

type RouteContext = {
  params: Promise<{
    scanId: string;
  }>;
};

export async function GET(_request: Request, context: RouteContext) {
  const session = await auth.api.getSession({
    headers: await headers(),
  });

  if (!session?.user?.id) {
    return NextResponse.json({ message: "Não autenticado." }, { status: 401 });
  }

  const { scanId } = await context.params;
  const response = await fetch(`${API_BASE_URL}/scans/${scanId}`, {
    method: "GET",
    headers: {
      "x-user-id": session.user.id,
      "x-user-email": session.user.email,
      "x-user-name": session.user.name ?? "",
    },
    cache: "no-store",
  });
  const body = await response.text();

  return new NextResponse(body, {
    status: response.status,
    headers: {
      "content-type": response.headers.get("content-type") ?? "application/json",
    },
  });
}
