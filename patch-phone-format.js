const fs = require('fs')
let changes = 0

function replace(file, label, from, to) {
  let code = fs.readFileSync(file, 'utf8')
  if (!code.includes(from)) { console.error(`❌ NOT FOUND [${file}]: ${label}`); return }
  code = code.replace(from, to)
  fs.writeFileSync(file, code, 'utf8')
  console.log(`✅ [${file}]: ${label}`)
  changes++
}

// ── 1. Add phone utility functions to src/lib/constants.ts ───────────────────
replace(
  'src/lib/constants.ts',
  'Add phone utility functions',
  `export const ADMIN_EMAILS`,
  `// Phone number utilities for Sri Lanka
// Stores as 10-digit local format: 0777783737
// Converts to E.164 for WhatsApp links: +94777783737
export function formatPhoneSL(raw: string): string {
  // Strip everything except digits
  const digits = raw.replace(/\\D/g, '')
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

export const ADMIN_EMAILS`
)

// ── 2. vendor/page.tsx — fix all wa.me links to use toWhatsAppNumber ────────
const VENDOR_FILE = 'src/app/vendor/page.tsx'
let vendorCode = fs.readFileSync(VENDOR_FILE, 'utf8')

// Add import at top of vendor page
if (!vendorCode.includes('toWhatsAppNumber')) {
  vendorCode = vendorCode.replace(
    `'use client'`,
    `'use client'\nimport { toWhatsAppNumber, formatPhoneSL, validatePhoneSL } from '@/lib/constants'`
  )
  console.log('✅ [vendor/page.tsx]: Added phone utility imports')
  changes++
}

// Fix sendWhatsAppBill — phone param
vendorCode = vendorCode.replace(
  `function sendWhatsAppBill(sale: any, vendor: any, phone: string) {`,
  `function sendWhatsAppBill(sale: any, vendor: any, phone: string) {
  const waPhone = toWhatsAppNumber(phone)`
)
vendorCode = vendorCode.replace(
  `window.open(\`https://wa.me/\${phone.replace(/[^0-9+]/g, '')}?text=\${msg}\``,
  `window.open(\`https://wa.me/\${waPhone}?text=\${msg}\``
)

// Fix sendWhatsAppCreditReport — uses customer phone
vendorCode = vendorCode.replace(
  `const phone = customer.whatsapp || customer.phone
    if (!phone) { showToast('No phone number for this customer'); return }`,
  `const rawPhone = customer.whatsapp || customer.phone
    if (!rawPhone) { showToast('No phone number for this customer'); return }
    const phone = toWhatsAppNumber(rawPhone)`
)
vendorCode = vendorCode.replace(
  `window.open(\`https://wa.me/\${phone.replace(/[^0-9+]/g, '')}?text=\${msg}\`, '_blank')`,
  `window.open(\`https://wa.me/\${phone}?text=\${msg}\`, '_blank')`
)

// Fix whatsAppDailyReport — uses vendor phone (no direct wa.me, opens wa.me/?text)
// Already uses wa.me/?text= (no phone) so no change needed there

// Fix vendor registration save — format phone before saving
vendorCode = vendorCode.replace(
  `updateShopInfo({ name: v('settings-name'), location: v('settings-location'), address: v('settings-address'), phone: v('settings-phone'), whatsapp: v('settings-whatsapp'), description: v('settings-description') })`,
  `updateShopInfo({ name: v('settings-name'), location: v('settings-location'), address: v('settings-address'), phone: formatPhoneSL(v('settings-phone')), whatsapp: formatPhoneSL(v('settings-whatsapp')), description: v('settings-description') })`
)

// Fix POS customer phone input display — format on save
vendorCode = vendorCode.replace(
  `vendor_id: vendor.id, name: customerName.trim(),
          phone: customerPhone?.trim() || null, whatsapp: customerPhone?.trim() || null,`,
  `vendor_id: vendor.id, name: customerName.trim(),
          phone: customerPhone ? formatPhoneSL(customerPhone.trim()) : null,
          whatsapp: customerPhone ? formatPhoneSL(customerPhone.trim()) : null,`
)

fs.writeFileSync(VENDOR_FILE, vendorCode, 'utf8')
console.log('✅ [vendor/page.tsx]: WhatsApp links and phone formatting fixed')
changes++

// ── 3. register/page.tsx — validate and format phone ─────────────────────────
replace(
  'src/app/register/page.tsx',
  'Add phone validation on register',
  `if (!form.phone.trim()) { setError('Phone number is required'); setLoading(false); return }`,
  `if (!form.phone.trim()) { setError('Phone number is required'); setLoading(false); return }
    const phoneDigits = form.phone.replace(/\\D/g, '')
    if (phoneDigits.length < 9 || phoneDigits.length > 11) { setError('Enter a valid 10-digit phone number (e.g. 0771234567)'); setLoading(false); return }`
)

// Format phone before sending to API
replace(
  'src/app/register/page.tsx',
  'Format phone before register API call',
  `phone: form.phone.trim(),
          whatsapp: form.whatsapp.trim() || form.phone.trim(),`,
  `phone: form.phone.replace(/\\D/g, '').replace(/^94/, '0').replace(/^([^0])/, '0$1').slice(0, 10),
          whatsapp: (form.whatsapp || form.phone).replace(/\\D/g, '').replace(/^94/, '0').replace(/^([^0])/, '0$1').slice(0, 10),`
)

// ── 4. api/register/route.ts — format phone on server side too ───────────────
replace(
  'src/app/api/register/route.ts',
  'Format phone in register API',
  `phone: phone.trim(),
    whatsapp: (whatsapp || phone).trim(),`,
  `phone: phone.replace(/\\D/g, '').replace(/^94/, '0').slice(0, 10),
    whatsapp: ((whatsapp || phone).replace(/\\D/g, '').replace(/^94/, '0').slice(0, 10)),`
)

// ── 5. api/vendor/customers/route.ts — format phone when creating customer ───
replace(
  'src/app/api/vendor/customers/route.ts',
  'Format customer phone on create',
  `vendor_id: vendor.id, name: name.tri`,
  `vendor_id: vendor.id, name: name.tri`  // anchor only - need to find the actual insert
)

// Different approach for customers route
let custCode = fs.readFileSync('src/app/api/vendor/customers/route.ts', 'utf8')
const custOld = `vendor_id: vendor.id, name: name.trim(), phone: phone || null,
      whatsapp: whatsapp || phone || null, email: email || null,`
const custNew = `vendor_id: vendor.id, name: name.trim(),
      phone: phone ? phone.replace(/\\D/g, '').replace(/^94/, '0').slice(0, 10) : null,
      whatsapp: (whatsapp || phone) ? (whatsapp || phone).replace(/\\D/g, '').replace(/^94/, '0').slice(0, 10) : null,
      email: email || null,`
if (custCode.includes(custOld)) {
  custCode = custCode.replace(custOld, custNew)
  fs.writeFileSync('src/app/api/vendor/customers/route.ts', custCode, 'utf8')
  console.log('✅ [customers/route.ts]: Phone formatting on customer create')
  changes++
} else {
  console.error('❌ NOT FOUND [customers/route.ts]: customer insert phone')
}

console.log(`\n${changes} changes applied`)
