import { NextResponse } from "next/server";
import { COOKIE_SESSAO } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(): Promise<NextResponse> {
  const response = NextResponse.json({ status: "ok" });
  response.cookies.delete(COOKIE_SESSAO);
  return response;
}
