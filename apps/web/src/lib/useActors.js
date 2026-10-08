import { DEMO_ACCOUNTS, addressOf } from "./chain";
import { useAsync } from "../components/ui";

export const PHARMACIES = [
  { key: "pharmacyA", label: "Pharmacy A · Manipal (region 1)" },
  { key: "pharmacyB", label: "Pharmacy B · Udupi (region 1)" },
  { key: "pharmacyC", label: "Pharmacy C · Mangaluru (region 2)" },
];

/** Resolves demo-account addresses for recipient pickers. */
export function useActors() {
  return useAsync(async () => {
    const out = {};
    for (const [k, i] of Object.entries(DEMO_ACCOUNTS)) out[k] = await addressOf(i);
    return out;
  });
}
