/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Report, PDF, Excel and AI workloads run on the Node.js runtime (see route handlers).
  // These heavyweight, Node-only packages must not be bundled for the browser.
  serverExternalPackages: ["exceljs", "@react-pdf/renderer"],
  eslint: {
    // CI runs `next lint` explicitly; do not fail production builds on lint.
    ignoreDuringBuilds: false,
  },
  typescript: {
    ignoreBuildErrors: false,
  },
  experimental: {
    // Typed <Link> hrefs across the app router.
    typedRoutes: true,
  },
};

export default nextConfig;
