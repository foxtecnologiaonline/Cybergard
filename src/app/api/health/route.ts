import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { redis } from "@/lib/redis";
import { statusWorker } from "@/lib/heartbeat";
import { env } from "@/lib/env";

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

  let worker: { vivo: boolean; ultimoPulsoHaMs: number | null } = { vivo: false, ultimoPulsoHaMs: null };
  if (checagens.redis === "ok") {
    worker = await statusWorker(env().WORKER_HEARTBEAT_INTERVAL_MS);
    checagens.worker = worker.vivo ? "ok" : "falha";
  }

  const saudavel = Object.values(checagens).every((v) => v === "ok");
  return NextResponse.json(
    { status: saudavel ? "ok" : "degradado", checagens, worker },
    { status: saudavel ? 200 : 503 },
  );
}
