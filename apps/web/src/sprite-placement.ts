import { footprintCorners } from './iso';

type Footprint = { width: number; height: number };

// Keep compact tanks distinct from large facilities without changing their tile occupancy.
const footprintFill = new Map<string, number>([
  ['starship', 0.96],
  ['housing', 0.8],
  ['oxygen-generator', 0.82],
  ['oxygen-tank', 0.64],
  ['water-recycler', 0.78],
  ['water-tank', 0.64],
  ['farm', 0.9],
  ['solar', 0.96],
  ['battery', 0.85],
  ['warehouse', 0.86],
  ['survey-station', 0.84],
  ['surface-mine', 0.86],
  ['underground-mine', 0.84],
  ['ice-drill', 0.8],
  ['deep-mine', 0.88],
]);

export function spritePlacement(
  footprint: Footprint,
  art: {
    id?: string;
    scale: number;
    anchor?: { x: number };
    spriteAlignment?: 'tile-center' | 'footprint-front';
  },
  courtyard = false,
) {
  const footprintAligned =
    art.spriteAlignment === 'footprint-front' ||
    (courtyard && art.spriteAlignment === undefined);
  if (!footprintAligned) return { x: 0, y: 0, width: 128 * art.scale };

  const [, right, front, left] = footprintCorners(
    0,
    0,
    footprint.width,
    footprint.height,
  );
  const width = right.x - left.x;
  if (!courtyard) return { ...front, width: width * art.scale };

  // The bottom point of a rectangular plot can be off-centre. Fit both sides
  // of the image around its authored anchor before applying the manual scale.
  const anchorX = art.anchor?.x ?? (front.x - left.x) / width;
  const leftFit = anchorX > 0 ? (front.x - left.x) / anchorX : width;
  const rightFit = anchorX < 1 ? (right.x - front.x) / (1 - anchorX) : width;
  const fill = footprintFill.get(art.id ?? '') ?? 0.85;
  return { ...front, width: Math.min(leftFit, rightFit) * art.scale * fill };
}
