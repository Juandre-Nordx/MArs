import { memo, useMemo, useState } from 'react';
import {
  CHUNK_SIZE,
  isExplored,
  terrainAt,
  type ColonyState,
  type Tile,
} from '@mars/simulation';
export const WorldNavigator = memo(function WorldNavigator({
  colony,
  selected,
  onFocus,
}: {
  colony: ColonyState;
  selected: Tile | null;
  onFocus: (tile: Tile) => void;
}) {
  const [x, setX] = useState('9'),
    [y, setY] = useState('9');
  const explored = useMemo(
    () =>
      Object.values(colony.world.chunks).reduce(
        (sum, c) => sum + c.explored.length,
        0,
      ),
    [colony.world],
  );
  const known = selected && isExplored(colony.world, selected);
  return (
    <section aria-label="World navigation" className="world-navigation">
      <h3>World navigation</h3>
      <p data-testid="world-size">512 × 512 tiles · {explored} explored</p>
      <svg
        viewBox="0 0 512 512"
        role="img"
        aria-label="Explored world overview"
      >
        <rect width="512" height="512" fill="#29252c" />
        {Object.values(colony.world.chunks).map((c) => (
          <rect
            key={`${c.x},${c.y}`}
            x={c.x * CHUNK_SIZE}
            y={c.y * CHUNK_SIZE}
            width={CHUNK_SIZE}
            height={CHUNK_SIZE}
            fill="#c17b56"
            opacity={0.25 + (0.75 * c.explored.length) / 256}
          />
        ))}
        <circle
          cx={colony.landingZone.x}
          cy={colony.landingZone.y}
          r="5"
          fill="#8be1c1"
        />
        {selected && (
          <circle
            cx={selected.x}
            cy={selected.y}
            r="6"
            stroke="#fff"
            fill="none"
            strokeWidth="3"
          />
        )}
      </svg>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          const p = { x: Number(x), y: Number(y) };
          if (
            Number.isInteger(p.x) &&
            Number.isInteger(p.y) &&
            p.x >= 0 &&
            p.y >= 0 &&
            p.x < 512 &&
            p.y < 512
          )
            onFocus(p);
        }}
      >
        <label>
          Map X
          <input
            aria-label="Map X"
            type="number"
            min="0"
            max="511"
            required
            value={x}
            onChange={(e) => setX(e.target.value)}
          />
        </label>
        <label>
          Map Y
          <input
            aria-label="Map Y"
            type="number"
            min="0"
            max="511"
            required
            value={y}
            onChange={(e) => setY(e.target.value)}
          />
        </label>
        <button type="submit">Go to tile</button>
      </form>
      <button onClick={() => onFocus({ ...colony.landingZone })}>
        Return to colony
      </button>
      {selected && (
        <p data-testid="terrain-region">
          {known
            ? `Region: ${terrainAt(colony.seed, selected.x, selected.y).region.replaceAll('-', ' ')}`
            : 'Unexplored terrain — survey exploration is planned for the next phases.'}
        </p>
      )}
      <small>
        Panning does not explore terrain. Fog and mineral discoveries are saved
        separately. Mining and industry are not available in this phase.
      </small>
    </section>
  );
});
