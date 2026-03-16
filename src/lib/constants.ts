export const CATEGORIES = [
  'Engine Parts', 'Transmission & Drivetrain', 'Suspension & Steering', 'Brake System',
  'Electrical & Electronics', 'Body Parts', 'Lighting', 'Interior Parts',
  'A/C & Radiator', 'Wheels & Tires', 'Exhaust System', 'Filters & Fluids',
  'Accessories', 'Hybrid & EV Parts', 'Others', 'Windscreen',
  'Beading Belts and Rubber', 'Audio & Video', 'Safety'
]

export const MAKES = [
  'Toyota', 'Nissan', 'Honda', 'Suzuki', 'Mitsubishi',
  'Isuzu', 'Mazda', 'Hyundai', 'Kia', 'Daihatsu',
  'Perodua', 'Tata', 'Mahindra', 'BMW', 'Mercedes-Benz',
  'Audi', 'Other'
]

export const CONDITIONS = ['New-Genuine', 'New-Other', 'Reconditioned', 'Damaged']

// Phone number utilities for Sri Lanka
// Stores as 10-digit local format: 0777783737
// Converts to E.164 for WhatsApp links: +94777783737
export function formatPhoneSL(raw: string): string {
  // Strip everything except digits
  const digits = raw.replace(/\D/g, '')
  if (!digits) return ''
  // Already has country code 94
  if (digits.startsWith('94') && digits.length === 11) return '0' + digits.slice(2)
  // Already starts with 0
  if (digits.startsWith('0') && digits.length === 10) return digits
  // 9-digit number without leading 0
  if (digits.length === 9) return '0' + digits
  return digits
}

export function toWhatsAppNumber(raw: string): string {
  const local = formatPhoneSL(raw)
  if (!local) return ''
  // Convert 0777783737 → 94777783737
  return '94' + local.slice(1)
}

export function validatePhoneSL(raw: string): boolean {
  const formatted = formatPhoneSL(raw)
  return /^0[0-9]{9}$/.test(formatted)
}

export const ADMIN_EMAILS = (
  process.env.NEXT_PUBLIC_ADMIN_EMAILS || ''
).split(',').map(e => e.trim())

export const PLATFORM_WA = process.env.NEXT_PUBLIC_PLATFORM_WA || ''
export const PLATFORM_NAME = process.env.NEXT_PUBLIC_PLATFORM_NAME || 'kuruma.lk'