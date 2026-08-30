import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The development route badge can cover leaderboard text and the mobile sponsor
  // dock at supported 320px layouts. Compile/runtime errors still use their overlay.
  devIndicators: false,
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
