import fs from "fs";
import zlib from "zlib";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJ_ROOT = path.resolve(__dirname, "..");
const PACKED_PATH = fs.existsSync(path.join(PROJ_ROOT, "subdata/data/data-packed.js"))
  ? path.join(PROJ_ROOT, "subdata/data/data-packed.js")
  : path.join(PROJ_ROOT, "utils/data-packed.js");
const raw = fs.readFileSync(PACKED_PATH, "utf8");
const b64 = raw.slice(raw.indexOf("=") + 1).trim().replace(/^"|";?$/g, "");
const base = JSON.parse(zlib.inflateSync(Buffer.from(b64, "base64")).toString("utf8"));

function cleanSpotName(name) {
  const rawS = String(name || "").trim();
  let n = rawS.replace(/^(?:继续深度游览|深度游览|出发前往|继续游览|凌晨出发，前往|抵达 \+ 直奔|抵达 \+ )s*[「]?/, "").replace(/」$/, "");
  n = n.replace(/[（(【].*?[)）】]/g, "").trim();
  return n || rawS;
}

const tickets = base.SPOT_TICKETS || {};
const details = base.SPOT_DETAILS || {};

const cleanMap = new Map(); // cleanName -> {raw, hasT, hasD}
for (const c of base.CITIES) {
  for (const e of (c.experiences || [])) {
    const nm = (e && (e.name || e.t)) || "";
    if (!nm) continue;
    const cl = cleanSpotName(nm);
    if (!cleanMap.has(cl)) cleanMap.set(cl, { raw: nm, hasT: !!tickets[cl], hasD: !!details[cl] });
  }
}

const targets = process.argv.slice(2);
for (const t of targets) {
  console.log(`\n=== 含 "${t}" 的库内 clean 名 ===`);
  const hits = [];
  for (const [cl, info] of cleanMap) {
    if (cl.includes(t)) hits.push(cl);
  }
  hits.sort();
  for (const cl of hits) {
    const info = cleanMap.get(cl);
    console.log(`  ${cl}  | 票:${info.hasT ? "✅" : "—"} 介:${info.hasD ? "✅" : "—"}  | raw:"${info.raw}"`);
  }
  if (hits.length === 0) console.log("  (无)");
}
