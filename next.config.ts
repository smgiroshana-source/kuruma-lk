import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Security headers (review 2026-09-02). None were set before: the vendor
  // app could be framed by any site (clickjacking), browsers were free to
  // sniff content types, and referrers carried full URLs off-site.
  async headers() {
    return [{
      source: '/:path*',
      headers: [
        { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' },
        { key: 'X-Content-Type-Options', value: 'nosniff' },
        { key: 'X-Frame-Options', value: 'DENY' },
        { key: 'Content-Security-Policy', value: "frame-ancestors 'none'" },
        { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
        { key: 'Permissions-Policy', value: 'camera=(self), microphone=(), geolocation=(), payment=()' },
        { key: 'X-DNS-Prefetch-Control', value: 'on' },
      ],
    }]
  },
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'bvuecngtxgjfzfaygdig.supabase.co',
        pathname: '/storage/v1/object/public/**',
      },
    ],
  },
};

export default nextConfig;
