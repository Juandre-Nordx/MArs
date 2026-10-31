import Phaser from 'phaser';
import {
  buildingDefinitions,
  infrastructureDefinitions,
  infrastructureTypeSchema,
  type BuildingType,
} from '@mars/simulation';
export type SpriteSpec = { key: string; originX: number; originY: number };
export function drawCraft(
  g: Phaser.GameObjects.Graphics,
  x: number,
  y: number,
  scale = 1,
) {
  const X = (v: number) => x + v * scale,
    Y = (v: number) => y + v * scale;
  g.fillStyle(0x182026, 0.35).fillEllipse(X(5), Y(4), 65 * scale, 22 * scale);
  g.fillStyle(0x859498).fillRoundedRect(
    X(-12),
    Y(-66),
    24 * scale,
    61 * scale,
    8 * scale,
  );
  g.fillStyle(0xe1e5e3).fillRoundedRect(
    X(-10),
    Y(-66),
    16 * scale,
    57 * scale,
    7 * scale,
  );
  g.fillStyle(0xf1f2ea).fillTriangle(
    X(-11),
    Y(-61),
    X(0),
    Y(-90),
    X(11),
    Y(-61),
  );
  g.lineStyle(1, 0x607378)
    .lineBetween(X(-10), Y(-38), X(11), Y(-38))
    .lineBetween(X(-10), Y(-22), X(11), Y(-22));
  g.fillStyle(0x253b4a).fillRoundedRect(
    X(-7),
    Y(-58),
    15 * scale,
    8 * scale,
    3 * scale,
  );
  g.lineStyle(1, 0x8dd6e4).lineBetween(X(-5), Y(-56), X(3), Y(-56));
  for (const sign of [-1, 1]) {
    g.fillStyle(0x9daeb1).fillTriangle(
      X(sign * 9),
      Y(-32),
      X(sign * 25),
      Y(-2),
      X(sign * 10),
      Y(-9),
    );
    g.lineStyle(3, 0x53666e)
      .lineBetween(X(sign * 9), Y(-10), X(sign * 20), Y(6))
      .lineBetween(X(sign * 17), Y(6), X(sign * 25), Y(6));
  }
  g.lineStyle(1, 0xffb663).lineBetween(X(-5), Y(-16), X(6), Y(-16));
}
function hull(
  g: Phaser.GameObjects.Graphics,
  x: number,
  y: number,
  w: number,
  h: number,
  height: number,
) {
  const corners = [
    { x, y: y - 16 },
    { x: x + 32 * w, y: y + 16 * w - 16 },
    { x: x + 32 * (w - h), y: y + 16 * (w + h) - 16 },
    { x: x - 32 * h, y: y + 16 * h - 16 },
  ];
  const roof = corners.map((p) => ({ x: p.x, y: p.y - height }));
  g.fillStyle(0x161c1e, 0.35).fillPoints(
    corners.map((p) => ({ x: p.x + 8, y: p.y + 6 })),
    true,
  );
  g.fillStyle(0x69777a).fillPoints(
    [roof[1]!, roof[2]!, corners[2]!, corners[1]!],
    true,
  );
  g.fillStyle(0x87928f).fillPoints(
    [roof[2]!, roof[3]!, corners[3]!, corners[2]!],
    true,
  );
  g.fillStyle(0xcfd3c8)
    .fillPoints(roof, true)
    .lineStyle(1, 0xf4eede, 0.85)
    .strokePoints(roof, true);
  g.lineStyle(1, 0x414e52, 0.6).lineBetween(
    corners[2]!.x,
    corners[2]!.y,
    roof[2]!.x,
    roof[2]!.y,
  );
}
export function installBuildingSprites(
  scene: Phaser.Scene,
): Record<BuildingType, SpriteSpec> {
  const specs = {} as Record<BuildingType, SpriteSpec>;
  for (const type of Object.keys(buildingDefinitions) as BuildingType[]) {
    const d = buildingDefinitions[type],
      padding = 30,
      top = 115,
      width = (d.width + d.height) * 32 + padding * 2,
      height = (d.width + d.height) * 16 + top + padding;
    const ox = 32 * d.height + padding,
      oy = top;
    const g = scene.add.graphics();
    const cx = ox + 16 * (d.width - d.height),
      cy = oy + 8 * (d.width + d.height - 2);
    hull(
      g,
      ox,
      oy,
      d.width,
      d.height,
      type === 'solar'
        ? 4
        : type === 'starship'
          ? 6
          : type === 'warehouse'
            ? 27
            : 15,
    );
    if (type === 'starship') {
      drawCraft(g, cx, cy - 4);
      g.lineStyle(2, 0xe5a562).strokeEllipse(cx, cy + 8, 65, 21);
    }
    if (type === 'housing') {
      g.fillStyle(0xa2ada9)
        .fillRoundedRect(cx - 23, cy - 29, 46, 22, 11)
        .fillEllipse(cx, cy - 17, 46, 21);
      g.fillStyle(0xe7e7db).fillEllipse(cx, cy - 27, 44, 21);
      g.lineStyle(1, 0x73878a)
        .strokeEllipse(cx, cy - 27, 44, 21)
        .lineBetween(cx - 9, cy - 36, cx - 9, cy - 17)
        .lineBetween(cx + 10, cy - 35, cx + 10, cy - 18);
      g.fillStyle(0x284b60)
        .fillRoundedRect(cx - 13, cy - 28, 25, 7, 2)
        .fillRoundedRect(cx - 4, cy - 15, 9, 13, 3);
      g.fillStyle(0xffce8a).fillRect(cx - 1, cy - 12, 2, 7);
      g.lineStyle(2, 0xd2b490).lineBetween(cx - 8, cy + 2, cx + 11, cy + 2);
    } else if (type.includes('tank')) {
      const blue = type === 'water-tank' ? 0x5598be : 0x62bda8;
      g.fillStyle(0x7a9096)
        .fillRect(cx - 13, cy - 43, 26, 36)
        .fillEllipse(cx, cy - 7, 26, 13);
      g.fillStyle(0xd8dfd9)
        .fillRect(cx - 11, cy - 43, 20, 34)
        .fillEllipse(cx, cy - 43, 26, 14);
      g.lineStyle(2, blue)
        .strokeEllipse(cx, cy - 32, 26, 12)
        .strokeEllipse(cx, cy - 14, 26, 12);
      g.fillStyle(0xf2eee1).fillEllipse(cx - 2, cy - 45, 19, 9);
      g.lineStyle(2, 0x526a73).lineBetween(cx + 10, cy - 41, cx + 10, cy - 1);
      g.fillStyle(blue).fillRect(cx - 4, cy - 30, 7, 12);
      g.lineStyle(3, blue).lineBetween(cx - 14, cy - 9, cx - 23, cy - 4);
    } else if (type === 'farm') {
      g.fillStyle(0x294c37).fillEllipse(cx, cy - 9, 91, 34);
      for (let i = -2; i <= 2; i++)
        g.lineStyle(4, 0x7ab85c).lineBetween(
          cx - 27 + i * 10,
          cy - 10 - i * 2,
          cx - 11 + i * 10,
          cy - 1 - i * 2,
        );
      g.fillStyle(0x83c5c2, 0.5).fillEllipse(cx, cy - 22, 98, 44);
      g.lineStyle(2, 0xd4ded2, 0.8).strokeEllipse(cx, cy - 22, 98, 44);
      for (let i = -2; i <= 2; i++)
        g.lineStyle(1, 0xe3ecde, 0.8).strokeEllipse(
          cx + i * 16,
          cy - 22,
          12,
          40 - Math.abs(i) * 6,
        );
      g.lineStyle(2, 0xeff9ef, 0.6).lineBetween(
        cx - 33,
        cy - 30,
        cx + 13,
        cy - 39,
      );
      g.fillStyle(0xb0bdb5).fillRoundedRect(cx + 35, cy - 13, 16, 15, 3);
    } else if (type === 'solar') {
      const base = { x: ox, y: oy - 10 };
      for (let x = 0; x < d.width; x++)
        for (let y = 0; y < d.height; y++) {
          const px = base.x + (x - y) * 32,
            py = base.y + (x + y) * 16;
          g.lineStyle(3, 0x596667).lineBetween(px, py + 3, px, py + 13);
          const panel = [
            { x: px, y: py - 14 },
            { x: px + 28, y: py },
            { x: px, y: py + 14 },
            { x: px - 28, y: py },
          ];
          g.fillStyle(0x263c69)
            .fillPoints(panel, true)
            .lineStyle(1, 0xb3c1ca)
            .strokePoints(panel, true);
          for (let i = -1; i <= 1; i++) {
            g.lineStyle(1, 0x6794c0).lineBetween(
              px - 14 + i * 7,
              py - 7 - i * 3.5,
              px + 14 + i * 7,
              py + 7 - i * 3.5,
            );
            g.lineBetween(
              px - 14 + i * 7,
              py + 7 + i * 3.5,
              px + 14 + i * 7,
              py - 7 + i * 3.5,
            );
          }
          g.lineStyle(2, 0xa7e5f8, 0.6).lineBetween(
            px - 17,
            py - 5,
            px + 3,
            py - 10,
          );
        }
    } else if (type === 'warehouse') {
      g.fillStyle(0x424d54).fillPoints(
        [
          { x: cx - 20, y: cy + 10 },
          { x: cx + 7, y: cy + 23 },
          { x: cx + 7, y: cy + 4 },
          { x: cx - 20, y: cy - 9 },
        ],
        true,
      );
      for (let i = 0; i < 4; i++)
        g.lineStyle(1, 0x9da6a2).lineBetween(
          cx - 18,
          cy - 5 + i * 5,
          cx + 5,
          cy + 6 + i * 5,
        );
      for (let i = 0; i < 4; i++)
        g.lineStyle(2, 0x87948e).lineBetween(
          cx - 27 + i * 16,
          cy - 34,
          cx - 7 + i * 16,
          cy - 24,
        );
      g.fillStyle(0xd79852).fillRect(cx + 18, cy - 11, 10, 7);
      g.fillStyle(0x6b7774).fillRoundedRect(cx + 20, cy - 2, 14, 10, 2);
    } else if (type === 'battery') {
      for (let i = 0; i < 3; i++) {
        const bx = cx - 22 + i * 18,
          by = cy - 22 + i * 4;
        g.fillStyle(0xe1e2d7).fillRoundedRect(bx, by, 15, 24, 3);
        g.fillStyle(0x4c6269).fillRect(bx + 2, by + 5, 11, 14);
        g.fillStyle(0x80e2ad).fillRect(bx + 4, by + 7, 7, 8);
        g.lineStyle(1, 0x333e42).lineBetween(bx + 3, by + 20, bx + 12, by + 20);
      }
    } else {
      g.fillStyle(0x667b82).fillRoundedRect(cx - 20, cy - 27, 37, 23, 3);
      g.fillStyle(0xe0e3d9).fillRoundedRect(cx - 23, cy - 31, 34, 20, 3);
      g.fillStyle(type === 'water-recycler' ? 0x64aed6 : 0x83cdbd).fillRect(
        cx - 18,
        cy - 26,
        12,
        8,
      );
      for (let i = 0; i < 3; i++)
        g.lineStyle(1, 0x48626a).lineBetween(
          cx - 18,
          cy - 14 + i * 2,
          cx + 3,
          cy - 14 + i * 2,
        );
      g.fillStyle(0x9fafa9)
        .fillRoundedRect(cx + 9, cy - 37, 11, 28, 4)
        .fillEllipse(cx + 14.5, cy - 37, 11, 7);
      g.lineStyle(3, type === 'water-recycler' ? 0x64aed6 : 0x83cdbd)
        .lineBetween(cx + 14, cy - 7, cx + 23, cy - 2)
        .lineBetween(cx + 23, cy - 2, cx + 23, cy + 7);
      g.lineStyle(2, 0xd4d9d0).lineBetween(cx - 9, cy - 33, cx - 9, cy - 43);
      g.fillStyle(0xf3bd76).fillCircle(cx - 9, cy - 44, 2);
    }
    const key = `mars-building-${type}`;
    g.generateTexture(key, width, height);
    g.destroy();
    specs[type] = { key, originX: ox / width, originY: oy / height };
  }
  return specs;
}
export function installInfrastructureSprites(scene: Phaser.Scene) {
  const directions = [
    { x: 16, y: -8 },
    { x: 16, y: 8 },
    { x: -16, y: 8 },
    { x: -16, y: -8 },
  ];
  for (const type of infrastructureTypeSchema.options)
    for (let mask = 0; mask < 16; mask++) {
      const g = scene.add.graphics();
      const color = infrastructureDefinitions[type].color;
      const offset = type === 'water' ? -3 : type === 'oxygen' ? 3 : 0;
      const x = 34 + offset,
        y = 18;
      if (type === 'road') {
        g.fillStyle(0x524b46, 0.75).fillEllipse(x, y, 22, 12);
        for (let i = 0; i < 4; i++)
          if (mask & (1 << i)) {
            const d = directions[i]!;
            g.lineStyle(15, 0x514c48).lineBetween(x, y, x + d.x, y + d.y);
            g.lineStyle(1, 0xa6977d, 0.7).lineBetween(x, y, x + d.x, y + d.y);
          }
        g.fillStyle(0x796e5d, 0.7).fillEllipse(x, y, 5, 2);
      } else {
        for (let i = 0; i < 4; i++)
          if (mask & (1 << i)) {
            const d = directions[i]!;
            g.lineStyle(type === 'power' ? 3 : 6, 0x152a31, 0.8).lineBetween(
              x + 1,
              y + 2,
              x + d.x + 1,
              y + d.y + 2,
            );
            g.lineStyle(type === 'power' ? 2 : 4, color).lineBetween(
              x,
              y,
              x + d.x,
              y + d.y,
            );
            g.lineStyle(1, 0xe2f7e9, 0.4).lineBetween(
              x,
              y - 1,
              x + d.x,
              y + d.y - 1,
            );
          }
        g.fillStyle(color).fillEllipse(
          x,
          y,
          type === 'power' ? 4 : 7,
          type === 'power' ? 3 : 5,
        );
      }
      g.generateTexture(`mars-infra-${type}-${mask}`, 68, 36);
      g.destroy();
    }
}
