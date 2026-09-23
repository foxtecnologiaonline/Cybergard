import type { NextConfig } from "next";

const config: NextConfig = {
  reactStrictMode: true,
  serverExternalPackages: ["pg", "bullmq", "ioredis"],
  // Empacota só o necessário pra rodar — essencial pra imagem Docker não carregar node_modules inteiro.
  output: "standalone",
};

export default config;
