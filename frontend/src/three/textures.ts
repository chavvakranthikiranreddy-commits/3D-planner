import * as THREE from 'three';
import type { Material } from '../lib/types';
import { hexToRgb } from '../lib/materials';

/** Deterministic PRNG so procedural textures are stable between reloads. */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

const cache = new Map<string, THREE.Texture>();

function shade(hex: string, f: number) {
  const { r, g, b } = hexToRgb(hex);
  const k = (v: number) => Math.max(0, Math.min(255, Math.round(v * f)));
  return `rgb(${k(r)},${k(g)},${k(b)})`;
}

function drawPattern(ctx: CanvasRenderingContext2D, size: number, pattern: string, hex: string) {
  const r = rng(42);
  ctx.fillStyle = hex;
  ctx.fillRect(0, 0, size, size);
  switch (pattern) {
    case 'wood': {
      const planks = 4;
      const pw = size / planks;
      for (let i = 0; i < planks; i++) {
        ctx.fillStyle = shade(hex, 0.9 + r() * 0.2);
        ctx.fillRect(i * pw, 0, pw, size);
        for (let g = 0; g < 26; g++) {
          ctx.strokeStyle = shade(hex, 0.78 + r() * 0.15);
          ctx.globalAlpha = 0.35;
          ctx.lineWidth = 0.6 + r() * 1.4;
          const x = i * pw + r() * pw;
          ctx.beginPath();
          ctx.moveTo(x, 0);
          for (let y = 0; y <= size; y += 16) ctx.lineTo(x + Math.sin(y / 40 + g) * 2.5, y);
          ctx.stroke();
        }
        ctx.globalAlpha = 1;
        ctx.fillStyle = shade(hex, 0.6);
        ctx.fillRect(i * pw, 0, 1.5, size);
        const cut = r() * size;
        ctx.fillRect(i * pw, cut, pw, 1.5);
      }
      break;
    }
    case 'herringbone': {
      const w = size / 8, l = w * 3;
      ctx.save();
      for (let y = -size; y < size * 2; y += w) {
        for (let x = -size; x < size * 2; x += l * 2) {
          for (const flip of [0, 1]) {
            ctx.save();
            ctx.translate(x + flip * l + (y / w) * w, y);
            ctx.rotate(flip ? -Math.PI / 4 : Math.PI / 4);
            ctx.fillStyle = shade(hex, 0.85 + r() * 0.25);
            ctx.fillRect(0, 0, l, w);
            ctx.strokeStyle = shade(hex, 0.6);
            ctx.lineWidth = 1.2;
            ctx.strokeRect(0, 0, l, w);
            ctx.restore();
          }
        }
      }
      ctx.restore();
      break;
    }
    case 'marble': {
      for (let v = 0; v < 14; v++) {
        ctx.strokeStyle = v % 3 === 0 ? 'rgba(120,120,125,0.35)' : 'rgba(150,150,155,0.18)';
        ctx.lineWidth = 0.5 + r() * 2.2;
        ctx.beginPath();
        let x = r() * size, y = 0;
        ctx.moveTo(x, y);
        while (y < size) {
          x += (r() - 0.5) * 40;
          y += 10 + r() * 30;
          ctx.lineTo(x, y);
        }
        ctx.stroke();
      }
      break;
    }
    case 'terrazzo': {
      const chips = ['#b8a89a', '#7d8a8c', '#e9e3d9', '#c9a27e', '#9a9a96', '#6f6459'];
      for (let i = 0; i < 520; i++) {
        ctx.fillStyle = chips[Math.floor(r() * chips.length)];
        ctx.beginPath();
        const cx = r() * size, cy = r() * size, rad = 1 + r() * 6;
        ctx.ellipse(cx, cy, rad, rad * (0.5 + r() * 0.5), r() * Math.PI, 0, Math.PI * 2);
        ctx.fill();
      }
      break;
    }
    case 'tile': {
      const n = 2;
      const t = size / n;
      for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
        ctx.fillStyle = shade(hex, 0.95 + r() * 0.08);
        ctx.fillRect(i * t, j * t, t, t);
      }
      ctx.strokeStyle = shade(hex, 0.7);
      ctx.lineWidth = 3;
      for (let i = 0; i <= n; i++) {
        ctx.beginPath(); ctx.moveTo(i * t, 0); ctx.lineTo(i * t, size); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(0, i * t); ctx.lineTo(size, i * t); ctx.stroke();
      }
      break;
    }
    case 'concrete': {
      const img = ctx.getImageData(0, 0, size, size);
      for (let i = 0; i < img.data.length; i += 4) {
        const n = (r() - 0.5) * 22;
        img.data[i] += n; img.data[i + 1] += n; img.data[i + 2] += n;
      }
      ctx.putImageData(img, 0, 0);
      for (let i = 0; i < 40; i++) {
        ctx.fillStyle = `rgba(0,0,0,${r() * 0.05})`;
        ctx.beginPath();
        ctx.arc(r() * size, r() * size, 10 + r() * 50, 0, Math.PI * 2);
        ctx.fill();
      }
      break;
    }
    case 'fabric': {
      for (let i = 0; i < size; i += 3) {
        ctx.fillStyle = `rgba(0,0,0,${0.04 + r() * 0.05})`;
        ctx.fillRect(i, 0, 1, size);
        ctx.fillStyle = `rgba(255,255,255,${0.03 + r() * 0.05})`;
        ctx.fillRect(0, i, size, 1);
      }
      break;
    }
  }
}

export function getMaterialTexture(m: Material): THREE.Texture | null {
  if (m.textureDataUrl) {
    const key = 'img:' + m.id + ':' + m.textureDataUrl.length;
    let t = cache.get(key);
    if (!t) {
      t = new THREE.TextureLoader().load(m.textureDataUrl);
      t.wrapS = t.wrapT = THREE.RepeatWrapping;
      t.colorSpace = THREE.SRGBColorSpace;
      cache.set(key, t);
    }
    return t;
  }
  if (!m.pattern || m.pattern === 'none') return null;
  const key = `${m.pattern}:${m.colorHex}`;
  let t = cache.get(key);
  if (!t) {
    const size = 512;
    const c = document.createElement('canvas');
    c.width = c.height = size;
    const ctx = c.getContext('2d')!;
    drawPattern(ctx, size, m.pattern, m.colorHex);
    t = new THREE.CanvasTexture(c);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 4;
    cache.set(key, t);
  }
  return t;
}

/** Swatch image for the UI. */
export function materialSwatch(m: Material, size = 64): string {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d')!;
  if (m.pattern && m.pattern !== 'none') {
    const big = document.createElement('canvas');
    big.width = big.height = 256;
    drawPattern(big.getContext('2d')!, 256, m.pattern, m.colorHex);
    ctx.drawImage(big, 0, 0, size, size);
  } else {
    ctx.fillStyle = m.colorHex;
    ctx.fillRect(0, 0, size, size);
    if (m.metalness > 0.5) {
      const g = ctx.createLinearGradient(0, 0, size, size);
      g.addColorStop(0, 'rgba(255,255,255,0.35)'); g.addColorStop(0.5, 'rgba(255,255,255,0)'); g.addColorStop(1, 'rgba(0,0,0,0.25)');
      ctx.fillStyle = g; ctx.fillRect(0, 0, size, size);
    }
  }
  return c.toDataURL();
}
