export type AssetCategory = 'seating' | 'tables' | 'beds' | 'storage' | 'kitchen' | 'bath' | 'lighting' | 'decor' | 'office';
export type AssetStyle = 'modern' | 'scandinavian' | 'industrial' | 'classic' | 'indian-contemporary' | 'minimal' | 'boho' | 'luxury';

export interface Asset {
  id: string;
  name: string;
  category: AssetCategory;
  builder: string; // key into three/furniture builders
  dims: { w: number; h: number; d: number }; // metres
  colorHex: string;
  accentHex?: string;
  styles: AssetStyle[];
  price: number; // indicative, project currency
  /** Placement height above floor (wall-mounted items). */
  elevation?: number;
  licence: string;
  source: string;
}

const L = 'Original procedural model — free for commercial use (MIT, this repository)';
const S = 'Archiform built-in catalog';

export const CATALOG: Asset[] = [
  { id: 'sofa-3', name: '3-Seater Sofa', category: 'seating', builder: 'sofa', dims: { w: 2.1, h: 0.85, d: 0.9 }, colorHex: '#8a8f94', styles: ['modern', 'scandinavian', 'minimal'], price: 42000, licence: L, source: S },
  { id: 'sofa-l', name: 'L-Shaped Sectional', category: 'seating', builder: 'sectional', dims: { w: 2.7, h: 0.85, d: 1.8 }, colorHex: '#b9ae9c', styles: ['modern', 'indian-contemporary', 'luxury'], price: 78000, licence: L, source: S },
  { id: 'sofa-2', name: 'Loveseat', category: 'seating', builder: 'sofa', dims: { w: 1.5, h: 0.82, d: 0.85 }, colorHex: '#5e6b5a', styles: ['boho', 'classic', 'scandinavian'], price: 28000, licence: L, source: S },
  { id: 'armchair', name: 'Lounge Armchair', category: 'seating', builder: 'armchair', dims: { w: 0.85, h: 0.85, d: 0.85 }, colorHex: '#c08a5b', styles: ['modern', 'boho', 'industrial'], price: 16500, licence: L, source: S },
  { id: 'dining-chair', name: 'Dining Chair', category: 'seating', builder: 'chair', dims: { w: 0.46, h: 0.88, d: 0.52 }, colorHex: '#a27a52', styles: ['scandinavian', 'modern', 'classic', 'indian-contemporary'], price: 4500, licence: L, source: S },
  { id: 'bar-stool', name: 'Bar Stool', category: 'seating', builder: 'stool', dims: { w: 0.4, h: 0.75, d: 0.4 }, colorHex: '#2b2b2b', styles: ['industrial', 'modern'], price: 3800, licence: L, source: S },
  { id: 'coffee-table', name: 'Coffee Table', category: 'tables', builder: 'table', dims: { w: 1.1, h: 0.42, d: 0.6 }, colorHex: '#7b5a3c', styles: ['modern', 'scandinavian', 'minimal'], price: 9500, licence: L, source: S },
  { id: 'round-coffee', name: 'Round Coffee Table', category: 'tables', builder: 'roundTable', dims: { w: 0.8, h: 0.4, d: 0.8 }, colorHex: '#d9d4cc', accentHex: '#b38b4d', styles: ['luxury', 'boho', 'modern'], price: 12500, licence: L, source: S },
  { id: 'dining-6', name: 'Dining Table (6)', category: 'tables', builder: 'table', dims: { w: 1.8, h: 0.75, d: 0.9 }, colorHex: '#8b6a47', styles: ['scandinavian', 'classic', 'indian-contemporary'], price: 32000, licence: L, source: S },
  { id: 'dining-4', name: 'Dining Table (4)', category: 'tables', builder: 'table', dims: { w: 1.2, h: 0.75, d: 0.8 }, colorHex: '#c7a57d', styles: ['minimal', 'modern', 'scandinavian'], price: 19000, licence: L, source: S },
  { id: 'side-table', name: 'Side Table', category: 'tables', builder: 'roundTable', dims: { w: 0.45, h: 0.55, d: 0.45 }, colorHex: '#2a2a2a', accentHex: '#2a2a2a', styles: ['industrial', 'modern'], price: 3500, licence: L, source: S },
  { id: 'bed-king', name: 'King Bed', category: 'beds', builder: 'bed', dims: { w: 1.95, h: 1.0, d: 2.15 }, colorHex: '#8d7b68', accentHex: '#f1ede6', styles: ['modern', 'luxury', 'indian-contemporary'], price: 56000, licence: L, source: S },
  { id: 'bed-queen', name: 'Queen Bed', category: 'beds', builder: 'bed', dims: { w: 1.65, h: 1.0, d: 2.1 }, colorHex: '#c2a07a', accentHex: '#f4f1ea', styles: ['scandinavian', 'minimal', 'boho'], price: 42000, licence: L, source: S },
  { id: 'bed-single', name: 'Single Bed', category: 'beds', builder: 'bed', dims: { w: 1.0, h: 0.9, d: 2.0 }, colorHex: '#9aa5ad', accentHex: '#eef0f2', styles: ['modern', 'minimal'], price: 18000, licence: L, source: S },
  { id: 'nightstand', name: 'Bedside Table', category: 'storage', builder: 'cabinet', dims: { w: 0.5, h: 0.5, d: 0.42 }, colorHex: '#a6845e', styles: ['scandinavian', 'modern', 'classic'], price: 5200, licence: L, source: S },
  { id: 'wardrobe', name: 'Wardrobe 3-Door', category: 'storage', builder: 'wardrobe', dims: { w: 1.8, h: 2.2, d: 0.6 }, colorHex: '#e9e4da', accentHex: '#b38b4d', styles: ['modern', 'minimal', 'indian-contemporary'], price: 48000, licence: L, source: S },
  { id: 'bookshelf', name: 'Open Bookshelf', category: 'storage', builder: 'shelf', dims: { w: 1.0, h: 1.9, d: 0.35 }, colorHex: '#6b4a33', styles: ['industrial', 'classic', 'scandinavian'], price: 14000, licence: L, source: S },
  { id: 'tv-unit', name: 'TV Unit', category: 'storage', builder: 'tvUnit', dims: { w: 1.8, h: 0.5, d: 0.42 }, colorHex: '#3a3330', styles: ['modern', 'luxury', 'indian-contemporary'], price: 22000, licence: L, source: S },
  { id: 'sideboard', name: 'Sideboard', category: 'storage', builder: 'cabinet', dims: { w: 1.6, h: 0.8, d: 0.45 }, colorHex: '#8b6a47', styles: ['classic', 'scandinavian', 'boho'], price: 26000, licence: L, source: S },
  { id: 'kitchen-base', name: 'Kitchen Base Run (2.4 m)', category: 'kitchen', builder: 'counter', dims: { w: 2.4, h: 0.9, d: 0.6 }, colorHex: '#e8e4dc', accentHex: '#2f2f30', styles: ['modern', 'minimal', 'indian-contemporary'], price: 85000, licence: L, source: S },
  { id: 'kitchen-wall', name: 'Wall Cabinets (2.4 m)', category: 'kitchen', builder: 'cabinet', dims: { w: 2.4, h: 0.7, d: 0.35 }, colorHex: '#e8e4dc', elevation: 1.5, styles: ['modern', 'minimal', 'indian-contemporary'], price: 45000, licence: L, source: S },
  { id: 'island', name: 'Kitchen Island', category: 'kitchen', builder: 'counter', dims: { w: 1.8, h: 0.9, d: 0.9 }, colorHex: '#2f3a3a', accentHex: '#ecebe8', styles: ['luxury', 'modern'], price: 68000, licence: L, source: S },
  { id: 'fridge', name: 'Refrigerator', category: 'kitchen', builder: 'fridge', dims: { w: 0.7, h: 1.8, d: 0.7 }, colorHex: '#c9ccd0', styles: ['modern', 'minimal', 'industrial'], price: 38000, licence: L, source: S },
  { id: 'vanity', name: 'Vanity with Basin', category: 'bath', builder: 'vanity', dims: { w: 0.9, h: 0.85, d: 0.5 }, colorHex: '#d8d2c6', accentHex: '#ffffff', styles: ['modern', 'minimal', 'luxury'], price: 24000, licence: L, source: S },
  { id: 'wc', name: 'Wall-hung WC', category: 'bath', builder: 'toilet', dims: { w: 0.38, h: 0.8, d: 0.55 }, colorHex: '#ffffff', styles: ['modern', 'minimal', 'luxury'], price: 16000, licence: L, source: S },
  { id: 'shower', name: 'Shower Enclosure', category: 'bath', builder: 'shower', dims: { w: 0.9, h: 2.0, d: 0.9 }, colorHex: '#dfe7ea', styles: ['modern', 'minimal'], price: 30000, licence: L, source: S },
  { id: 'bathtub', name: 'Freestanding Bathtub', category: 'bath', builder: 'bathtub', dims: { w: 1.65, h: 0.6, d: 0.75 }, colorHex: '#ffffff', styles: ['luxury', 'classic'], price: 72000, licence: L, source: S },
  { id: 'desk', name: 'Work Desk', category: 'office', builder: 'desk', dims: { w: 1.4, h: 0.75, d: 0.7 }, colorHex: '#c7a57d', accentHex: '#2a2a2a', styles: ['scandinavian', 'industrial', 'minimal'], price: 15000, licence: L, source: S },
  { id: 'office-chair', name: 'Task Chair', category: 'office', builder: 'chair', dims: { w: 0.6, h: 1.05, d: 0.6 }, colorHex: '#2c2c2e', styles: ['modern', 'industrial'], price: 11000, licence: L, source: S },
  { id: 'floor-lamp', name: 'Floor Lamp', category: 'lighting', builder: 'floorLamp', dims: { w: 0.4, h: 1.65, d: 0.4 }, colorHex: '#f1e8d6', accentHex: '#202022', styles: ['scandinavian', 'modern', 'industrial', 'boho'], price: 6800, licence: L, source: S },
  { id: 'pendant', name: 'Pendant Light', category: 'lighting', builder: 'pendant', dims: { w: 0.45, h: 0.6, d: 0.45 }, colorHex: '#b38b4d', elevation: 1.95, styles: ['luxury', 'industrial', 'modern'], price: 7500, licence: L, source: S },
  { id: 'rug', name: 'Area Rug 2×3 m', category: 'decor', builder: 'rug', dims: { w: 3.0, h: 0.015, d: 2.0 }, colorHex: '#cdbfa8', accentHex: '#8a6f55', styles: ['boho', 'scandinavian', 'modern', 'indian-contemporary', 'classic'], price: 14000, licence: L, source: S },
  { id: 'plant', name: 'Potted Plant', category: 'decor', builder: 'plant', dims: { w: 0.5, h: 1.3, d: 0.5 }, colorHex: '#4f7a4a', accentHex: '#c9b8a0', styles: ['boho', 'scandinavian', 'modern', 'minimal', 'indian-contemporary'], price: 2500, licence: L, source: S },
  { id: 'art', name: 'Wall Art Frame', category: 'decor', builder: 'frame', dims: { w: 1.0, h: 0.7, d: 0.04 }, colorHex: '#c46a4a', accentHex: '#1f1f1f', elevation: 1.3, styles: ['modern', 'boho', 'minimal', 'luxury'], price: 4500, licence: L, source: S },
  { id: 'mirror', name: 'Round Mirror', category: 'decor', builder: 'mirror', dims: { w: 0.7, h: 0.7, d: 0.03 }, colorHex: '#b38b4d', elevation: 1.3, styles: ['luxury', 'boho', 'modern'], price: 5500, licence: L, source: S },
  { id: 'pooja-unit', name: 'Pooja Unit', category: 'storage', builder: 'pooja', dims: { w: 0.9, h: 1.8, d: 0.45 }, colorHex: '#9a6b3f', accentHex: '#d4a94e', styles: ['indian-contemporary', 'classic'], price: 26000, licence: L, source: S },
  { id: 'box', name: 'Generic Box (custom)', category: 'decor', builder: 'box', dims: { w: 0.6, h: 0.6, d: 0.6 }, colorHex: '#9ca3af', styles: ['minimal'], price: 0, licence: L, source: S },
];

export const CATEGORIES: { id: AssetCategory; label: string }[] = [
  { id: 'seating', label: 'Seating' }, { id: 'tables', label: 'Tables' }, { id: 'beds', label: 'Beds' },
  { id: 'storage', label: 'Storage' }, { id: 'kitchen', label: 'Kitchen' }, { id: 'bath', label: 'Bath' },
  { id: 'office', label: 'Office' }, { id: 'lighting', label: 'Lighting' }, { id: 'decor', label: 'Decor' },
];

export const STYLES: { id: AssetStyle; label: string }[] = [
  { id: 'modern', label: 'Modern' }, { id: 'scandinavian', label: 'Scandinavian' }, { id: 'industrial', label: 'Industrial' },
  { id: 'indian-contemporary', label: 'Indian Contemporary' }, { id: 'minimal', label: 'Minimal' }, { id: 'boho', label: 'Boho' },
  { id: 'luxury', label: 'Luxury' }, { id: 'classic', label: 'Classic' },
];

export const getAsset = (id: string) => CATALOG.find((a) => a.id === id);
