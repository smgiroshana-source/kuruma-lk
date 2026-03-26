import type { Metadata, Viewport } from 'next'
import './globals.css'
import { AuthProvider } from '@/components/AuthProvider'
import ScrollToTop from '@/components/ScrollToTop'

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || 'https://kuruma.lk'

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 5,
  themeColor: '#f97316',
}

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: 'kuruma.lk — Auto Parts Marketplace Sri Lanka',
    template: '%s | kuruma.lk',
  },
  description: 'Sri Lanka\'s largest multi-vendor auto parts marketplace. Find genuine & aftermarket parts for Toyota, Honda, Nissan, Suzuki & more from trusted dealers across the country. Compare prices, WhatsApp sellers directly.',
  keywords: [
    'auto parts Sri Lanka', 'car parts online', 'vehicle spare parts',
    'Toyota parts Sri Lanka', 'Honda parts Sri Lanka', 'brake pads',
    'engine parts', 'transmission parts', 'kuruma.lk',
    'car accessories Sri Lanka', 'aftermarket parts', 'OEM parts',
    'auto spare parts Colombo', 'vehicle parts marketplace',
  ],
  authors: [{ name: 'kuruma.lk' }],
  creator: 'kuruma.lk',
  publisher: 'kuruma.lk',
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      'max-video-preview': -1,
      'max-image-preview': 'large',
      'max-snippet': -1,
    },
  },
  openGraph: {
    type: 'website',
    locale: 'en_LK',
    url: SITE_URL,
    siteName: 'kuruma.lk',
    title: 'kuruma.lk — Auto Parts Marketplace Sri Lanka',
    description: 'Find auto parts from trusted dealers across Sri Lanka. Compare prices, WhatsApp sellers directly.',
    images: [
      {
        url: '/og-image.png',
        width: 1200,
        height: 630,
        alt: 'kuruma.lk — Auto Parts Marketplace',
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'kuruma.lk — Auto Parts Marketplace Sri Lanka',
    description: 'Find auto parts from trusted dealers across Sri Lanka.',
    images: ['/og-image.png'],
  },
  alternates: {
    canonical: SITE_URL,
  },
  icons: {
    icon: '/favicon.svg',
    apple: '/apple-touch-icon.png',
  },
  manifest: '/manifest.json',
  category: 'automotive',
  other: {
    'google-site-verification': process.env.GOOGLE_SITE_VERIFICATION || '',
  },
}

// JSON-LD structured data for the website
const websiteJsonLd = {
  '@context': 'https://schema.org',
  '@type': 'WebSite',
  name: 'kuruma.lk',
  url: SITE_URL,
  description: 'Sri Lanka\'s multi-vendor auto parts marketplace',
  potentialAction: {
    '@type': 'SearchAction',
    target: {
      '@type': 'EntryPoint',
      urlTemplate: `${SITE_URL}/?search={search_term_string}`,
    },
    'query-input': 'required name=search_term_string',
  },
}

const orgJsonLd = {
  '@context': 'https://schema.org',
  '@type': 'Organization',
  name: 'kuruma.lk',
  url: SITE_URL,
  logo: `${SITE_URL}/logo.png`,
  sameAs: [],
  contactPoint: {
    '@type': 'ContactPoint',
    contactType: 'customer service',
    availableLanguage: ['English', 'Sinhala', 'Tamil'],
  },
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <head>
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(websiteJsonLd) }}
        />
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(orgJsonLd) }}
        />
      </head>
      <body className="bg-slate-50 text-slate-900 min-h-screen">
        <AuthProvider>
          {children}
          <ScrollToTop />
        </AuthProvider>
        <script dangerouslySetInnerHTML={{ __html: `if('serviceWorker' in navigator){navigator.serviceWorker.getRegistrations().then(function(r){r.forEach(function(sw){sw.unregister()})})}` }} />
      </body>
    </html>
  )
}
