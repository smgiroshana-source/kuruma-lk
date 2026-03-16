const fs = require('fs')
const FILE = 'src/app/vendor/page.tsx'
let code = fs.readFileSync(FILE, 'utf8')

// Fix 1: esc function with literal newline
code = code.replace(
  `return s.includes(',') || s.includes('"') || s.includes('\n') ? \`"\${s}"\` : s`,
  `return s.includes(',') || s.includes('"') || s.includes('\\n') ? \`"\${s}"\` : s`
)

// Fix 2: rows.join with literal newline
code = code.replace(
  `const csv = rows.map(r => r.join(',')).join('\n')`,
  `const csv = rows.map(r => r.join(',')).join('\\n')`
)

fs.writeFileSync(FILE, code, 'utf8')
console.log('✅ Fixed literal newlines in export function')
