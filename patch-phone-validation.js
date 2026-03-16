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

// ── 1. register/page.tsx — inline phone error state + validation ──────────────
let regCode = fs.readFileSync('src/app/register/page.tsx', 'utf8')

// Add phoneError state
regCode = regCode.replace(
  `  const [error, setError] = useState('')`,
  `  const [error, setError] = useState('')
  const [phoneError, setPhoneError] = useState('')
  const [whatsappError, setWhatsappError] = useState('')`
)

// Add validatePhone helper inside component
regCode = regCode.replace(
  `  function updateForm(key: string, value: string) { setForm((prev) => ({ ...prev, [key]: value })) }`,
  `  function updateForm(key: string, value: string) { setForm((prev) => ({ ...prev, [key]: value })) }

  function validatePhone(val: string): string {
    if (!val.trim()) return ''
    const digits = val.replace(/\\D/g, '')
    if (digits.length === 0) return ''
    if (!digits.startsWith('0') && digits.length === 9) return '' // will auto-fix
    if (digits.length < 10) return 'Phone must be 10 digits starting with 0 (e.g. 0771234567)'
    if (digits.length > 10) return 'Phone must be exactly 10 digits'
    if (!digits.startsWith('0')) return 'Phone must start with 0 (e.g. 0771234567)'
    return ''
  }`
)

// Add onBlur validation to phone input
regCode = regCode.replace(
  `<input type="tel" required value={form.phone} onChange={(e) => updateForm('phone', e.target.value)} className="w-full px-3 py-2.5 rounded-lg border-2 border-slate-200 text-sm outline-none focus:border-orange-400 transition" placeholder="077XXXXXXX" />`,
  `<input type="tel" required value={form.phone}
              onChange={(e) => { updateForm('phone', e.target.value); setPhoneError('') }}
              onBlur={(e) => setPhoneError(validatePhone(e.target.value))}
              className={\`w-full px-3 py-2.5 rounded-lg border-2 text-sm outline-none transition \${phoneError ? 'border-red-400 focus:border-red-400' : 'border-slate-200 focus:border-orange-400'}\`}
              placeholder="0771234567" maxLength={10} />
            {phoneError && <p className="text-red-500 text-[11px] mt-1 font-medium">{phoneError}</p>}`
)

// Add onBlur validation to whatsapp input
regCode = regCode.replace(
  `<input type="tel" value={form.whatsapp} onChange={(e) => updateForm('whatsapp', e.target.value)} className="w-full px-3 py-2.5 rounded-lg border-2 border-slate-200 text-sm outline-none focus:border-orange-400 transition" placeholder="Same as phone if blank" />`,
  `<input type="tel" value={form.whatsapp}
              onChange={(e) => { updateForm('whatsapp', e.target.value); setWhatsappError('') }}
              onBlur={(e) => { if (e.target.value) setWhatsappError(validatePhone(e.target.value)) }}
              className={\`w-full px-3 py-2.5 rounded-lg border-2 text-sm outline-none transition \${whatsappError ? 'border-red-400 focus:border-red-400' : 'border-slate-200 focus:border-orange-400'}\`}
              placeholder="Same as phone if blank" maxLength={10} />
            {whatsappError && <p className="text-red-500 text-[11px] mt-1 font-medium">{whatsappError}</p>}`
)

// Block form submit if phone errors
regCode = regCode.replace(
  `if (!form.phone.trim()) { setError('Phone number is required'); setLoading(false); return }`,
  `if (!form.phone.trim()) { setError('Phone number is required'); setLoading(false); return }
    const phoneErr = validatePhone(form.phone)
    if (phoneErr) { setPhoneError(phoneErr); setLoading(false); return }
    if (form.whatsapp.trim()) { const waErr = validatePhone(form.whatsapp); if (waErr) { setWhatsappError(waErr); setLoading(false); return } }`
)

fs.writeFileSync('src/app/register/page.tsx', regCode, 'utf8')
console.log('✅ [register/page.tsx]: Phone validation errors added')
changes++

// ── 2. vendor/page.tsx — phone validation in settings and POS customer ────────
let vendorCode = fs.readFileSync('src/app/vendor/page.tsx', 'utf8')

// Add phoneError state for settings
vendorCode = vendorCode.replace(
  `  const [showExportModal, setShowExportModal] = useState(false)`,
  `  const [showExportModal, setShowExportModal] = useState(false)
  const [settingsPhoneError, setSettingsPhoneError] = useState('')
  const [posPhoneError, setPosPhoneError] = useState('')`
)

