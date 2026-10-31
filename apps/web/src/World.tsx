import { useEffect, useRef } from 'react';
import Phaser from 'phaser';
import {
  buildingDefinitions,
  footprint,
  generateTerrain,
  placement,
  type BuildingType,
  type ColonyState,
  type Tile,
} from '@mars/simulation';
import { tileToWorld, worldToTile, WORLD_SIZE } from './iso';
type Props = {
  colony: ColonyState | null;
  mission: number;
  selected: Tile | null;
  construction: BuildingType | null;
  onSelect: (tile: Tile) => void;
  onHover: (tile: Tile | null) => void;
  onTouchdown: () => void;
};
function diamond(x: number, y: number) {
  return [
    { x, y: y - 16 },
    { x: x + 32, y },
    { x, y: y + 16 },
    { x: x - 32, y },
  ];
}
export function World(props: Props) {
  const host = useRef<HTMLDivElement>(null);
  const latest = useRef(props);
  latest.current = props;
  useEffect(() => {
    if (!host.current) return;
    class MarsScene extends Phaser.Scene {
      private terrain!: Phaser.GameObjects.Graphics;
      private structures!: Phaser.GameObjects.Graphics;
      private overlay!: Phaser.GameObjects.Graphics;
      private ship!: Phaser.GameObjects.Graphics;
      private seed = -1;
      private mission = -1;
      private signature = '';
      private landingStarted = 0;
      private landed = false;
      private hover: Tile | null = null;
      create() {
        this.terrain = this.add.graphics();
        this.structures = this.add.graphics();
        this.overlay = this.add.graphics().setDepth(10000);
        this.ship = this.add.graphics().setDepth(10001);
        const camera = this.cameras.main;
        camera.setBackgroundColor('#21191a');
        camera.centerOn(0, 300);
        let startX = 0;
        let startY = 0;
        let moved = false;
        const tileAt = (p: Phaser.Input.Pointer): Tile | null => {
          const point = camera.getWorldPoint(p.x, p.y);
          const tile = worldToTile(point.x, point.y);
          return tile.x < 0 ||
            tile.y < 0 ||
            tile.x >= WORLD_SIZE ||
            tile.y >= WORLD_SIZE
            ? null
            : tile;
        };
        this.input.on('pointerdown', (p: Phaser.Input.Pointer) => {
          startX = p.x;
          startY = p.y;
          moved = false;
        });
        this.input.on('pointermove', (p: Phaser.Input.Pointer) => {
          if (p.isDown && Math.hypot(p.x - startX, p.y - startY) > 5)
            moved = true;
          if (p.isDown && moved) {
            camera.scrollX -= (p.x - p.prevPosition.x) / camera.zoom;
            camera.scrollY -= (p.y - p.prevPosition.y) / camera.zoom;
          }
          this.hover = tileAt(p);
          latest.current.onHover(this.hover);
        });
        this.input.on('pointerup', (p: Phaser.Input.Pointer) => {
          if (moved) return;
          const tile = tileAt(p);
          if (tile) latest.current.onSelect(tile);
        });
        this.input.on('gameout', () => {
          this.hover = null;
          latest.current.onHover(null);
        });
        this.input.on(
          'wheel',
          (
            _p: Phaser.Input.Pointer,
            _objects: unknown[],
            _dx: number,
            dy: number,
          ) => {
            camera.setZoom(
              Phaser.Math.Clamp(camera.zoom * Math.exp(-dy * 0.001), 0.4, 2.5),
            );
          },
        );
      }
      private drawTerrain(seed: number, colony: ColonyState | null) {
        this.terrain.clear();
        for (const tile of generateTerrain(seed)) {
          const p = tileToWorld(tile.x, tile.y);
          const colors = {
            dust: [0x874735, 0x934c36, 0x9a523a],
            sand: [0xa96542, 0xb16b46, 0xa55f3e],
            basalt: [0x64504a, 0x70554b, 0x765d50],
          };
          this.terrain
            .fillStyle(colors[tile.texture][tile.shade]!)
            .fillPoints(diamond(p.x, p.y), true);
          this.terrain
            .lineStyle(1, 0xc78158, 0.18)
            .strokePoints(diamond(p.x, p.y), true);
          // Decorative surface details do not enter collision or accessibility data.
          const nearLanding =
            colony &&
            Math.abs(tile.x - colony.landingZone.x) <= 2 &&
            Math.abs(tile.y - colony.landingZone.y) <= 2;
          if (
            !nearLanding &&
            (tile.decoration === 'rock' || tile.decoration === 'boulder')
          ) {
            const size = tile.decoration === 'boulder' ? 8 : 4;
            this.terrain
              .fillStyle(0x332c2a, 0.4)
              .fillEllipse(p.x + 3, p.y + 4, size * 3, size);
            this.terrain
              .fillStyle(0x796459)
              .fillTriangle(
                p.x - size,
                p.y + 1,
                p.x,
                p.y - size,
                p.x + size,
                p.y + 2,
              );
            this.terrain
              .lineStyle(1, 0xc39b7e)
              .lineBetween(p.x - size, p.y + 1, p.x, p.y - size);
          } else if (tile.decoration === 'ripples') {
            this.terrain
              .lineStyle(1, 0xd08e64, 0.45)
              .lineBetween(p.x - 12, p.y + 2, p.x + 2, p.y - 5)
              .lineBetween(p.x - 2, p.y + 6, p.x + 12, p.y - 1);
          }
        }
      }
      private drawBuildings(colony: ColonyState) {
        this.structures.clear();
        const buildings = [...colony.buildings].sort(
          (a, b) => a.x + a.y - b.x - b.y,
        );
        for (const building of buildings) {
          const definition = buildingDefinitions[building.type];
          for (const tile of footprint(building.type, building)) {
            const p = tileToWorld(tile.x, tile.y);
            this.structures
              .fillStyle(0x241f21, 0.65)
              .fillPoints(diamond(p.x + 3, p.y + 5), true);
            this.structures
              .fillStyle(definition.color)
              .fillPoints(diamond(p.x, p.y - 8), true);
            this.structures.fillStyle(0x39464a).fillPoints(
              [
                { x: p.x - 32, y: p.y - 8 },
                { x: p.x, y: p.y + 8 },
                { x: p.x, y: p.y + 16 },
                { x: p.x - 32, y: p.y },
              ],
              true,
            );
            this.structures
              .lineStyle(1, 0xffffff, 0.35)
              .strokePoints(diamond(p.x, p.y - 8), true);
            if (building.type === 'solar') {
              this.structures
                .lineStyle(1, 0x889dd8)
                .lineBetween(p.x - 20, p.y - 8, p.x + 4, p.y + 4)
                .lineBetween(p.x - 4, p.y - 20, p.x + 20, p.y - 8);
            }
            if (building.type === 'farm')
              this.structures
                .fillStyle(0x234d32)
                .fillEllipse(p.x, p.y - 8, 34, 10);
            if (building.type.includes('tank'))
              this.structures
                .fillStyle(0xa6d2d9)
                .fillRoundedRect(p.x - 10, p.y - 27, 20, 23, 5);
            if (building.type === 'housing')
              this.structures
                .fillStyle(0xffc777)
                .fillRect(p.x - 8, p.y - 12, 16, 4);
          }
          const p = tileToWorld(building.x, building.y);
          if (building.type === 'starship')
            this.drawShip(this.structures, p.x, p.y - 12, 1);
          const warning = [
            'no-power',
            'no-input',
            'disabled',
            'no-workers',
          ].includes(building.status);
          this.structures
            .fillStyle(warning ? 0xf67b5b : 0x8be1c1)
            .fillCircle(p.x + 12, p.y - 21, 3);
        }
      }
      private drawShip(
        graphics: Phaser.GameObjects.Graphics,
        x: number,
        y: number,
        scale: number,
      ) {
        graphics
          .fillStyle(0xb8c4c6)
          .fillRoundedRect(
            x - 10 * scale,
            y - 57 * scale,
            20 * scale,
            49 * scale,
            6,
          );
        graphics
          .fillStyle(0xe8ece5)
          .fillTriangle(
            x - 10 * scale,
            y - 53 * scale,
            x,
            y - 76 * scale,
            x + 10 * scale,
            y - 53 * scale,
          );
        graphics
          .fillStyle(0x435466)
          .fillRect(x - 7 * scale, y - 48 * scale, 14 * scale, 8 * scale);
        graphics
          .fillStyle(0x899aa0)
          .fillTriangle(
            x - 10 * scale,
            y - 28 * scale,
            x - 22 * scale,
            y,
            x - 7 * scale,
            y - 8 * scale,
          )
          .fillTriangle(
            x + 10 * scale,
            y - 28 * scale,
            x + 22 * scale,
            y,
            x + 7 * scale,
            y - 8 * scale,
          );
      }
      update(time: number) {
        const { colony, mission, selected, construction } = latest.current;
        if (this.seed !== (colony?.seed ?? 1) || this.mission !== mission) {
          this.seed = colony?.seed ?? 1;
          this.mission = mission;
          this.signature = '';
          this.landed = false;
          this.landingStarted = time;
          this.drawTerrain(this.seed, colony);
          if (colony) {
            const p = tileToWorld(colony.landingZone.x, colony.landingZone.y);
            this.cameras.main.centerOn(p.x, p.y);
          }
        }
        const signature = JSON.stringify(
          colony?.buildings.map((b) => [b.id, b.status, b.enabled, b.health]) ??
            [],
        );
        if (signature !== this.signature) {
          this.signature = signature;
          this.structures.clear();
          if (colony) this.drawBuildings(colony);
        }
        this.ship.clear();
        if (colony?.phase === 'landing') {
          const progress = Math.min(1, (time - this.landingStarted) / 4500);
          const p = tileToWorld(colony.landingZone.x, colony.landingZone.y);
          const height = (1 - progress) * 260;
          this.ship
            .fillStyle(0x1b1514, 0.25)
            .fillEllipse(p.x, p.y + 8, 50 + 30 * progress, 20);
          this.ship
            .fillStyle(0xffbe61, 0.8)
            .fillTriangle(
              p.x - 8,
              p.y - height - 10,
              p.x + 8,
              p.y - height - 10,
              p.x,
              p.y - height + 20 + Math.sin(time / 60) * 7,
            );
          for (let i = 0; i < 8; i++)
            this.ship
              .fillStyle(0xca956f, progress * 0.5)
              .fillEllipse(
                p.x + Math.sin(i * 2.4 + time / 500) * 40 * progress,
                p.y + Math.cos(i) * 10,
                20 + progress * 25,
                7 + progress * 10,
              );
          this.drawShip(this.ship, p.x, p.y - height, 1);
          if (progress === 1 && !this.landed) {
            this.landed = true;
            latest.current.onTouchdown();
          }
        }
        this.overlay.clear();
        const cells =
          construction && this.hover && colony
            ? footprint(construction, this.hover)
            : selected
              ? (() => {
                  const b = colony?.buildings.find((item) =>
                    footprint(item.type, item).some(
                      (t) => t.x === selected.x && t.y === selected.y,
                    ),
                  );
                  return b ? footprint(b.type, b) : [selected];
                })()
              : [];
        const valid =
          construction && this.hover && colony
            ? placement(colony, construction, this.hover).valid
            : true;
        for (const tile of cells) {
          const p = tileToWorld(tile.x, tile.y);
          this.overlay
            .fillStyle(valid ? 0x81e2c6 : 0xff6655, 0.22)
            .fillPoints(diamond(p.x, p.y), true);
          this.overlay
            .lineStyle(2, valid ? 0x81e2c6 : 0xff6655)
            .strokePoints(diamond(p.x, p.y), true);
        }
      }
    }
    const game = new Phaser.Game({
      type: Phaser.AUTO,
      parent: host.current,
      scene: MarsScene,
      scale: {
        mode: Phaser.Scale.RESIZE,
        width: host.current.clientWidth,
        height: host.current.clientHeight,
      },
      render: { antialias: true },
    });
    return () => {
      game.destroy(true);
    };
  }, []);
  return (
    <div ref={host} className="world" aria-label="Isometric Mars terrain" />
  );
}
