const fs = require('fs')
const code = fs.readFileSync('src/app/vendor/page.tsx', 'utf8')

// Find WhatsApp Summary button
const idx = code.indexOf('WhatsApp Summary')
if (idx !== -1) {
  console.log('=== WhatsApp Summary button area ===')
  console.log(JSON.stringify(code.slice(idx - 200, idx + 400)))
}

// Find the function that handles it
const idx2 = code.indexOf('whatsappSummary\|sendDailyWhatsApp\|wa.me.*reportDate\|handleWhatsApp')
console.log('\n=== Looking for handler ===')

// Search for wa.me near reportDate
const idx3 = code.indexOf('reportDate')
if (idx3 !== -1) {
  console.log('=== reportDate area ===')
  console.log(JSON.stringify(code.slice(idx3 - 100, idx3 + 800)))
}
