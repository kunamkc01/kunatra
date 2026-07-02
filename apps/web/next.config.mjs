/** @type {import('next').NextConfig} */
// Set STATIC_EXPORT=1 to build a fully static site for S3 + CloudFront. The app
// is a client-side SPA (every page is "use client", data fetched at runtime),
// so nothing is lost. Left off, the app builds/serves normally via `next start`
// (used by the local Docker image), since `next start` can't run an export.
const staticExport = process.env.STATIC_EXPORT === "1";

const nextConfig = {
  reactStrictMode: true,
  // The engine is a workspace package published as compiled JS in dist/; no transpile needed.
  ...(staticExport
    ? {
        output: "export",
        trailingSlash: true, // /manage → /manage/index.html, served directly by S3
        images: { unoptimized: true },
      }
    : {}),
};

export default nextConfig;
