/**
 * Cria o primeiro usuário de um tenant. Não existe cadastro público na v1 —
 * o piloto é provisionado pela FOX, então o convite acontece por aqui, não pela web.
 *
 * Uso: npx tsx scripts/criar-usuario.ts --tenant <uuid> --email dono@empresa.com --senha "..."
 */
import { criarUsuario } from "../src/repositories/usuarios";
import { buscarTenant } from "../src/repositories/tenants";
import { closeDb } from "../src/lib/db";
import { logger } from "../src/lib/logger";

function argumento(nome: string): string | undefined {
  const index = process.argv.indexOf(`--${nome}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function main(): Promise<void> {
  const tenantId = argumento("tenant");
  const email = argumento("email");
  const senha = argumento("senha");
  const papel = (argumento("papel") ?? "admin") as "admin" | "membro";

  if (!tenantId || !email || !senha) {
    console.error("Uso: tsx scripts/criar-usuario.ts --tenant <uuid> --email <email> --senha <senha> [--papel admin|membro]");
    process.exit(1);
  }

  if (senha.length < 8) {
    console.error("A senha precisa ter pelo menos 8 caracteres.");
    process.exit(1);
  }

  const tenant = await buscarTenant(tenantId);
  if (!tenant) {
    console.error(`Tenant ${tenantId} não encontrado.`);
    process.exit(1);
  }

  const usuario = await criarUsuario({ tenantId, email, senha, papel });
  logger.info("usuário criado", { usuarioId: usuario.id, tenantId, email, papel });
  console.log(`Usuário ${usuario.email} criado para ${tenant.nome} (${papel}).`);

  await closeDb();
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
