import { useEffect, useRef } from 'react';
import Phaser from 'phaser';
import { tileToWorld, worldToTile, WORLD_SIZE } from './iso';
export function World({
  onSelect,
}: {
  onSelect: (tile: { x: number; y: number }) => void;
}) {
  const host = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!host.current) return;
    class MarsScene extends Phaser.Scene {
      create() {
        const graphics = this.add.graphics();
        for (let y = 0; y < WORLD_SIZE; y++)
          for (let x = 0; x < WORLD_SIZE; x++) {
            const p = tileToWorld(x, y);
            graphics.fillStyle(
              (x * 7 + y * 11) % 5 === 0 ? 0xa65c42 : 0x874735,
            );
            graphics.lineStyle(1, 0xc78158, 0.35);
            const points = [
              { x: p.x, y: p.y - 16 },
              { x: p.x + 32, y: p.y },
              { x: p.x, y: p.y + 16 },
              { x: p.x - 32, y: p.y },
            ];
            graphics.fillPoints(points, true);
            graphics.strokePoints(points, true);
          }
        const marker = this.add.graphics();
        const camera = this.cameras.main;
        camera.setBackgroundColor('#1d1719');
        camera.centerOn(0, 300);
        let startX = 0;
        let startY = 0;
        let moved = false;
        this.input.on('pointerdown', (p: Phaser.Input.Pointer) => {
          startX = p.x;
          startY = p.y;
          moved = false;
        });
        this.input.on('pointermove', (p: Phaser.Input.Pointer) => {
          if (!p.isDown) return;
          if (Math.hypot(p.x - startX, p.y - startY) > 5) moved = true;
          if (moved) {
            camera.scrollX -= (p.x - p.prevPosition.x) / camera.zoom;
            camera.scrollY -= (p.y - p.prevPosition.y) / camera.zoom;
          }
        });
        this.input.on('pointerup', (p: Phaser.Input.Pointer) => {
          if (moved) return;
          const world = camera.getWorldPoint(p.x, p.y);
          const tile = worldToTile(world.x, world.y);
          if (
            tile.x < 0 ||
            tile.y < 0 ||
            tile.x >= WORLD_SIZE ||
            tile.y >= WORLD_SIZE
          )
            return;
          const point = tileToWorld(tile.x, tile.y);
          marker.clear().lineStyle(2, 0x8af4df);
          marker.strokePoints(
            [
              { x: point.x, y: point.y - 16 },
              { x: point.x + 32, y: point.y },
              { x: point.x, y: point.y + 16 },
              { x: point.x - 32, y: point.y },
            ],
            true,
          );
          onSelect(tile);
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
  }, [onSelect]);
  return (
    <div
      ref={host}
      className="h-full w-full"
      aria-label="Isometric Mars terrain"
    />
  );
}
