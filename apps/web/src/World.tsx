import { useEffect, useRef } from 'react';
import { ActorRenderer } from './actors';
import Phaser from 'phaser';
import {
  buildingDefinitions,
  footprint,
  generateTerrain,
  infrastructureDefinitions,
  adjacent,
  cells,
  connectionTiles,
  isUsable,
  port,
  routeBetween,
  segmentId,
  tileKey,
  type InfrastructureType,
  type Segment,
  type BuildingType,
  type ColonyState,
  type Tile,
} from '@mars/simulation';
import {
  drawCraft,
  installBuildingSprites,
  installInfrastructureSprites,
  type SpriteSpec,
} from './art';
import { tileToWorld, worldToTile, WORLD_SIZE } from './iso';
type Props = {
  colony: ColonyState | null;
  mission: number;
  selected: Tile | null;
  construction: BuildingType | null;
  view: InfrastructureType | 'normal';
  infrastructureTool: { type: InfrastructureType; demolish: boolean } | null;
  draft: Tile[];
  routeValid: boolean;
  buildingPreviewValid: boolean;
  onRoute: (tiles: Tile[]) => void;
  onCancel: () => void;
  selectedResidentId: string | null;
  onResidentSelect: (id: string) => void;
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
      private actors!: ActorRenderer;
      private specs!: Record<BuildingType, SpriteSpec>;
      private buildingImages: Phaser.GameObjects.Image[] = [];
      private infrastructureImages: Phaser.GameObjects.Image[] = [];
      private infrastructureSignature = '';
      private infrastructureRef: Segment[] | null = null;
      private faults!: Phaser.GameObjects.Graphics;
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
        this.actors = new ActorRenderer(this);
        this.specs = installBuildingSprites(this);
        installInfrastructureSprites(this);
        this.input.mouse?.disableContextMenu();
        this.terrain = this.add.graphics().setDepth(-20000);
        this.structures = this.add.graphics();
        this.faults = this.add.graphics().setDepth(9999);
        this.overlay = this.add.graphics().setDepth(10000);
        this.ship = this.add.graphics().setDepth(10001);
        const camera = this.cameras.main;
        camera.setBackgroundColor('#21191a');
        camera.centerOn(0, 300);
        let startX = 0;
        let startY = 0;
        let moved = false;
        let pressedResident: string | null = null;
        let route: Tile[] | null = null;
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
          pressedResident = null;
          if (p.rightButtonDown()) {
            route = null;
            latest.current.onCancel();
            return;
          }
          if (latest.current.infrastructureTool && p.leftButtonDown()) {
            const tile = tileAt(p);
            route = tile ? [tile] : [];
            latest.current.onRoute(route);
            return;
          }
          if (
            !latest.current.construction &&
            !latest.current.infrastructureTool
          ) {
            const point = camera.getWorldPoint(p.x, p.y);
            pressedResident = this.actors.pickResident(point.x, point.y);
          }
          startX = p.x;
          startY = p.y;
          moved = false;
        });
        this.input.on('pointermove', (p: Phaser.Input.Pointer) => {
          if (route && p.isDown && latest.current.infrastructureTool) {
            const tile = tileAt(p);
            if (tile && route.length < WORLD_SIZE * WORLD_SIZE) {
              const last = route.at(-1);
              route = [
                ...new Map(
                  [...route, ...(last ? routeBetween(last, tile) : [tile])].map(
                    (t) => [tileKey(t), t],
                  ),
                ).values(),
              ];
              latest.current.onRoute(route);
            }
            return;
          }
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
          if (p.button === 2) return;
          if (route) {
            latest.current.onRoute(route);
            route = null;
            return;
          }
          if (moved) return;
          if (
            !latest.current.construction &&
            !latest.current.infrastructureTool
          ) {
            const point = camera.getWorldPoint(p.x, p.y);
            const citizen =
              pressedResident &&
              latest.current.colony?.phase === 'active' &&
              latest.current.colony.residents.some(
                (r) => r.id === pressedResident,
              )
                ? pressedResident
                : this.actors.pickResident(point.x, point.y);
            if (citizen) {
              latest.current.onResidentSelect(citizen);
              return;
            }
          }
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
        for (const image of this.buildingImages) image.destroy();
        this.buildingImages = [];
        this.structures.clear();
        for (const b of colony.buildings) {
          const p = tileToWorld(b.x, b.y),
            spec = this.specs[b.type];
          const image = this.add
            .image(p.x, p.y, spec.key)
            .setOrigin(spec.originX, spec.originY)
            .setDepth((b.x + b.y) * 10);
          if (!b.enabled || b.health === 0) image.setAlpha(0.55);
          this.buildingImages.push(image);
          const d = buildingDefinitions[b.type],
            cx = p.x + 16 * (d.width - d.height),
            cy = p.y + 8 * (d.width + d.height - 2);
          const warning = b.status.startsWith('no-') || b.status === 'disabled';
          this.structures
            .setDepth(9000)
            .fillStyle(warning ? 0xff8165 : 0x8be1c1)
            .fillCircle(cx + 19, cy - 26, 2.5);
        }
      }
      private drawInfrastructure(
        colony: ColonyState,
        view: Props['view'],
        selected: Tile | null,
      ) {
        for (const image of this.infrastructureImages) image.destroy();
        this.infrastructureImages = [];
        this.faults.clear();
        const b = selected
          ? colony.buildings.find((b) =>
              footprint(b.type, b).some(
                (t) => t.x === selected.x && t.y === selected.y,
              ),
            )
          : undefined;
        const selectedIds = new Set(
          colony.networks
            .filter(
              (n) =>
                (view === 'normal' || n.type === view) &&
                (b
                  ? n.buildings.includes(b.id)
                  : selected
                    ? n.segments.includes(segmentId(n.type, selected))
                    : false),
            )
            .flatMap((n) => n.segments),
        );
        const live = new Set(
          colony.infrastructure.filter(isUsable).map((s) => s.id),
        );
        for (const segment of colony.infrastructure) {
          const p = tileToWorld(segment.x, segment.y);
          let mask = 0;
          for (const [i, tile] of adjacent(segment).entries())
            if (live.has(segmentId(segment.type, tile))) mask |= 1 << i;
          if (isUsable(segment))
            for (const building of colony.buildings) {
              if (
                connectionTiles(building, segment.type).some(
                  (t) => t.x === segment.x && t.y === segment.y,
                )
              ) {
                const footprintKeys = new Set(cells(building).map(tileKey));
                for (const [index, neighbor] of adjacent(segment).entries())
                  if (footprintKeys.has(tileKey(neighbor))) mask |= 1 << index;
              }
            }
          const image = this.add
            .image(p.x, p.y, `mars-infra-${segment.type}-${mask}`)
            .setOrigin(0.5)
            .setDepth(-10000 + (segment.type === 'road' ? 0 : 1));
          image.setAlpha(
            view === 'normal'
              ? segment.type === 'road'
                ? 0.75
                : 0.6
              : segment.type === view
                ? 1
                : 0.13,
          );
          if (selectedIds.size && !selectedIds.has(segment.id))
            image.setAlpha(image.alpha * 0.4);
          if (!isUsable(segment)) {
            image.setTint(0xff4b3a).setAlpha(0.9);
            if (view === 'normal' || view === segment.type)
              this.faults
                .lineStyle(2, 0xff6955)
                .lineBetween(p.x - 4, p.y - 4, p.x + 4, p.y + 4)
                .lineBetween(p.x + 4, p.y - 4, p.x - 4, p.y + 4);
          }
          this.infrastructureImages.push(image);
        }
      }
      private drawShip(
        graphics: Phaser.GameObjects.Graphics,
        x: number,
        y: number,
        scale: number,
      ) {
        drawCraft(graphics, x, y, scale);
      }
      update(time: number, delta: number) {
        const {
          colony,
          mission,
          selected,
          construction,
          view,
          infrastructureTool,
          draft,
          routeValid,
          buildingPreviewValid,
        } = latest.current;
        if (this.seed !== (colony?.seed ?? 1) || this.mission !== mission) {
          this.actors.reset();
          this.seed = colony?.seed ?? 1;
          this.mission = mission;
          this.signature = '';
          this.infrastructureSignature = '';
          for (const image of this.buildingImages) image.destroy();
          this.buildingImages = [];
          for (const image of this.infrastructureImages) image.destroy();
          this.infrastructureImages = [];
          this.faults.clear();
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
        const infrastructureSignature = JSON.stringify([
          colony?.buildings.length,
          view,
          selected?.x,
          selected?.y,
        ]);
        if (
          colony &&
          (colony.infrastructure !== this.infrastructureRef ||
            infrastructureSignature !== this.infrastructureSignature)
        ) {
          this.infrastructureRef = colony.infrastructure;
          this.infrastructureSignature = infrastructureSignature;
          this.drawInfrastructure(colony, view, selected);
        }
        this.actors.update(colony, delta, latest.current.selectedResidentId);
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
        const valid = buildingPreviewValid;
        for (const tile of cells) {
          const p = tileToWorld(tile.x, tile.y);
          this.overlay
            .fillStyle(valid ? 0x81e2c6 : 0xff6655, 0.22)
            .fillPoints(diamond(p.x, p.y), true);
          this.overlay
            .lineStyle(2, valid ? 0x81e2c6 : 0xff6655)
            .strokePoints(diamond(p.x, p.y), true);
        }
        if (infrastructureTool)
          for (const tile of draft) {
            const p = tileToWorld(tile.x, tile.y);
            const color = routeValid ? 0x7ee8ad : 0xff6655;
            this.overlay
              .fillStyle(color, 0.25)
              .fillPoints(diamond(p.x, p.y), true)
              .lineStyle(2, color)
              .strokePoints(diamond(p.x, p.y), true);
          }
        if (colony) {
          const selectedBuilding = selected
            ? colony.buildings.find((b) =>
                footprint(b.type, b).some(
                  (t) => t.x === selected.x && t.y === selected.y,
                ),
              )
            : undefined;
          if (selectedBuilding)
            for (const [index, type] of (
              ['water', 'oxygen', 'power', 'road'] as const
            ).entries()) {
              const contacts =
                type !== 'power'
                  ? connectionTiles(selectedBuilding, type)
                  : [port(selectedBuilding, type)].filter(
                      (t): t is Tile => !!t,
                    );
              const connected = contacts.filter((t) =>
                colony.infrastructure.some(
                  (s) =>
                    s.type === type &&
                    s.x === t.x &&
                    s.y === t.y &&
                    isUsable(s),
                ),
              );
              for (const tile of connected.length ? connected : contacts) {
                const p = tileToWorld(tile.x, tile.y);
                this.overlay
                  .fillStyle(infrastructureDefinitions[type].color)
                  .fillCircle(p.x + (index - 1) * 7, p.y, 3)
                  .lineStyle(1, 0x101820)
                  .strokeCircle(p.x + (index - 1) * 7, p.y, 3);
              }
            }
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
