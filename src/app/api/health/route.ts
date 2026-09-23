import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { redis } from "@/lib/redis";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(): Promise<NextResponse> {
  const checagens: Record<string, "ok" | "falha"> = {};

  try {
    await query("SELECT 1");
    checagens.postgres = "ok";
  } catch {
    checagens.postgres = "falha";
  }

  try {
    await redis().ping();
    checagens.redis = "ok";
  } catch {
    checagens.redis = "falha";
  }

  const saudavel = Object.values(checagens).every((v) => v === "ok");
  return NextResponse.json({ status: saudavel ? "ok" : "degradado", checagens }, { status: saudavel ? 200 : 503 });
}
