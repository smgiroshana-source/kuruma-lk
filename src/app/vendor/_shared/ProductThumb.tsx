'use client'
import { detectTyreBrand, fallbackColor, readableText, BRANDS_WITH_LOGO } from '@/lib/tyreBrands'

// Generated fallback thumbnail shown when a product has no photo.
// For tyres it renders a sidewall-style badge: the brand name in its signature
// colour with the size painted large, so staff recognise stock at a glance.
// If an official logo file exists at /brand-logos/<slug>.png it is preferred.
//
// variant 'card'  → square catalogue tile (grid view)
// variant 'thumb' → small inline square (table rows)

type Props = {
  product: any
  variant?: 'card' | 'thumb'
  className?: string
}

export default function ProductThumb({ product, variant = 'card', className = '' }: Props) {
  const p = product || {}
  const brand = detectTyreBrand(p.name)
  const isTyre = p.product_type === 'tyre' || (p.tyre_width && p.tyre_profile && p.tyre_rim)
  const size = (p.tyre_width && p.tyre_profile && p.tyre_rim)
    ? `${p.tyre_width}/${p.tyre_profile}R${p.tyre_rim}`
    : ''

  const bg = brand?.color || fallbackColor(p.name || p.sku || '')
  const fg = brand?.text || readableText(bg)
  const compact = variant === 'thumb'
  const hasLogo = !compact && brand && BRANDS_WITH_LOGO.has(brand.slug)

  // Official logo (dropped in at public/brand-logos/<slug>.png) over a size strip
  if (hasLogo && isTyre) {
    return (
      <div className={`relative overflow-hidden flex flex-col bg-white ${className}`}>
        <div className="flex-1 flex items-center justify-center p-1.5">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={`/brand-logos/${brand!.slug}.png`} alt={brand!.name} className="max-w-full max-h-full object-contain" />
        </div>
        {size && <div className="text-center font-black text-white py-0.5 leading-none" style={{ background: bg, color: fg, fontSize: '0.7rem' }}>{size}</div>}
      </div>
    )
  }

  // Tyre: dark sidewall with a coloured brand band + big size
  if (isTyre) {
    return (
      <div className={`relative overflow-hidden flex flex-col items-center justify-center ${className}`}
        style={{ background: 'radial-gradient(circle at 50% 38%, #3a3a3d 0%, #1c1c1e 62%, #000 100%)' }}>
        {/* concentric sidewall rings */}
        <div className="absolute inset-[12%] rounded-full border border-white/10" />
        <div className="absolute inset-[26%] rounded-full border border-white/5" />
        {!compact && (
          <span className="z-10 px-1.5 py-0.5 rounded-full font-black uppercase tracking-wide leading-none truncate max-w-[90%]"
            style={{ background: bg, color: fg, fontSize: '0.6rem' }}>
            {brand?.name || (p.make || 'Tyre')}
          </span>
        )}
        {size && (
          <span className={`z-10 font-black text-white leading-none ${compact ? 'mt-0' : 'mt-1'}`}
            style={{ fontSize: compact ? '0.62rem' : '1rem', textShadow: '0 1px 2px rgba(0,0,0,.6)' }}>
            {compact ? `${p.tyre_width}/${p.tyre_profile}` : size}
          </span>
        )}
        {compact && size && (
          <span className="z-10 text-white/70 font-bold leading-none mt-0.5" style={{ fontSize: '0.55rem' }}>R{p.tyre_rim}</span>
        )}
        {!compact && p.origin_country && (
          <span className="z-10 text-white/60 font-semibold mt-1 leading-none" style={{ fontSize: '0.5rem' }}>🌐 {p.origin_country}</span>
        )}
      </div>
    )
  }

  // Non-tyre: brand-or-name badge
  const label = brand?.name || p.make || (p.name || '?').trim().split(/\s+/).slice(0, 2).join(' ')
  return (
    <div className={`relative overflow-hidden flex flex-col items-center justify-center text-center px-1 ${className}`}
      style={{ background: bg, color: fg }}>
      <span className={`font-black uppercase leading-tight ${compact ? 'line-clamp-2' : 'line-clamp-3'}`}
        style={{ fontSize: compact ? '0.55rem' : '0.72rem', letterSpacing: '.02em' }}>
        {label}
      </span>
      {!compact && p.origin_country && (
        <span className="font-semibold mt-1 leading-none opacity-70" style={{ fontSize: '0.5rem' }}>🌐 {p.origin_country}</span>
      )}
    </div>
  )
}
