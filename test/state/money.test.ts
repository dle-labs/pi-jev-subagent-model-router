import { expect, test } from "bun:test";
import { decimalUsd, addUsd, cumulativeDelta, canonicalUsd } from "../../src/state/money";

test("preserves all admitted Number.toString digits including subnormal/exponent", () => {
  for (const n of [0, 0.00001, 1.2345678901234567, 1e21, 5e-324, Number.MAX_VALUE]) {
    expect(Number(decimalUsd(n))).toBe(n);
    expect(decimalUsd(n)).not.toContain("e");
  }
  expect(decimalUsd(-0)).toBe("0");
});
test("exact additions and high water do not round tiny partitions", () => {
  let total = "0";
  for (let i=0;i<10;i++) total = addUsd(total, decimalUsd(0.00001));
  expect(total).toBe("0.0001");
  expect(cumulativeDelta("1", "1")).toEqual({delta:"0", accounted:"1"});
  expect(cumulativeDelta("1", "1.4")).toEqual({delta:"0.4", accounted:"1.4"});
  expect(cumulativeDelta("1.4", ".2")).toEqual({delta:"0", accounted:"1.4"});
  expect(canonicalUsd("0001.4000")).toBe("1.4");
});
test("rejects invalid and resource-abusive persisted values and projections", () => {
  for (const n of [-1, NaN, Infinity]) expect(() => decimalUsd(n)).toThrow();
  for (const s of ["-1", "NaN", "Infinity", "1e999999", "1e-999999", "1".repeat(2000), "", " 1 "]) expect(() => addUsd("0", s)).toThrow();
  expect(() => addUsd(decimalUsd(Number.MAX_VALUE), decimalUsd(Number.MAX_VALUE))).toThrow();
});
