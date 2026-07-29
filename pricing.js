// Supplier price parsing — shared by the API and the dashboard so both always
// agree on the COG number.
//
// Prices are typed by hand into Notion and the formats are all over the place:
//   "1pcs $16.50, 2pcs $28.71"      "9.2"        "$17.30"
//   "2PCS $10.9 4PCS$17,4 6PCS$25"  "1pcs $ 11.00 2pcs $19.00"
//   "10 colors$ 10.50 / 20 colors$9.3"          "-"   "0"
// The one thing they share: the price for the main offer is the FIRST tier.

/**
 * @returns {{value:number, qty:number, label:string}|null}
 */
export function parsePrice(raw) {
  if (raw == null || raw === "") return null;
  const s = String(raw).replace(/\s+/g, " ").trim();
  if (!s || s === "-" || /^0(\.0+)?$/.test(s)) return null;

  // Preferred: the first amount that actually follows a currency marker. This
  // is what stops "1pcs $16.50" from being read as $1.
  const dollar = s.match(/\$\s*(\d+(?:[.,]\d{1,2})?)/);
  if (dollar) {
    const value = num(dollar[1]);
    if (value == null) return null;
    // The quantity is the "Npcs" immediately before that amount.
    const before = s.slice(0, dollar.index);
    const tiers = [...before.matchAll(/(\d+)\s*pcs\b/gi)];
    const qty = tiers.length ? Number(tiers[tiers.length - 1][1]) : 1;
    return { value, qty, label: s };
  }

  // No currency marker: drop the quantity/variant tokens, then take what's left.
  const stripped = s.replace(/\b\d+\s*(pcs?|colors?|pieces?|sets?)\b/gi, " ");
  const bare = stripped.match(/(\d+(?:[.,]\d{1,2})?)/);
  if (!bare) return null;
  const value = num(bare[1]);
  if (value == null) return null;
  const tier = s.match(/(\d+)\s*pcs\b/i);
  return { value, qty: tier ? Number(tier[1]) : 1, label: s };
}

function num(t) {
  const v = Number(String(t).replace(",", "."));
  return Number.isFinite(v) && v > 0 ? v : null;
}

/** COG% = supplier price for the main offer ÷ current selling price. */
export function cogPct(supplier, sellingPrice) {
  if (!supplier || !sellingPrice) return null;
  const pct = (supplier.value / sellingPrice) * 100;
  return Number.isFinite(pct) ? Math.round(pct * 10) / 10 : null;
}

/** Green under 28%, orange 28–29.9%, red 30%+. */
export function cogBand(pct) {
  if (pct == null) return "none";
  if (pct < 28) return "green";
  if (pct < 30) return "orange";
  return "red";
}
