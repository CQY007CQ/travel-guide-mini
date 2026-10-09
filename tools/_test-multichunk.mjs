// 多数据分包合并回归：把当前单块数据按城市奇偶切成两块，验证加载后合并==全集
import { createRequire } from 'module';
import { writeFileSync, unlinkSync } from 'fs';
import zlib from 'zlib';
const require = createRequire(process.cwd() + '/_x.js');

// 1) 默认单块加载，拿完整参考
const Dfull = require('./utils/data.js');
const isArr = Array.isArray(Dfull.CITIES);
const cityNames = isArr ? Dfull.CITIES.map(c => c.name) : Object.keys(Dfull.CITIES);
const fullSet = new Set(cityNames);

// 2) 构造奇偶两块
const sorted = cityNames.slice().sort();
const odd = new Set(sorted.filter((_, i) => i % 2 === 0));
const even = new Set(sorted.filter((_, i) => i % 2 === 1));

function chunk(keep) {
  const o = {};
  for (const k of Object.keys(Dfull)) {
    if (k === '__dataReady') continue;
    const v = Dfull[k];
    if (k === 'CITIES') {
      o[k] = isArr ? v.filter(c => keep.has(c.name)) : Object.fromEntries(Object.entries(v).filter(([c]) => keep.has(c)));
    } else if (k === 'SPOT_DETAILS_BY_CITY') {
      o[k] = Object.fromEntries(Object.entries(v).filter(([c]) => keep.has(c)));
    } else if (k === 'SPOT_COORDS') {
      o[k] = Object.fromEntries(Object.entries(v).filter(([ck]) => keep.has(ck.split('|')[0])));
    } else {
      o[k] = v; // 全局键两片都放，merge 幂等
    }
  }
  return o;
}
const pa = '/tmp/_chunkA.js', pb = '/tmp/_chunkB.js';
const enc = o => { const d = zlib.deflateSync(Buffer.from(JSON.stringify(o), 'utf8'), { level: 9 }); return 'module.exports = "' + d.toString('base64') + '";\n'; };
writeFileSync(pa, enc(chunk(odd)));
writeFileSync(pb, enc(chunk(even)));

// 3) 多块路径重新加载
delete require.cache[require.resolve('./utils/data.js')];
process.env.DATA_CHUNKS = pa + ',' + pb;
const D2 = require('./utils/data.js');
const merged = new Set(isArr ? D2.CITIES.map(c => c.name) : Object.keys(D2.CITIES));

let ok = true; const msg = [];
if (merged.size !== fullSet.size) { ok = false; msg.push(`城市数 ${merged.size} != ${fullSet.size}`); }
let miss = 0;
for (const c of fullSet) if (!merged.has(c)) { if (++miss <= 10) msg.push('缺 ' + c); }
// 单块缺失验证：仅加载 A 应缺偶数城
delete require.cache[require.resolve('./utils/data.js')];
process.env.DATA_CHUNKS = pa;
const D1 = require('./utils/data.js');
const onlyA = new Set(isArr ? D1.CITIES.map(c => c.name) : Object.keys(D1.CITIES));
const aMiss = [...even].filter(c => !onlyA.has(c)).length;
if (aMiss !== even.size) { ok = false; msg.push(`单块A未缺偶数城(${aMiss}/${even.size})`); }

[pa, pb].forEach(p => { try { unlinkSync(p); } catch (e) {} });
console.log(ok ? `✅ 多块合并一致: ${merged.size} 城; 单块降维验证通过` : '❌ ' + msg.join('; '));
process.exit(ok ? 0 : 1);
