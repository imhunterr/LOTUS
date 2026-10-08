/**
 * Helpers for openFDA enforcement records (feature G).
 * `code_info` is free text such as "Lot #: 22A123, Exp 12/24; Lot 22A124". We pull out lot numbers so
 * a real recall can be replayed against exactly those lots.
 */
const LOT_RE = /\blot\s*(?:#|no\.?|number|numbers|nos\.?)?\s*[:#.]?\s*([A-Z0-9][A-Z0-9-]{2,})/gi;

export function parseLotNumbers(codeInfo = "", max = 5) {
  const lots = [];
  for (const m of String(codeInfo).matchAll(LOT_RE)) {
    const lot = m[1].replace(/-+$/, "").toUpperCase();
    if (!/\d/.test(lot) || ["EXP", "EXPIRY", "NUMBER", "NUMBERS"].includes(lot)) continue;
    if (!lots.includes(lot)) lots.push(lot);
    if (lots.length >= max) break;
  }
  return lots;
}

export const CLASSIFICATION = { "Class I": 1, "Class II": 2, "Class III": 3 };

/** NDC to register the replayed lots under: the event's own product NDC when openFDA provides one. */
export const eventNdc = (e) => (e.product_ndc && e.product_ndc[0]) || `FDA-${e.recall_number}`;
