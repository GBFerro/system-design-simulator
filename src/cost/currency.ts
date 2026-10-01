/**
 * Display currency (Spec 10, CST-04). Prices are kept in USD; other
 * currencies use a fixed rate from the price table's date, shown in the UI.
 */
import { PRICE_TABLE } from "@/domain/components/pricing";

export type Currency = "USD" | "BRL" | "EUR";

export const CURRENCIES: readonly { id: Currency; label: string; perUsd: number }[] = [
  { id: "USD", label: "US$", perUsd: 1 },
  // Approximate market rates around the table's date.
  { id: "BRL", label: "R$", perUsd: 5.4 },
  { id: "EUR", label: "€", perUsd: 0.86 },
];

export const RATES_AS_OF = PRICE_TABLE.asOf;

export function isCurrency(v: unknown): v is Currency {
  return CURRENCIES.some((c) => c.id === v);
}

const rateOf = (currency: Currency) => CURRENCIES.find((c) => c.id === currency)?.perUsd ?? 1;

const formatters = new Map<string, Intl.NumberFormat>();
function formatter(
  currency: Currency,
  compact: boolean,
  minFraction: number,
  maxFraction = minFraction,
): Intl.NumberFormat {
  const key = `${currency}|${compact}|${minFraction}|${maxFraction}`;
  let f = formatters.get(key);
  if (!f) {
    f = new Intl.NumberFormat("en-US", {
      style: "currency",
      currency,
      notation: compact ? "compact" : "standard",
      minimumFractionDigits: compact ? 0 : minFraction,
      maximumFractionDigits: compact ? 1 : maxFraction,
    });
    formatters.set(key, f);
  }
  return f;
}

/**
 * `usd` converted to `currency` and formatted: whole units from 100 up,
 * cents below (and up to 4 decimals under a cent, for per-request prices).
 * `compact` → "$12.3K".
 */
export function formatMoney(usd: number, currency: Currency = "USD", compact = false): string {
  const v = Number.isFinite(usd) ? usd * rateOf(currency) : 0;
  const abs = Math.abs(v);
  if (compact && abs >= 1000) return formatter(currency, true, 0).format(v);
  const fraction = abs >= 100 ? 0 : abs >= 0.01 || abs === 0 ? 2 : 4;
  return formatter(currency, false, fraction).format(v);
}

/** A unit price ($0.096/h, $0.40 per million): 2 to 4 decimals. */
export function formatPrice(usd: number, currency: Currency = "USD"): string {
  const v = Number.isFinite(usd) ? usd * rateOf(currency) : 0;
  return formatter(currency, false, 2, 4).format(v);
}
