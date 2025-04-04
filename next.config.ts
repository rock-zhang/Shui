import type { NextConfig } from "next";
import { version } from "./package.json";

const nextConfig: NextConfig = {
  env: {
    APP_VERSION: version,
  },
};

export default nextConfig;
