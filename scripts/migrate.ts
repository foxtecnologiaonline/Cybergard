import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { db, closeDb } from "../src/lib/db";
import { logger } from "../src/lib/logger";

const MIGRATIONS_DIR = join(process.cwd(), "db", "migrations");

async function main(): Promise<void> {
  await db().query(`
    CREATE TABLE IF NOT EXISTS migrations (
      nome text PRIMARY KEY,
      aplicada_em timestamptz NOT NULL DEFAULT now()
    )
  `);

  const applied = new Set(
    (await db().query<{ nome: string }>("SELECT nome FROM migrations")).rows.map((r) => r.nome),
  );

  const files = (await readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith(".sql")).sort();

  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = await readFile(join(MIGRATIONS_DIR, file), "utf8");
    const client = await db().connect();
    try {
      await client.query("BEGIN");
      await client.query(sql);
      await client.query("INSERT INTO migrations (nome) VALUES ($1)", [file]);
      await client.query("COMMIT");
      logger.info("migration aplicada", { file });
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  await closeDb();
}

main().catch((error) => {
  logger.error("falha ao migrar", { error: error instanceof Error ? error.message : String(error) });
  process.exit(1);
});
