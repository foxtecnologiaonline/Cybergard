import { createCipheriv, createDecipheriv, randomBytes, timingSafeEqual, createHash } from "node:crypto";
import { env } from "./env";

const ALGORITHM = "aes-256-gcm";
const IV_BYTES = 12;

function key(): Buffer {
  const raw = Buffer.from(env().CREDENTIALS_ENCRYPTION_KEY, "base64");
  if (raw.length !== 32) {
    throw new Error("CREDENTIALS_ENCRYPTION_KEY deve ter 32 bytes em base64");
  }
  return raw;
}

/** Cifra credencial de fonte de log antes de persistir. Formato: iv.tag.ciphertext (base64). */
export function encryptSecret(plaintext: string): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key(), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return [iv.toString("base64"), cipher.getAuthTag().toString("base64"), ciphertext.toString("base64")].join(".");
}

export function decryptSecret(payload: string): string {
  const [ivB64, tagB64, dataB64] = payload.split(".");
  if (!ivB64 || !tagB64 || !dataB64) throw new Error("Credencial cifrada em formato inválido");
  const decipher = createDecipheriv(ALGORITHM, key(), Buffer.from(ivB64, "base64"));
  decipher.setAuthTag(Buffer.from(tagB64, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(dataB64, "base64")), decipher.final()]).toString("utf8");
}

export function generateIngestToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashIngestToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function safeEquals(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}
