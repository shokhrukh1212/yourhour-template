import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async redirects() {
    return [{ source: "/live", destination: "/", permanent: true }];
  },
  experimental: {
    // The CLI checker can return empty captured output under Node 22.22,
    // which makes `next build` fail before compilation starts.
    useTypeScriptCli: false,
  },
};

export default nextConfig;
