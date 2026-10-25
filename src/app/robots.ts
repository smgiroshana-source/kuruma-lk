import type { MetadataRoute } from 'next'
import { SITE_URL } from '@/lib/siteUrl'


export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        disallow: ['/vendor', '/admin', '/api', '/login', '/register', '/forgot-password', '/reset-password'],
      },
    ],
    sitemap: `${SITE_URL}/sitemap.xml`,
  }
}
