import type { NextConfig } from "next";

const config: NextConfig = {
  reactStrictMode: true,
  serverExternalPackages: ["pg", "bullmq", "ioredis"],
};

export default config;
