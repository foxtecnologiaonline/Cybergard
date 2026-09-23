import { query, queryOne } from "@/lib/db";
import { hashSenha } from "@/lib/crypto";

export interface Usuario {
  id: string;
  tenant_id: string;
  email: string;
  papel: "admin" | "membro";
  ativo: boolean;
}

interface UsuarioComHash extends Usuario {
  senha_hash: string;
}

export async function buscarUsuarioParaLogin(email: string): Promise<UsuarioComHash | null> {
  return queryOne<UsuarioComHash>(
    `SELECT id, tenant_id, email, senha_hash, papel, ativo
       FROM usuarios WHERE email = $1 AND ativo`,
    [email],
  );
}

export async function buscarUsuario(usuarioId: string): Promise<Usuario | null> {
  return queryOne<Usuario>(
    `SELECT id, tenant_id, email, papel, ativo FROM usuarios WHERE id = $1 AND ativo`,
    [usuarioId],
  );
}

export async function registrarLogin(usuarioId: string): Promise<void> {
  await query(`UPDATE usuarios SET ultimo_login_em = now() WHERE id = $1`, [usuarioId]);
}

export async function criarUsuario(input: {
  tenantId: string;
  email: string;
  senha: string;
  papel?: "admin" | "membro";
}): Promise<Usuario> {
  const rows = await query<Usuario>(
    `INSERT INTO usuarios (tenant_id, email, senha_hash, papel)
     VALUES ($1, $2, $3, COALESCE($4, 'admin'))
     RETURNING id, tenant_id, email, papel, ativo`,
    [input.tenantId, input.email, hashSenha(input.senha), input.papel ?? null],
  );
  const usuario = rows[0];
  if (!usuario) throw new Error("Falha ao criar usuário");
  return usuario;
}
