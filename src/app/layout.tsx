import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";
import { obterSessao } from "@/lib/session";
import { SairButton } from "./components/sair-button";

export const metadata: Metadata = {
  title: "Cybergard",
  description: "Monitoramento de segurança para pequenas empresas sem time de TI",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const sessao = await obterSessao();

  return (
    <html lang="pt-BR">
      <body>
        <header className="topo">
          <span className="marca">Cybergard</span>
          <span className="subtitulo">Monitoramento de segurança</span>
          {sessao && (
            <>
              <Link href="/" style={{ marginLeft: 24, fontSize: 13 }}>Alertas</Link>
              <Link href="/onboarding" style={{ marginLeft: 12, fontSize: 13 }}>Fontes de log</Link>
              <SairButton />
            </>
          )}
        </header>
        <main className="conteudo">{children}</main>
      </body>
    </html>
  );
}
