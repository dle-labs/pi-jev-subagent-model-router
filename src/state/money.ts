/** Exact decimal arithmetic from host Number.toString admission onward.
 * This cannot recover digits already lost upstream in floating point. */
const LIMIT = 1024;
const SCALE = 400;
function parts(input: string): { coefficient: bigint; scale: number } {
  if (typeof input !== "string" || input.length > LIMIT) throw new Error("invalid-usd");
  const match = /^(\d+(?:\.\d*)?|\.\d+)(?:[eE]([+-]?\d{1,4}))?$/.exec(input);
  if (!match) throw new Error("invalid-usd");
  const [whole, fraction = ""] = match[1].split(".");
  const exponent = Number(match[2] ?? 0);
  if (Math.abs(exponent) > SCALE) throw new Error("invalid-usd");
  let scale = fraction.length - exponent;
  let digits = (whole || "0") + fraction;
  if (scale < 0) { digits += "0".repeat(-scale); scale = 0; }
  if (scale > SCALE || digits.length > LIMIT) throw new Error("invalid-usd");
  return { coefficient: BigInt(digits), scale };
}
function render(coefficient: bigint, scale: number): string {
  if (coefficient === 0n) return "0";
  let digits = coefficient.toString().padStart(scale + 1, "0");
  const value = scale ? `${digits.slice(0, -scale)}.${digits.slice(-scale)}`.replace(/0+$/, "").replace(/\.$/, "") : digits;
  if (value.length > LIMIT || !Number.isFinite(Number(value))) throw new Error("invalid-usd-projection");
  return value;
}
export function canonicalUsd(value: string): string {
  const p = parts(value); return render(p.coefficient, p.scale);
}
export function decimalUsd(value: number): string {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) throw new Error("invalid-usd");
  return canonicalUsd(value.toString());
}
function align(a: string, b: string) {
  const x = parts(canonicalUsd(a)), y = parts(canonicalUsd(b));
  const scale = Math.max(x.scale, y.scale);
  return { a: x.coefficient * 10n ** BigInt(scale - x.scale), b: y.coefficient * 10n ** BigInt(scale - y.scale), scale };
}
export function addUsd(a: string, b: string): string {
  const p = align(a,b); return render(p.a + p.b,p.scale);
}
export function cumulativeDelta(previous: string, observed: string): { delta: string; accounted: string } {
  const p = align(previous,observed);
  return p.b > p.a ? { delta: render(p.b-p.a,p.scale), accounted: canonicalUsd(observed) } : { delta: "0", accounted: canonicalUsd(previous) };
}
