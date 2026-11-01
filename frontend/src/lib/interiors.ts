import type { CeilingDesign, CeilingType } from './types';

/**
 * False-ceiling options. Rates are indicative 2026 Indian market placeholders in ₹ per sq ft of
 * ceiling area (gypsum/POP on a metal frame, incl. paint; cove LED and spotlight fittings extra-included).
 */
export const CEILING_TYPES: { type: CeilingType; label: string; note: string; ratePerSqft: number; defaults: Partial<CeilingDesign> }[] = [
  { type: 'none', label: 'No false ceiling', note: 'Painted slab only.', ratePerSqft: 0, defaults: {} },
  { type: 'border', label: 'Border band + spotlights', note: 'Slim POP/gypsum border that hides wiring; budget friendly.', ratePerSqft: 90, defaults: { drop: 0.15, border: 0.6, coveLight: false, spotlights: true } },
  { type: 'cove-tray', label: 'Cove tray (hidden LED)', note: 'Most requested living-room ceiling; warm indirect glow. Needs ~9.5 ft room height.', ratePerSqft: 180, defaults: { drop: 0.2, border: 0.6, coveLight: true, spotlights: true } },
  { type: 'layered', label: 'Layered 2-step with cove', note: 'Premium look for halls and master bedrooms.', ratePerSqft: 230, defaults: { drop: 0.25, border: 0.55, coveLight: true, spotlights: true } },
  { type: 'circular', label: 'Circular POP with cove', note: 'Classic centre feature, often with a chandelier.', ratePerSqft: 210, defaults: { drop: 0.2, border: 0.6, coveLight: true, spotlights: false } },
  { type: 'wooden-slats', label: 'Tray with wooden slats', note: 'Warm wood accent; pairs with cove light.', ratePerSqft: 380, defaults: { drop: 0.2, border: 0.5, coveLight: true, spotlights: true } },
];

export const SQFT_PER_M2 = 10.7639;

export function defaultCeiling(type: CeilingType): CeilingDesign {
  const t = CEILING_TYPES.find((c) => c.type === type) ?? CEILING_TYPES[0];
  return { type, drop: 0.2, border: 0.6, coveLight: false, lightWarmth: 0.7, spotlights: false, ...t.defaults };
}

/** Clear height under the dropped part of the ceiling, and whether it meets the usual guidance. */
export function ceilingClearance(ceilingHeight: number, design?: CeilingDesign) {
  const clear = ceilingHeight - (design && design.type !== 'none' ? design.drop : 0);
  const recommendedSlab = 2.9; // ≈ 9.5 ft
  return { clear, ok: !design || design.type === 'none' || (ceilingHeight >= recommendedSlab - 0.05 && clear >= 2.55) };
}