// Add validatePhoneSL inline helper (since vendor page may not import it yet)
// Check if already imported
if (!vendorCode.includes('validatePhoneSL')) {
  vendorCode = vendorCode.replace(
    `import { toWhatsAppNumber, formatPhoneSL, validatePhoneSL } from '@/lib/constants'`,
    `import { toWhatsAppNumber, formatPhoneSL, validatePhoneSL } from '@/lib/constants'`
  )
}

// Add inline phone validator if not imported
const hasValidator = vendorCode.includes('validatePhoneSL') || vendorCode.includes('function validatePhoneSL')
if (!hasValidator) {
  vendorCode = vendorCode.replace(
    `function formatDate(d: string)`,
    `function validatePhoneSL(raw: string): boolean {
  const digits = (raw || '').replace(/\\D/g, '')
  return digits.length === 10 && digits.startsWith('0')
}
function formatDate(d: string)`
  )
  console.log('✅ [vendor/page.tsx]: Added inline validatePhoneSL')
}

// Add validation to vendor settings phone inputs
vendorCode = vendorCode.replace(
  `<div><label className="text-[11px] font-bold text-slate-400 uppercase block mb-1">Phone</label>
                    <input type="text" defaultValue={vendor?.phone || ''} id="settings-phone" className="w-full px-3 py-2 rounded-lg border-2 border-slate-200 text-sm outline-none focus:border-orange-400" /></div>
                  <div><label className="text-[11px] font-bold text-slate-400 uppercase block mb-1">WhatsApp</label>
                    <input type="text" defaultValue={vendor?.whatsapp || ''} id="settings-whatsapp" className="w-full px-3 py-2 rounded-lg border-2 border-slate-200 text-sm outline-none focus:border-orange-400" /></div>`,
  `<div>
                    <label className="text-[11px] font-bold text-slate-400 uppercase block mb-1">Phone</label>
                    <input type="tel" defaultValue={vendor?.phone || ''} id="settings-phone" maxLength={10} placeholder="0771234567"
                      onChange={() => setSettingsPhoneError('')}
                      onBlur={e => { const d = e.target.value.replace(/\\D/g,''); setSettingsPhoneError(d && (d.length !== 10 || !d.startsWith('0')) ? 'Must be 10 digits starting with 0' : '') }}
                      className={\`w-full px-3 py-2 rounded-lg border-2 text-sm outline-none focus:border-orange-400 \${settingsPhoneError ? 'border-red-400' : 'border-slate-200'}\`} />
                    {settingsPhoneError && <p className="text-red-500 text-[10px] mt-1 font-medium">{settingsPhoneError}</p>}
                  </div>
                  <div>
                    <label className="text-[11px] font-bold text-slate-400 uppercase block mb-1">WhatsApp</label>
                    <input type="tel" defaultValue={vendor?.whatsapp || ''} id="settings-whatsapp" maxLength={10} placeholder="0771234567"
                      className="w-full px-3 py-2 rounded-lg border-2 border-slate-200 text-sm outline-none focus:border-orange-400" />
                  </div>`
)

// Add phone validation when saving settings
vendorCode = vendorCode.replace(
  `updateShopInfo({ name: v('settings-name'), location: v('settings-location'), address: v('settings-address'), phone: formatPhoneSL(v('settings-phone')), whatsapp: formatPhoneSL(v('settings-whatsapp')), description: v('settings-description') })`,
  `const ph = v('settings-phone').replace(/\\D/g,'')
                  if (ph && (ph.length !== 10 || !ph.startsWith('0'))) { setSettingsPhoneError('Must be 10 digits starting with 0 (e.g. 0771234567)'); return }
                  setSettingsPhoneError('')
                  updateShopInfo({ name: v('settings-name'), location: v('settings-location'), address: v('settings-address'), phone: formatPhoneSL(v('settings-phone')), whatsapp: formatPhoneSL(v('settings-whatsapp')), description: v('settings-description') })`
)

// Add phone validation in POS customer phone input
vendorCode = vendorCode.replace(
  `value={posCustomer.phone} onChange={e => setPosCustomer((p: any) => ({ ...p, phone: e.target.value }))}`,
  `value={posCustomer.phone} onChange={e => { setPosCustomer((p: any) => ({ ...p, phone: e.target.value })); setPosPhoneError('') }}
                      onBlur={e => { const d = e.target.value.replace(/\\D/g,''); if (d && (d.length !== 10 || !d.startsWith('0'))) setPosPhoneError('10 digits starting with 0'); else setPosPhoneError('') }}`
)

// Add error display near POS phone input — find the phone input container
vendorCode = vendorCode.replace(
  `placeholder="Phone (optional)"`,
  `placeholder="0771234567" maxLength={10}`
)

fs.writeFileSync('src/app/vendor/page.tsx', vendorCode, 'utf8')
console.log('✅ [vendor/page.tsx]: Phone validation errors added')
changes++

console.log(`\n${changes} total changes applied`)
