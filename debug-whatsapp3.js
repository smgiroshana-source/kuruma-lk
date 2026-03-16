const fs = require('fs')
const code = fs.readFileSync('src/app/vendor/page.tsx', 'utf8')
const defIdx = code.indexOf('function whatsAppDailyReport')
console.log(JSON.stringify(code.slice(defIdx + 1400, defIdx + 3000)))
