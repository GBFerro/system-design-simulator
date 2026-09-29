import { isValidParam } from "./registry";
import type { ParamSpec, ParamValue } from "./types";

/** Text <-> value conversions for the generated params form (pure, unit-tested). */

/** Numeric specs whose step and min are whole numbers take integers only. */
export function isInteger(spec: ParamSpec): boolean {
  return spec.step !== undefined && Number.isInteger(spec.step) && Number.isInteger(spec.min ?? 0);
}

/** Percent params are stored 0–1 and shown 0–100. */
export function toDisplay(spec: ParamSpec, v: number): number {
  return spec.kind === "percent" ? Number((v * 100).toFixed(4)) : v;
}

export function fromDisplay(spec: ParamSpec, v: number): number {
  // Round away float noise (99.9 / 100 = 0.9990000000000001)
  return spec.kind === "percent" ? Number((v / 100).toFixed(8)) : v;
}

/** "1,000" and "1 000" are thousands; a lone comma is a decimal separator ("0,5"). */
export function parseNumberText(text: string): number {
  let t = text.trim().replace(/[\s_]/g, "");
  if (/^-?\d{1,3}(,\d{3})+(\.\d+)?$/.test(t)) t = t.replace(/,/g, "");
  else t = t.replace(",", ".");
  return t === "" ? NaN : Number(t);
}

export function rangeText(spec: ParamSpec): string {
  const unit = spec.kind === "percent" ? "%" : spec.unit ? ` ${spec.unit}` : "";
  const fmt = (n: number) => `${toDisplay(spec, n).toLocaleString("en-US")}${unit}`;
  if (spec.min !== undefined && spec.max !== undefined) return `${fmt(spec.min)}–${fmt(spec.max)}`;
  if (spec.min !== undefined) return `≥ ${fmt(spec.min)}`;
  if (spec.max !== undefined) return `≤ ${fmt(spec.max)}`;
  return "a number";
}

/**
 * Parse a typed number for `spec`. Returns the value to commit and whether
 * the input was rejected (then the value is the spec default).
 */
export function parseParamInput(
  spec: ParamSpec,
  text: string,
): { value: ParamValue; rejected: boolean } {
  let value = fromDisplay(spec, parseNumberText(text));
  if (isInteger(spec) && Number.isFinite(value)) value = Math.round(value);
  return isValidParam(spec, value)
    ? { value, rejected: false }
    : { value: spec.default, rejected: true };
}
