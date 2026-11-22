import { useState } from 'react';
import type { BuildingEntry } from '@mars/simulation';
import { CatalogueArt } from './catalogue-art';
import { TILE_HEIGHT, TILE_WIDTH, tileToWorld } from './iso';
import { spritePlacement } from './sprite-placement';

export function SpritePreview({ entry }: { entry: BuildingEntry }) {
  const [aspect, setAspect] = useState(1);
  const placement = spritePlacement(entry, entry, true);
  const imageHeight = placement.width * aspect;
  const left = placement.x - entry.anchor.x * placement.width;
  const top = placement.y - entry.anchor.y * imageHeight;
  const tileWidth = TILE_WIDTH / 2;
  const tileHeight = TILE_HEIGHT / 2;

  const minX = Math.min(-entry.height * tileWidth, left) - 12;
  const maxX = Math.max(entry.width * tileWidth, left + placement.width) + 12;
  const minY = Math.min(-tileHeight, top) - 12;
  const maxY =
    Math.max((entry.width + entry.height - 1) * tileHeight, top + imageHeight) +
    12;

  return (
    <svg
      className="admin-sprite-preview"
      viewBox={`${minX} ${minY} ${maxX - minX} ${maxY - minY}`}
    >
      <foreignObject
        x={left}
        y={top}
        width={placement.width}
        height={imageHeight}
      >
        <CatalogueArt
          reference={entry.sprite}
          kind="building"
          admin
          alt="Aligned isometric preview"
          onLoad={({ currentTarget }) => {
            if (currentTarget.naturalWidth)
              setAspect(
                currentTarget.naturalHeight / currentTarget.naturalWidth,
              );
          }}
          style={{ width: '100%', height: '100%', objectFit: 'contain' }}
        />
      </foreignObject>
      <g fill="none" stroke="#8ad8cd" strokeOpacity="0.7" strokeWidth="1.5">
        {Array.from({ length: entry.width * entry.height }, (_, index) => {
          const { x, y } = tileToWorld(
            index % entry.width,
            Math.floor(index / entry.width),
          );
          return (
            <polygon
              key={index}
              points={`${x},${y - tileHeight} ${x + tileWidth},${y} ${x},${y + tileHeight} ${x - tileWidth},${y}`}
            />
          );
        })}
      </g>
      <circle cx={placement.x} cy={placement.y} r="3" fill="#ffd29e" />
    </svg>
  );
}
