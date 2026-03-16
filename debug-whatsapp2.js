const fs = require('fs')
const code = fs.readFileSync('src/app/vendor/page.tsx', 'utf8')
const idx = code.indexOf('whatsAppDailyReport')
if (idx !== -1) {
  // find the function definition
  const defIdx = code.indexOf('function whatsAppDailyReport')
  if (defIdx !== -1) {
    console.log(JSON.stringify(code.slice(defIdx, defIdx + 1500)))
  } else {
    // maybe arrow function
    const arrowIdx = code.indexOf('whatsAppDailyReport =')
    if (arrowIdx !== -1) console.log(JSON.stringify(code.slice(arrowIdx, arrowIdx + 1500)))
    else {
      // just show around first usage
      console.log('No definition found, showing first usage context:')
      console.log(JSON.stringify(code.slice(idx - 50, idx + 200)))
    }
  }
}
