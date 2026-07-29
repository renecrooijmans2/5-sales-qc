// node scripts/test-pricing.mjs — the price formats actually typed into the board.
import { parsePrice, cogPct, cogBand } from "../shared/pricing.js";

const cases = [
  ["1pcs $16.50", 16.5, 1],
  ["1pcs $16", 16, 1],
  ["9.2", 9.2, 1],
  ["14", 14, 1],
  ["$17.30", 17.3, 1],
  ["1pcs $8.53,\n2pcs $14.9", 8.53, 1],
  ["1pcs $16.18 2pcs $32.22", 16.18, 1],
  ["2pcs $6.70  5pcs$9.69", 6.7, 2],
  ["2PCS$11.11/  4PCS$20.70 / 6PCS$29.85", 11.11, 2],
  ["2PCS $10.9 4PCS$17,4 4 / 6PCS$25", 10.9, 2],
  ["1pcs $ 11.00 2pcs $19.00", 11, 1],
  ["1pcs $20,80", 20.8, 1],
  ["10 colors$ 10.50 / 20 colors$9.3 / 50colors $12.8", 10.5, 1],
  ["1pcs $15.5,\n2pcs $15.5", 15.5, 1],
  ["-", null, null],
  ["0", null, null],
  ["", null, null],
  [null, null, null],
];

let fail = 0;
for (const [raw, value, qty] of cases) {
  const got = parsePrice(raw);
  const ok = value === null ? got === null : got && got.value === value && got.qty === qty;
  if (!ok) fail++;
  console.log(`${ok ? "✓" : "✗"} ${JSON.stringify(raw)} → ${got ? `$${got.value} /${got.qty}pcs` : "null"}${ok ? "" : `   EXPECTED $${value} /${qty}pcs`}`);
}

// COG bands: green under 28, orange 28–29.9, red 30+
const bands = [
  [15.0, 54.99, "green"],   // 27.3%
  [15.3, 54.99, "green"],   // 27.8%
  [15.4, 54.99, "orange"],  // 28.0% — the band boundary
  [16.0, 54.99, "orange"],  // 29.1%
  [16.5, 54.99, "red"],     // 30.0% — the band boundary
  [null, 54.99, "none"],
];
for (const [supplier, sell, want] of bands) {
  const pct = cogPct(supplier ? { value: supplier, qty: 1 } : null, sell);
  const got = cogBand(pct);
  const ok = got === want;
  if (!ok) fail++;
  console.log(`${ok ? "✓" : "✗"} $${supplier} / $${sell} = ${pct}% → ${got}${ok ? "" : `   EXPECTED ${want}`}`);
}

console.log(fail === 0 ? "\nall passed" : `\n${fail} FAILED`);
process.exit(fail === 0 ? 0 : 1);
