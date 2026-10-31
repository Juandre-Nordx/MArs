import Phaser from 'phaser';
import type { ColonyState, Tile } from '@mars/simulation';
import { tileToWorld } from './iso';
export function installActorSprites(scene: Phaser.Scene) {
  for (let frame = 0; frame < 2; frame++) {
    const g = scene.add.graphics(),
      stride = frame ? 2 : -2;
    g.fillStyle(0x172027, 0.4).fillEllipse(16, 32, 15, 5);
    g.lineStyle(3, 0x45565d)
      .lineBetween(14, 25, 12 + stride, 31)
      .lineBetween(18, 25, 20 - stride, 31);
    g.fillStyle(0x829698).fillRoundedRect(8, 16, 8, 12, 2);
    g.fillStyle(0xe2e6dd).fillRoundedRect(12, 16, 10, 12, 4);
    g.lineStyle(3, 0xc1cbc6)
      .lineBetween(12, 19, 9, 23 - stride)
      .lineBetween(21, 19, 24, 23 + stride);
    g.fillStyle(0xeeeede).fillCircle(17, 12, 6);
    g.lineStyle(1, 0x899da3).strokeCircle(17, 12, 6);
    g.fillStyle(0x1b3b50).fillRoundedRect(13, 9, 9, 5, 2);
    g.lineStyle(1, 0x9be7f4).lineBetween(15, 10, 20, 10);
    g.fillStyle(0xe88845).fillRect(17, 19, 3, 3);
    g.lineStyle(1, 0x65777b).lineBetween(13, 24, 20, 24);
    g.generateTexture(`mars-person-${frame}`, 32, 40);
    g.destroy();
  }
  const g = scene.add.graphics();
  g.fillStyle(0x182023, 0.4).fillEllipse(36, 42, 60, 14);
  for (const [x, y] of [
    [15, 34],
    [33, 43],
    [40, 22],
    [58, 33],
  ])
    g.fillStyle(0x1c2429)
      .fillEllipse(x!, y!, 12, 9)
      .fillStyle(0x778284)
      .fillEllipse(x!, y!, 5, 4);
  g.fillStyle(0x889998).fillPoints(
    [
      { x: 9, y: 27 },
      { x: 38, y: 14 },
      { x: 64, y: 28 },
      { x: 35, y: 42 },
    ],
    true,
  );
  g.fillStyle(0xd7ded5).fillPoints(
    [
      { x: 10, y: 24 },
      { x: 38, y: 10 },
      { x: 64, y: 24 },
      { x: 35, y: 38 },
    ],
    true,
  );
  g.fillStyle(0x557b8d).fillPoints(
    [
      { x: 24, y: 19 },
      { x: 39, y: 8 },
      { x: 54, y: 17 },
      { x: 38, y: 27 },
    ],
    true,
  );
  g.lineStyle(2, 0xc7d5cd)
    .strokePoints(
      [
        { x: 24, y: 19 },
        { x: 39, y: 8 },
        { x: 54, y: 17 },
        { x: 38, y: 27 },
      ],
      true,
    )
    .lineBetween(39, 8, 38, 27);
  g.lineStyle(2, 0xe5a060).lineBetween(13, 25, 34, 36);
  g.fillStyle(0xfff1ba).fillCircle(57, 23, 2).fillCircle(62, 26, 2);
  g.lineStyle(1, 0xbccbc3).lineBetween(20, 20, 18, 3);
  g.fillStyle(0xee9453).fillTriangle(18, 3, 18, 11, 27, 7);
  g.generateTexture('mars-arrival-buggy', 72, 52);
  g.destroy();
}
export class ActorRenderer {
  private images = new Map<string, Phaser.GameObjects.Image>();
  private ring: Phaser.GameObjects.Graphics;
  private tick = -1;
  private progress = 1;
  constructor(private scene: Phaser.Scene) {
    installActorSprites(scene);
    this.ring = scene.add.graphics();
  }
  reset() {
    this.ring.clear();
    this.tick = -1;
    this.progress = 1;
    for (const image of this.images.values()) image.destroy();
    this.images.clear();
  }
  pickResident(x: number, y: number): string | null {
    return (
      [...this.images.entries()]
        .filter(
          ([id, image]) =>
            id.startsWith('colonist-') &&
            image.visible &&
            x >= image.x - 9 &&
            x <= image.x + 11 &&
            y >= image.y - 27 &&
            y <= image.y + 1,
        )
        .sort((a, b) => b[1].depth - a[1].depth)[0]?.[0] ?? null
    );
  }
  update(
    state: ColonyState | null,
    delta: number,
    selected: string | null = null,
  ) {
    this.ring.clear();
    if (!state || state.phase !== 'active') {
      for (const image of this.images.values()) image.setVisible(false);
      return;
    }
    if (this.tick !== state.tick) {
      this.progress = this.tick < 0 ? 1 : 0;
      this.tick = state.tick;
    } else
      this.progress = Math.min(1, this.progress + (delta * state.speed) / 1000);
    const ids = new Set<string>();
    const place = (
      id: string,
      position: Tile,
      previous: Tile,
      texture: string,
      buggy = false,
    ) => {
      ids.add(id);
      let image = this.images.get(id);
      if (!image) {
        image = this.scene.add
          .image(0, 0, texture)
          .setOrigin(0.5, buggy ? 42 / 52 : 32 / 40);
        this.images.set(id, image);
      }
      const x = previous.x + (position.x - previous.x) * this.progress,
        y = previous.y + (position.y - previous.y) * this.progress,
        p = tileToWorld(x, y);
      image
        .setVisible(true)
        .setTexture(texture)
        .setPosition(p.x, p.y)
        .setDepth((x + y) * 10 + 5);
      if (id === selected)
        this.ring
          .setDepth((x + y) * 10 + 4)
          .lineStyle(2, 0xffc68a)
          .strokeEllipse(p.x, p.y + 1, 20, 9);
      const dx = position.x - position.y - (previous.x - previous.y);
      if (dx) image.setFlipX(dx < 0);
    };
    for (const [i, r] of state.residents.entries()) {
      const moving =
        r.position.x !== r.previousPosition.x ||
        r.position.y !== r.previousPosition.y;
      const frame = moving ? Math.floor(this.progress * 4 + i) % 2 : 0;
      place(r.id, r.position, r.previousPosition, `mars-person-${frame}`);
    }
    const buggy = state.immigration.convoy;
    if (buggy)
      place(
        buggy.id,
        buggy.position,
        buggy.previousPosition,
        'mars-arrival-buggy',
        true,
      );
    for (const [id, image] of this.images)
      if (!ids.has(id)) {
        image.destroy();
        this.images.delete(id);
      }
  }
}
