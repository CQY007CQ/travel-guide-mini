import { createRequire } from "module";
const req = createRequire(process.cwd() + "/");
const DATA = req("./utils/data.js");

function shape(x, depth = 0) {
  if (Array.isArray(x)) return `Array(${x.length})`;
  if (x && typeof x === "object") {
    const keys = Object.keys(x);
    const sample = keys.slice(0, 6).join(", ");
    return `Object(${keys.length}){${sample}${keys.length > 6 ? "…" : ""}}`;
  }
  return typeof x + (typeof x === "string" ? `(${(x + "").slice(0, 20)})` : "");
}

console.log("=== top-level keys ===");
for (const k of Object.keys(DATA)) {
  if (k === "__dataReady" || k === "initData") continue;
  console.log(k.padEnd(20), shape(DATA[k]));
}

console.log("\n=== CITIES sample[0..2] ===");
console.log(JSON.stringify(DATA.CITIES.slice(0, 3), null, 0));
console.log("CITIES length:", DATA.CITIES.length);

console.log("\n=== CITY_COORDS sample ===");
const ccKeys = Object.keys(DATA.CITY_COORDS);
console.log("CITY_COORDS count:", ccKeys.length, "sample:", ccKeys.slice(0, 5));

console.log("\n=== experiences ===");
console.log("typeof:", typeof DATA.experiences, "shape:", shape(DATA.experiences));
if (Array.isArray(DATA.experiences)) console.log("  sample:", JSON.stringify(DATA.experiences.slice(0, 2)));
else if (DATA.experiences && typeof DATA.experiences === "object") console.log("  sample keys:", Object.keys(DATA.experiences).slice(0, 5));

console.log("\n=== SPOT_COORDS / SPOT_INFO ===");
console.log("SPOT_COORDS:", shape(DATA.SPOT_COORDS), "SPOT_INFO:", shape(DATA.SPOT_INFO));
if (DATA.SPOT_COORDS && typeof DATA.SPOT_COORDS === "object") {
  const k = Object.keys(DATA.SPOT_COORDS)[0];
  console.log("  SPOT_COORDS sample key:", k, "=>", JSON.stringify(DATA.SPOT_COORDS[k]).slice(0, 120));
}

console.log("\n=== FOOD_SPOTS ===");
console.log("FOOD_SPOTS:", shape(DATA.FOOD_SPOTS));

console.log("\n=== PROVINCES / PROVINCE_CITIES / CITY2PROV ===");
console.log("PROVINCES:", shape(DATA.PROVINCES));
console.log("PROVINCE_CITIES:", shape(DATA.PROVINCE_CITIES));
console.log("CITY2PROV:", shape(DATA.CITY2PROV));
console.log("BUDGETS:", shape(DATA.BUDGETS));
console.log("GENERIC_SPOT_WORDS:", shape(DATA.GENERIC_SPOT_WORDS));
console.log("SUNRISE_SPOTS:", shape(DATA.SUNRISE_SPOTS));
console.log("BIG_SPOT_DAYS:", shape(DATA.BIG_SPOT_DAYS));
console.log("PREP_CHECKLIST:", shape(DATA.PREP_CHECKLIST));
