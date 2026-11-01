import { describe, expect, it } from 'vitest';
import { runCommand, findColor, type ChatImage } from '../lib/chat';
import { sampleProject } from '../lib/templates';
import { wallMaterialAt, objectCorners, quadsOverlap } from '../lib/geometry';
import { roomWallSides } from '../lib/placement';
import type { Scene } from '../lib/types';

const ctx = (scene: Scene, image: ChatImage | null = null) => ({ scene, selection: null, floorId: 'f0', image, units: 'm' as const });
const img: ChatImage = { dataUrl: 'data:image/png;base64,xx', aspect: 0.6, palette: ['#8a9099', '#b38b4d'], bgRemoved: true, name: 'grey sofa' };
const run = (scene: Scene, text: string, image: ChatImage | null = null) => {
  const out = runCommand(text, ctx(scene, image));
  out.edit?.(scene);
  return out;
};

describe('design chat', () => {
  it('paints the hall inner faces with a HEX code, leaving neighbours alone', () => {
    const s = sampleProject().scene;
    const out = run(s, 'use this color code #C46A4A for that hall');
    expect(out.ok).toBe(true);
    const hall = s.rooms.find((r) => r.roomType === 'living')!;
    for (const { wall, side, from, to } of roomWallSides(s, hall)) expect(s.materials[wallMaterialAt(wall, side, (from + to) / 2)].colorHex).toBe('#c46a4a');
    const bed = s.rooms.find((r) => r.name === 'Master Bedroom')!;
    expect(roomWallSides(s, bed).some(({ wall, side, from, to }) => s.materials[wallMaterialAt(wall, side, (from + to) / 2)].colorHex === '#c46a4a')).toBe(false);
  });
  it('resolves "first bedroom" and places an attached image there', () => {
    const s = sampleProject().scene;
    const n = s.objects.length;
    const out = run(s, 'place this image on the first bedroom', img);
    expect(out.ok).toBe(true);
    expect(out.usedImage).toBe(true);
    const o = s.objects[n];
    expect(o.imageDataUrl).toBeTruthy();
    expect(o.estimated).toBe(true);
    expect(o.dims.w).toBeCloseTo(2.1); // "sofa" from the image name
  });
  it('hangs an image as wall art', () => {
    const s = sampleProject().scene;
    const out = run(s, 'put this image on the hall wall as art', img);
    expect(out.ok).toBe(true);
    expect(s.objects.at(-1)!.elevation).toBeGreaterThan(0.8);
  });
  it('adds catalog furniture with colour and accent', () => {
    const s = sampleProject().scene;
    const out = run(s, 'add an L-shaped sofa to the hall in #8A9099 with gold accent');
    expect(out.ok).toBe(true);
    const o = s.objects.at(-1)!;
    expect(o.assetId).toBe('sofa-l');
    expect(o.colorHex).toBe('#8a9099');
    expect(o.accentHex).toBe('#b38b4d');
  });
  it('sets floor materials and renames rooms', () => {
    const s = sampleProject().scene;
    run(s, 'marble floor in the kitchen');
    expect(s.rooms.find((r) => r.name === 'Kitchen')!.floorMaterialId).toBe('stone-marble');
    run(s, 'room 3 is a pooja room');
    expect(s.rooms[2].roomType).toBe('pooja');
  });
  it('asks which bedroom when ambiguous', () => {
    const s = sampleProject().scene;
    const out = run(s, 'paint the bedroom sage');
    expect(out.ok).toBe(false);
    expect(out.reply).toMatch(/Which one/);
  });
  it('parses colour names with modifiers', () => {
    expect(findColor(' light grey ')!.hex).not.toBe(findColor(' grey ')!.hex);
    expect(findColor(' rgb(10, 20, 30) ')!.hex).toBe('#0a141e');
  });
  it('uses image colours for walls', () => {
    const s = sampleProject().scene;
    const out = run(s, 'use the colours from this image for the kitchen', img);
    expect(out.ok).toBe(true);
    const k = s.rooms.find((r) => r.name === 'Kitchen')!;
    const { wall, side, from, to } = roomWallSides(s, k)[0];
    expect(s.materials[wallMaterialAt(wall, side, (from + to) / 2)].colorHex).toBe('#8a9099');
  });
});

describe('follow-ups', () => {
  it('describes a placed photo item with type and size', () => {
    const s = sampleProject().scene;
    const placed = runCommand('place this image in the kitchen', { scene: s, selection: null, floorId: 'f0', image: { ...img, name: 'x' }, units: 'm' });
    placed.edit!(s);
    const out = runCommand("it's an L-shaped sofa, 270 x 180 x 85 cm", { scene: s, selection: placed.select!, floorId: 'f0', image: null, units: 'm' });
    out.edit!(s);
    expect(s.objects.at(-1)!.dims).toEqual({ w: 2.7, d: 1.8, h: 0.85 });
  });
  it('keeps new wall furniture clear of existing items', () => {
    const s = sampleProject().scene;
    run(s, 'add a wardrobe to the master bedroom');
    const w = s.objects.at(-1)!;
    expect(w.assetId).toBe('wardrobe');
    const clash = s.objects.slice(0, -1).filter((o) => o.elevation < 0.5 && o.assetId !== 'rug' && quadsOverlap(objectCorners(w), objectCorners(o, -0.01)));
    expect(clash.map((c) => c.name)).toEqual([]);
  });
});
