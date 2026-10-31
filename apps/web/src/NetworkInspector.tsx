import { useState } from 'react';
import {
  buildInfrastructure,
  connectionTiles,
  isUsable,
  infrastructureDefinitions,
  infrastructureTypeSchema,
  networkFor,
  segmentId,
  setPowerPriority,
  toggleSegment,
  type Building,
  type ColonyState,
  type InfrastructureType,
  type Tile,
} from '@mars/simulation';
export const connectionLabels: Record<string, string> = {
  'no-water-connection': 'No water connection',
  'no-oxygen-connection': 'No oxygen connection',
  'no-power-connection': 'No power connection',
};
export function NetworkInspector({
  colony,
  building,
  tile,
  onChange,
  onView,
}: {
  colony: ColonyState;
  building: Building | undefined;
  tile: Tile | null;
  onChange: (update: (state: ColonyState) => ColonyState) => void;
  onView: (view: InfrastructureType) => void;
}) {
  const [error, setError] = useState('');
  const command = (fn: (state: ColonyState) => ColonyState) => {
    try {
      onChange(fn);
      setError('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Command failed');
    }
  };
  return (
    <section aria-label="Network inspector" data-testid="network-inspector">
      <h4>Infrastructure connections</h4>
      {building && (
        <label className="priority-control">
          Power priority (0 = highest)
          <input
            aria-label="Power priority"
            type="number"
            min={0}
            max={100}
            value={building.priority}
            onChange={(event) => {
              const value = event.currentTarget.valueAsNumber;
              if (Number.isInteger(value) && value >= 0 && value <= 100)
                command((state) => setPowerPriority(state, building.id, value));
            }}
          />
        </label>
      )}
      {infrastructureTypeSchema.options.map((type) => {
        const contacts = building ? connectionTiles(building, type) : [];
        const endpoint = building
          ? (contacts.find((t) =>
              colony.infrastructure.some(
                (s) =>
                  s.type === type && s.x === t.x && s.y === t.y && isUsable(s),
              ),
            ) ??
            contacts.find((t) =>
              colony.infrastructure.some(
                (s) => s.type === type && s.x === t.x && s.y === t.y,
              ),
            ) ??
            contacts[0])
          : tile;
        if (!endpoint) return null;
        const network = building
          ? type === 'road'
            ? colony.networks.find(
                (n) =>
                  n.type === type &&
                  n.segments.includes(segmentId(type, endpoint)),
              )
            : networkFor(colony.networks, building.id, type)
          : colony.networks.find(
              (n) =>
                n.type === type &&
                n.segments.includes(segmentId(type, endpoint)),
            );
        const segment = colony.infrastructure.find(
          (s) => s.type === type && s.x === endpoint.x && s.y === endpoint.y,
        );
        if (!building && !segment) return null;
        return (
          <article
            className="network-card"
            key={type}
            style={{
              borderColor: `#${infrastructureDefinitions[type].color.toString(16).padStart(6, '0')}`,
            }}
          >
            <strong>{infrastructureDefinitions[type].name}</strong>
            <p>
              {network
                ? 'Connected'
                : type === 'road'
                  ? 'No road connection'
                  : `No ${type} connection`}
            </p>
            {building && (
              <small>
                Automatic contact: {endpoint.x}, {endpoint.y} · any directly
                adjacent side
              </small>
            )}
            {network && (
              <>
                <button className="network-id" onClick={() => onView(type)}>
                  {network.id}
                </button>
                <dl>
                  <dt>Supply / tick</dt>
                  <dd>{network.supply.toFixed(2)}</dd>
                  <dt>Demand / tick</dt>
                  <dd>{network.demand.toFixed(2)}</dd>
                  <dt>Allocated / tick</dt>
                  <dd>{network.allocated.toFixed(2)}</dd>
                  <dt>Storage</dt>
                  <dd>
                    {network.stored.toFixed(2)} / {network.capacity.toFixed(2)}
                  </dd>
                  <dt>Status</dt>
                  <dd>{network.status}</dd>
                  <dt>Members / segments</dt>
                  <dd>
                    {network.buildings.length} / {network.segments.length}
                  </dd>
                </dl>
              </>
            )}
            {building &&
              type === 'road' &&
              colony.networks.filter(
                (n) => n.type === 'road' && n.buildings.includes(building.id),
              ).length > 1 && (
                <div className="road-access-list">
                  <small>All adjacent road components:</small>
                  {colony.networks
                    .filter(
                      (n) =>
                        n.type === 'road' && n.buildings.includes(building.id),
                    )
                    .map((n) => (
                      <p key={n.id}>
                        {n.id} · {n.segments.length} segments
                      </p>
                    ))}
                </div>
              )}
            {segment && (
              <>
                <p>
                  Segment {segment.health}% ·{' '}
                  {segment.enabled ? 'enabled' : 'disabled'}
                  {segment.health === 0 ? ' · BROKEN' : ''}
                </p>
                <div className="segment-actions">
                  <button
                    onClick={() =>
                      command((state) => toggleSegment(state, segment.id))
                    }
                  >
                    {segment.enabled ? 'Disable segment' : 'Enable segment'}
                  </button>
                  <button
                    onClick={() =>
                      command((state) =>
                        buildInfrastructure(state, type, [segment], true),
                      )
                    }
                  >
                    Remove {infrastructureDefinitions[type].name}
                  </button>
                </div>
              </>
            )}
          </article>
        );
      })}
      <p className="muted">
        Supply includes starting reserves and this tick's generation.
        Allocations are actual consumption. Road components expose connectivity
        only.
      </p>
      {error && <p role="alert">{error}</p>}
    </section>
  );
}
