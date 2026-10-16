/** @type {(phase: string) => import('next').NextConfig} */
const nextConfig = (phase) => ({
  poweredByHeader: false,
  // Static export → `out/` deploys as-is; headers: public/_headers for hosts,
  // the block below for `next dev` only (phase = PHASE_DEVELOPMENT_SERVER).
  output: "export",
  // The export target has no image-optimization server; static files in
  // public/ are served as-is.
  images: { unoptimized: true },
  ...(phase === "phase-development-server" && {
    async headers() {
      return [
        {
          source: "/:path*",
          headers: [
            { key: "X-Content-Type-Options", value: "nosniff" },
            { key: "X-Frame-Options", value: "DENY" },
            { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          ],
        },
      ];
    },
  }),
});

export default nextConfig;

