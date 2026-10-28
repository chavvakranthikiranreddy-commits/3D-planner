import type { Material } from './types';

/** Built-in material presets. Patterns are generated procedurally in the browser — no third-party texture licences. */
export const MATERIAL_PRESETS: Material[] = [
  { id: 'paint-white', name: 'Matte White Paint', kind: 'paint', colorHex: '#f4f1ea', roughness: 0.92, metalness: 0, pattern: 'none', pricePerM2: 35 },
  { id: 'paint-greige', name: 'Warm Greige', kind: 'paint', colorHex: '#d8cfc2', roughness: 0.9, metalness: 0, pattern: 'none', pricePerM2: 38 },
  { id: 'paint-sage', name: 'Sage Green', kind: 'paint', colorHex: '#a8b5a0', roughness: 0.9, metalness: 0, pattern: 'none', pricePerM2: 40 },
  { id: 'paint-terracotta', name: 'Terracotta', kind: 'paint', colorHex: '#c46a4a', roughness: 0.9, metalness: 0, pattern: 'none', pricePerM2: 42 },
  { id: 'paint-navy', name: 'Deep Navy', kind: 'paint', colorHex: '#2c3a52', roughness: 0.88, metalness: 0, pattern: 'none', pricePerM2: 42 },
  { id: 'paint-charcoal', name: 'Charcoal', kind: 'paint', colorHex: '#3d3d3f', roughness: 0.9, metalness: 0, pattern: 'none', pricePerM2: 40 },
  { id: 'wood-oak', name: 'Natural Oak', kind: 'wood', colorHex: '#c29a6b', roughness: 0.7, metalness: 0, pattern: 'wood', textureScale: 1.2, pricePerM2: 2800 },
  { id: 'wood-walnut', name: 'Walnut', kind: 'wood', colorHex: '#6b4a33', roughness: 0.65, metalness: 0, pattern: 'wood', textureScale: 1.2, pricePerM2: 3600 },
  { id: 'wood-herringbone', name: 'Oak Herringbone', kind: 'wood', colorHex: '#b98d5f', roughness: 0.68, metalness: 0, pattern: 'herringbone', textureScale: 1, pricePerM2: 4200 },
  { id: 'stone-marble', name: 'White Marble', kind: 'stone', colorHex: '#ecebe8', roughness: 0.25, metalness: 0, pattern: 'marble', textureScale: 2, pricePerM2: 3200 },
  { id: 'stone-terrazzo', name: 'Terrazzo', kind: 'stone', colorHex: '#e4ddd2', roughness: 0.35, metalness: 0, pattern: 'terrazzo', textureScale: 1, pricePerM2: 1900 },
  { id: 'tile-vitrified', name: 'Vitrified Tile 60×60', kind: 'tile', colorHex: '#d9d6d0', roughness: 0.3, metalness: 0, pattern: 'tile', textureScale: 1.2, pricePerM2: 900 },
  { id: 'tile-slate', name: 'Slate Tile', kind: 'tile', colorHex: '#5d6166', roughness: 0.6, metalness: 0, pattern: 'tile', textureScale: 1.2, pricePerM2: 1400 },
  { id: 'concrete', name: 'Polished Concrete', kind: 'concrete', colorHex: '#a7a59f', roughness: 0.55, metalness: 0, pattern: 'concrete', textureScale: 3, pricePerM2: 1100 },
  { id: 'fabric-linen', name: 'Linen', kind: 'fabric', colorHex: '#d6cbb8', roughness: 1, metalness: 0, pattern: 'fabric', textureScale: 0.4, pricePerM2: 600 },
  { id: 'metal-brass', name: 'Brushed Brass', kind: 'metal', colorHex: '#b38b4d', roughness: 0.35, metalness: 0.85, pattern: 'none', pricePerM2: 5000 },
  { id: 'metal-black', name: 'Matte Black Metal', kind: 'metal', colorHex: '#202022', roughness: 0.5, metalness: 0.7, pattern: 'none', pricePerM2: 3000 },
  { id: 'ceiling-white', name: 'Ceiling White', kind: 'paint', colorHex: '#fbfaf7', roughness: 0.95, metalness: 0, pattern: 'none', pricePerM2: 30 },
];

export function defaultMaterials(): Record<string, Material> {
  const out: Record<string, Material> = {};
  for (const m of MATERIAL_PRESETS) out[m.id] = { ...m };
  return out;
}

export const isHex = (s: string) => /^#?[0-9a-f]{6}$/i.test(s.trim());
export const normHex = (s: string) => {
  const t = s.trim().replace('#', '');
  return `#${t.toLowerCase()}`;
};
export function hexToRgb(hex: string) {
  const h = hex.replace('#', '');
  return { r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16) };
}
export const rgbToHex = (r: number, g: number, b: number) =>
  '#' + [r, g, b].map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');
export function parseColorInput(s: string): string | null {
  const t = s.trim();
  if (isHex(t)) return normHex(t);
  const m = t.match(/^rgb\s*\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*\)$/i);
  if (m) return rgbToHex(+m[1], +m[2], +m[3]);
  return null;
}
