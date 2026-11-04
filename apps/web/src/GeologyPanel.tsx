import { catalogueMinerals } from './catalogue-view';
import { useMemo, useState } from 'react';
import {
  discoveredDeposits,
  droneDefinitions,
  extractionDefinitions,
  requestScan,
  surveyAreasOverlap,
  scanDefinitions,
  scanModeSchema,
  type ColonyState,
  type ScanMode,
  type Tile,
} from '@mars/simulation';
export function GeologyPanel({
  colony,
  selected,
  onChange,
  onFocus,
}: {
  colony: ColonyState;
  selected: Tile | null;
  onChange: (state: ColonyState) => void;
  onFocus: (tile: Tile) => void;
}) {
  const mineralDefinitions = catalogueMinerals(colony.catalogue);
  const stations = colony.buildings.filter((b) => b.type === 'survey-station');
  const [stationId, setStationId] = useState(''),
    [mode, setMode] = useState<ScanMode>('subsurface'),
    [region, setRegion] = useState(
      colony.world.generatorVersion === 2
        ? { x1: 261, y1: 264, x2: 267, y2: 264 }
        : { x1: 21, y1: 24, x2: 27, y2: 24 },
    ),
    [explore, setExplore] = useState(false),
    [message, setMessage] = useState('');
  const deposits = useMemo(
    () => discoveredDeposits(colony.world),
    [colony.world],
  );
  const selectedDeposits = selected
    ? deposits.filter((d) => d.x === selected.x && d.y === selected.y)
    : [];
  return (
    <section aria-label="Geological operations">
      <h3>Geological operations</h3>
      <p>
        Build a Survey and drone station in Mining and connect an electrical
        cable to any side. The paid station includes one aerial survey drone and
        one ground extraction drone, both initially uncharged.
      </p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          try {
            onChange(
              requestScan(
                colony,
                stationId || stations[0]?.id || '',
                mode,
                { x: region.x1, y: region.y1 },
                { x: region.x2, y: region.y2 },
                explore,
              ),
            );
            setMessage('Survey queued; drones need grid energy to charge.');
          } catch (error) {
            setMessage(
              error instanceof Error ? error.message : 'Survey failed',
            );
          }
        }}
      >
        <label>
          Survey station
          <select
            aria-label="Survey station"
            value={stationId || stations[0]?.id || ''}
            onChange={(e) => setStationId(e.target.value)}
          >
            {!stations.length && (
              <option value="">Construct a station first</option>
            )}
            {stations.map((b) => (
              <option key={b.id} value={b.id}>
                {b.id} · {b.x},{b.y} · {b.status}
              </option>
            ))}
          </select>
        </label>
        <label>
          Scan mode
          <select
            aria-label="Scan mode"
            value={mode}
            onChange={(e) => setMode(e.target.value as ScanMode)}
          >
            {scanModeSchema.options.map((m) => (
              <option key={m} value={m}>
                {m} · ≤{scanDefinitions[m].maxDepth} m ·{' '}
                {scanDefinitions[m].ticks} ticks/tile
              </option>
            ))}
          </select>
        </label>
        <div className="survey-coordinates">
          {(['x1', 'y1', 'x2', 'y2'] as const).map((key) => (
            <label key={key}>
              {key}
              <input
                aria-label={`Scan ${key}`}
                type="number"
                min="0"
                max="511"
                required
                value={region[key]}
                onChange={(e) =>
                  setRegion({ ...region, [key]: Number(e.target.value) })
                }
              />
            </label>
          ))}
        </div>
        <p>
          Choose inclusive corners (up to 16 × 16; within 64 tiles per axis of
          the station), or select map tiles and use these controls.
        </p>
        <button
          type="button"
          disabled={!selected}
          onClick={() =>
            selected && setRegion({ ...region, x1: selected.x, y1: selected.y })
          }
        >
          Use selected tile as scan start
        </button>
        <button
          type="button"
          disabled={!selected}
          onClick={() =>
            selected && setRegion({ ...region, x2: selected.x, y2: selected.y })
          }
        >
          Use selected tile as scan end
        </button>
        <label>
          <input
            type="checkbox"
            checked={explore}
            onChange={(e) => setExplore(e.target.checked)}
          />{' '}
          Map terrain too (separate from mineral discovery)
        </label>
        <button
          disabled={!stations.length || colony.phase !== 'active'}
          type="submit"
        >
          Queue geological scan
        </button>
      </form>
      {message && <p role="status">{message}</p>}
      <details>
        <summary>Survey jobs and drones</summary>
        <p>
          One drone per job. Overlapping survey areas wait while other drones
          take independent queues.
        </p>
        {colony.industry.scans.map((s) => {
          const owner = colony.industry.drones.find(
            (d) => d.job?.type === 'scan' && d.job.id === s.id,
          );
          const areaOwner = colony.industry.scans.find(
            (other) =>
              other.status === 'active' &&
              other.id !== s.id &&
              surveyAreasOverlap(s, other),
          );
          return (
            <p key={s.id} data-testid={`survey-job-${s.id}`}>
              {s.id} · {s.mode} · {s.status} · {s.cursor}/
              {(s.to.x - s.from.x + 1) * (s.to.y - s.from.y + 1)} tiles ·{' '}
              {s.from.x},{s.from.y} → {s.to.x},{s.to.y} ·{' '}
              {owner
                ? `Assigned drone: ${owner.id}`
                : s.status === 'complete'
                  ? 'Completed'
                  : areaOwner
                    ? `Waiting for survey area (${areaOwner.id})`
                    : 'Waiting for an available survey drone'}
            </p>
          );
        })}
        {colony.industry.drones.map((d) => (
          <p key={d.id}>
            {d.id} · {d.activity} · {d.position.x},{d.position.y} ·{' '}
            {d.battery.toFixed(2)}/{droneDefinitions[d.kind].capacity} kWh ·{' '}
            {d.job ? `${d.job.type}: ${d.job.id}` : 'No job'}
          </p>
        ))}
      </details>
      <h4>Deposit inspector</h4>
      {selectedDeposits.length ? (
        selectedDeposits.map((d) => (
          <div key={d.id} data-testid="deposit-inspector">
            <strong>{mineralDefinitions[d.resource].name}</strong>
            <dl>
              <dt>Estimated remaining reserves</dt>
              <dd>{d.remainingQuantity.toFixed(2)} kg</dd>
              <dt>Richness</dt>
              <dd>{(d.richness * 100).toFixed(0)}%</dd>
              <dt>Depth</dt>
              <dd>
                {d.depth} m · {d.classification}
              </dd>
              <dt>Extraction requirements</dt>
              <dd>
                {d.technology} technology · compatible mine · electricity ·
                extraction drone · local buffer space
              </dd>
            </dl>
          </div>
        ))
      ) : (
        <p>Select a discovered deposit. Undiscovered minerals stay hidden.</p>
      )}
      <details>
        <summary>Discovered deposits ({deposits.length})</summary>
        <p>
          Showing the first 100 discoveries. The geological map overlay shows
          discoveries in the current viewport, including over unmapped terrain.
        </p>
        {deposits.slice(0, 100).map((d) => (
          <button key={d.id} onClick={() => onFocus({ x: d.x, y: d.y })}>
            {mineralDefinitions[d.resource].name} · {d.x},{d.y} ·{' '}
            {d.remainingQuantity.toFixed(2)} kg
          </button>
        ))}
      </details>
      <details>
        <summary>Extraction technologies</summary>
        {Object.entries(extractionDefinitions).map(([type, d]) => (
          <p key={type}>
            {type}: {d.technology}, ≤{d.maxDepth} m, {d.rate} × richness
            kg/tick, {d.capacity} kg buffer. Requires an extraction drone from a
            station within 96 Manhattan tiles.
          </p>
        ))}
      </details>
      <p>
        Survey drones fly over obstacles. Extraction drones follow traversable
        ground, reroute around buildings, and wait if blocked. A drone returns
        to its own station to recharge; charging consumes actual grid energy.
        Cargo transport and refining remain pending.
      </p>
    </section>
  );
}
