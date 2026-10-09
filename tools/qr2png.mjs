// 把微信开发者工具 cli login 输出的半块 ASCII 二维码还原成 PNG
// 用法: NODE_PATH=$WS/node_modules node qr2png.mjs /tmp/qr4.txt out.png
import { createRequire } from 'module'
import fs from 'fs'
const require = createRequire('/Users/chenqianyuan/.workbuddy/binaries/node/workspace/')
const { Resvg } = require('@resvg/resvg-js')

const src = process.argv[2] || '/tmp/qr4.txt'
const out = process.argv[3] || '/Users/chenqianyuan/WorkBuddy/2026-08-21-10-53-28/outputs/login-qr.png'

const text = fs.readFileSync(src, 'utf8')
const rows = text.split('\n')
  .filter(l => /[█▀▄ ]/.test(l) && l.trim().length > 0)
  .map(l => l.replace(/\r/g, ''))

// 只保留由块字符/空格构成的行（去掉 "- initialize" 之类）
const qrRows = rows.filter(l => /^[█▀▄ ]+$/.test(l))
if (!qrRows.length) { console.error('no qr rows found'); process.exit(1) }

const W = Math.max(...qrRows.map(r => r.length))
const H = qrRows.length * 2
const grid = []
for (const line of qrRows) {
  const top = [], bot = []
  for (const ch of line.padEnd(W, ' ')) {
    if (ch === '█') { top.push(1); bot.push(1) }
    else if (ch === '▀') { top.push(1); bot.push(0) }
    else if (ch === '▄') { top.push(0); bot.push(1) }
    else { top.push(0); bot.push(0) }
  }
  grid.push(top, bot)
}

const Q = 4            // quiet zone (模块数)
const S = 12           // 每像素放大倍数
const cols = W + Q * 2, rows2 = H + Q * 2
const pw = cols * S, ph = rows2 * S
let rects = ''
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
  if (grid[y][x]) rects += `<rect x="${(x + Q) * S}" y="${(y + Q) * S}" width="${S}" height="${S}"/>`
}
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${pw}" height="${ph}" viewBox="0 0 ${pw} ${ph}"><rect width="${pw}" height="${ph}" fill="#fff"/><g fill="#000">${rects}</g></svg>`
const png = new Resvg(svg, { fitTo: { mode: 'width', value: pw } }).render().asPng()
fs.writeFileSync(out, png)
console.log(`ok ${out} matrix=${W}x${H} px=${pw}x${ph}`)
