import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Cybergard",
  description: "Monitoramento de segurança para pequenas empresas sem time de TI",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR">
      <body>
        <header className="topo">
          <span className="marca">Cybergard</span>
          <span className="subtitulo">Monitoramento de segurança</span>
        </header>
        <main className="conteudo">{children}</main>
      </body>
    </html>
  );
}
