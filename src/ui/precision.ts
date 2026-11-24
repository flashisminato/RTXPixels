/**
 * Display precision for substitution lines in chapter 3.
 *
 * A substitution line such as  Δ = h² − c = 0.6412  promises that a reader can
 * redo the arithmetic from the numbers printed on it. A fixed 3 decimals breaks
 * that promise wherever the arithmetic cancels or divides: with h ≈ −7.1 and
 * c ≈ 50, rounding h and c to 3 decimals moves h² − c by up to ~0.007, so the
 * printed inputs gave 0.6348 while the printed (correct) Δ was 0.6412.
 *
 * The rule here: print the inputs with the fewest decimals (from `min`) at which
 * the arithmetic on the printed inputs, rounded like the printed result, gives
 * exactly the printed result. If no precision up to `max` does, the line says ≈.
 * Pure: no DOM, so it is tested in Node (tests/ui/precision.test.ts).
 */
import type { PlaneSolve, SphereSolve } from './math-model.ts';

type Round = (value: number) => number;

/** One printed substitution: evaluate it from inputs rounded by `round`. */
export type Substitution = { evaluate(round: Round, digits: number): number; result: number; resultDigits: number };

export type Precision = { digits: number; exact: boolean[] };

const rounder = (digits: number): Round => value => Number(value.toFixed(digits));

const reproduces = (line: Substitution, digits: number): boolean =>
  Number(line.evaluate(rounder(digits), digits).toFixed(line.resultDigits)) === Number(line.result.toFixed(line.resultDigits));

/**
 * Smallest input precision in [min, max] at which every line reproduces its printed
 * result. Lines that share a printed symbol must share a precision, so they are
 * solved together. `exact[i]` is false when line i still does not reproduce at `max`.
 */
export function substitutionDigits(lines: Substitution[], min = 3, max = 8): Precision {
  for (let digits = min; digits <= max; digits++) {
    if (lines.every(line => reproduces(line, digits))) return { digits, exact: lines.map(() => true) };
  }
  return { digits: max, exact: lines.map(line => reproduces(line, max)) };
}

/** √Δ is printed with at least 4 decimals: it is the term the figure dimensions. */
export const rootDigits = (digits: number): number => Math.max(digits, 4);

/**
 * Sphere: Δ = h² − c  (printed to 4 decimals)  and  t = −h ∓ √Δ  (3 decimals).
 * h appears on both lines, so both lines use one precision for h, c and √Δ.
 */
export function sphereDigits(sp: Pick<SphereSolve, 'h' | 'c' | 'delta' | 'root'>, t: number): Precision {
  const sign = sp.root === 'near' ? -1 : 1;
  const root = Math.sqrt(Math.max(sp.delta, 0));
  return substitutionDigits([
    { evaluate: round => round(sp.h) ** 2 - round(sp.c), result: sp.delta, resultDigits: 4 },
    { evaluate: (round, digits) => -round(sp.h) + sign * Number(root.toFixed(rootDigits(digits))), result: t, resultDigits: 3 },
  ]);
}

/** Plane: t = numerator / denominator (3 decimals). */
export function planeDigits(pl: Pick<PlaneSolve, 'numerator' | 'denominator'>, t: number): Precision {
  return substitutionDigits([{ evaluate: round => round(pl.numerator) / round(pl.denominator), result: t, resultDigits: 3 }]);
}

