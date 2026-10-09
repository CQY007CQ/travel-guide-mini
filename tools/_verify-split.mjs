import { createRequire } from "module";
import zlib from "zlib";
import path from "path";
const req = createRequire(process.cwd() + "/");
const root = process.cwd();
function decode(file){
  const b64 = req(path.resolve(root, file));
  return JSON.parse(zlib.inflateSync(Buffer.from(b64, "base64")).toString("utf8"));
}
const c1 = decode("subdata/data/data-packed.js");
const c2 = decode("subdata2/data/data-packed2.js");
console.log("c1 keys:", Object.keys(c1).join(","));
console.log("c2 keys:", Object.keys(c2).join(","));
const uCities = new Set([...(c1.CITIES||[]).map(c=>c.name), ...(c2.CITIES||[]).map(c=>c.name)]);
const uCoords = new Set([...Object.keys(c1.SPOT_COORDS||{}), ...Object.keys(c2.SPOT_COORDS||{})]);
const D = req("./utils/data.js");
console.log("c1.CITIES:", (c1.CITIES||[]).length, "c2.CITIES:", (c2.CITIES||[]).length, "union:", uCities.size, "merged:", (D.CITIES||[]).length);
console.log("unionCoords:", uCoords.size, "mergedCoords:", Object.keys(D.SPOT_COORDS||{}).length);
const okC = uCities.size === (D.CITIES||[]).length && (D.CITIES||[]).length === ((c1.CITIES||[]).length + (c2.CITIES||[]).length);
const okCoord = uCoords.size === Object.keys(D.SPOT_COORDS||{}).length;
console.log(okC ? "✅ CITIES 合并无丢失/重复" : "❌ CITIES 异常");
console.log(okCoord ? "✅ SPOT_COORDS 合并无丢失/重复" : "❌ SPOT_COORDS 异常");
process.exit(okC && okCoord ? 0 : 1);
