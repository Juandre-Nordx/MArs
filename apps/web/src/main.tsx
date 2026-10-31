import { useCallback, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  advance,
  alerts,
  buildingAt,
  buildingDefinitions,
  capacities,
  colonySchema,
  construct,
  deployColony,
  loadSave,
  placement,
  resourceDefinitions,
  resourceKeys,
  setSpeed,
  SOL_TICKS,
  toggleBuilding,
  type BuildingType,
  type Category,
  type ClockState,
  type ColonyState,
  type Stock,
  type Tile,
} from '@mars/simulation';
import { World } from './World';
import './style.css';
const SAVE_KEY = 'mars-first-colony-save';
const categories: Category[] = ['Housing', 'Life support', 'Power', 'Storage'];
const format = (value: number) => value.toFixed(2);
function App() {
  const clock = useRef<ClockState | null>(null);
  const last = useRef(performance.now());
  const inspectorRef = useRef<HTMLElement>(null);
  const [colony, setColony] = useState<ColonyState | null>(null);
  const [tile, setTile] = useState<Tile | null>(null);
  const [hover, setHover] = useState<Tile | null>(null);
  const [mission, setMission] = useState(0);
  const [construction, setConstruction] = useState<BuildingType | null>(null);
  const constructionRef = useRef(construction);
  constructionRef.current = construction;
  const [category, setCategory] = useState<Category | null>(null);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const publish = useCallback((state: ColonyState, reset = false) => {
    clock.current = {
      colony: state,
      remainderMs: reset ? 0 : (clock.current?.remainderMs ?? 0),
    };
    last.current = performance.now();
    setColony(state);
  }, []);
  const select = useCallback(
    (value: Tile) => {
      const state = clock.current?.colony;
      const type = constructionRef.current;
      if (state && type) {
        try {
          publish(construct(state, type, value));
          setConstruction(null);
          setMessage('Construction complete — costs deducted');
        } catch (error) {
          setMessage(
            error instanceof Error ? error.message : 'Construction failed',
          );
        }
      }
      setTile(value);
    },
    [publish],
  );
  const touchdown = useCallback(() => {
    const state = clock.current?.colony;
    if (state) publish(deployColony(state), true);
  }, [publish]);
  useEffect(() => {
    const timer = window.setInterval(() => {
      const now = performance.now();
      const elapsed = now - last.current;
      last.current = now;
      if (clock.current && !document.hidden) {
        clock.current = advance(clock.current, elapsed);
        setColony(clock.current.colony);
      }
    }, 100);
    const visibility = () => {
      last.current = performance.now();
    };
    document.addEventListener('visibilitychange', visibility);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', visibility);
    };
  }, []);
  useEffect(() => {
    const cancel = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setConstruction(null);
        setCategory(null);
      }
    };
    window.addEventListener('keydown', cancel);
    return () => window.removeEventListener('keydown', cancel);
  }, []);
  async function start() {
    if (
      colony &&
      !window.confirm('Start a new colony? Unsaved progress will be replaced.')
    )
      return;
    setBusy(true);
    setMessage('');
    try {
      const response = await fetch('/api/new-game', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ seed: mission + 1 }),
      });
      if (!response.ok)
        throw new Error('API unavailable. Start the backend and retry.');
      const body: unknown = await response.json();
      const state = colonySchema.parse((body as { colony?: unknown }).colony);
      publish(state, true);
      setMission((value) => value + 1);
      setTile(null);
      setConstruction(null);
      setCategory(null);
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : 'Could not create colony',
      );
    } finally {
      setBusy(false);
    }
  }
  function save() {
    if (!clock.current) return;
    try {
      localStorage.setItem(SAVE_KEY, JSON.stringify(clock.current.colony));
      setMessage('Saved in this browser. Cloud saves are not available.');
    } catch {
      setMessage('Browser storage unavailable or full');
    }
  }
  function load() {
    try {
      const value = localStorage.getItem(SAVE_KEY);
      if (!value) throw new Error('No browser save found');
      const state = loadSave(JSON.parse(value));
      publish(state, true);
      setMission((value) => value + 1);
      setTile(null);
      setConstruction(null);
      setCategory(null);
      setMessage('Browser save loaded');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Invalid save');
    }
  }
  const building = colony && tile ? buildingAt(colony, tile) : undefined;
  const definition = building ? buildingDefinitions[building.type] : undefined;
  useEffect(() => {
    inspectorRef.current?.scrollTo({ top: 0 });
  }, [building?.id]);
  const cap = colony ? capacities(colony) : null;
  const warnings = colony ? alerts(colony) : [];
  const preview =
    colony && construction && hover
      ? placement(colony, construction, hover)
      : null;
  function inventoryList(items: Partial<Stock>) {
    return (
      Object.entries(items)
        .map(
          ([key, value]) =>
            `${resourceDefinitions[key as keyof Stock].label}: ${format(value)}`,
        )
        .join(' · ') || 'None'
    );
  }
  return (
    <main className="game-shell">
      <header className="topbar">
        <div className="brand">
          <span className="eyebrow">MARS / MISSION CONTROL</span>
          <h1>MARS: FIRST COLONY</h1>
          <h2>{colony?.name ?? 'Awaiting landing'}</h2>
        </div>
        <div className="hud">
          <div className="stat">
            <span>Sol</span>
            <strong>
              {colony ? Math.floor(colony.tick / SOL_TICKS) + 1 : '—'}
            </strong>
            <small data-testid="tick">
              Sol clock: {colony?.tick ?? 0} ticks
            </small>
          </div>
          <div className="stat">
            <span>Population</span>
            <strong>{colony?.population ?? '—'}</strong>
            <small>Credits {colony?.credits ?? 0}</small>
          </div>
          {(['oxygen', 'water', 'food', 'energy'] as const).map((key) => (
            <div
              className={`stat ${colony && cap && colony.inventory[key] <= cap[key] * 0.2 ? 'low' : ''}`}
              key={key}
            >
              <span>{resourceDefinitions[key].label}</span>
              <strong data-testid={`resource-${key}`}>
                {colony ? format(colony.inventory[key]) : '—'}
              </strong>
              <small>
                {cap
                  ? `${cap[key]} ${resourceDefinitions[key].unit} capacity`
                  : resourceDefinitions[key].unit}
              </small>
            </div>
          ))}
        </div>
        <div className="session-controls">
          <div className="session-buttons">
            <button
              disabled={busy}
              className="primary"
              onClick={() => void start()}
            >
              {busy ? 'Initializing…' : 'New game'}
            </button>
            <button disabled={!colony} onClick={save}>
              Save
            </button>
            <button onClick={load}>Load</button>
          </div>
          <div className="time-controls" aria-label="Simulation speed">
            {([0, 1, 2, 4] as const).map((speed) => (
              <button
                key={speed}
                disabled={!colony || colony.phase !== 'active'}
                aria-pressed={colony?.speed === speed}
                onClick={() => {
                  if (clock.current)
                    publish(setSpeed(clock.current.colony, speed));
                }}
              >
                {speed === 0 ? 'Pause' : `${speed}×`}
              </button>
            ))}
          </div>
        </div>
      </header>
      <section className="workspace">
        <div className="viewport">
          <World
            colony={colony}
            mission={mission}
            selected={tile}
            construction={construction}
            onSelect={select}
            onHover={setHover}
            onTouchdown={touchdown}
          />
          <div className="map-caption">
            <span className="eyebrow">
              {colony?.phase === 'landing'
                ? 'DESCENT / LANDING ZONE SECURED'
                : 'ARCADIA PLANITIA / SURFACE VIEW'}
            </span>
            <p>Drag to pan · Scroll to zoom · Click to select</p>
          </div>
          {colony?.phase === 'landing' && (
            <div className="landing-panel">
              <h3>Starship descending</h3>
              <p>Touchdown deploys 19 starter buildings for 10 colonists.</p>
              <button className="primary" onClick={touchdown}>
                Skip landing
              </button>
            </div>
          )}
          {construction && (
            <div
              className={`placement-panel ${preview && !preview.valid ? 'invalid' : ''}`}
              data-testid="placement-status"
            >
              <strong>Place {buildingDefinitions[construction].name}</strong>
              <p>
                {preview?.reason ?? 'Move over terrain to preview footprint'}
              </p>
              <button onClick={() => setConstruction(null)}>
                Cancel placement
              </button>
            </div>
          )}
        </div>
        <aside ref={inspectorRef} className="inspector">
          <span className="eyebrow">COLONY INSPECTOR</span>
          <p data-testid="selection">
            {tile ? `Sector ${tile.x}, ${tile.y}` : 'Select a terrain tile'}
          </p>
          {building && definition ? (
            <section data-testid="building-inspector">
              <h3>{definition.name}</h3>
              <p className="muted">
                {building.type} · {building.id}
              </p>
              <dl>
                <dt>Condition</dt>
                <dd>{building.health}%</dd>
                <dt>Workers assigned</dt>
                <dd>{building.workers}</dd>
                <dt>Power demand</dt>
                <dd>{definition.power} kWh/tick</dd>
                <dt>Production status</dt>
                <dd data-testid="building-status">{building.status}</dd>
                <dt>Footprint</dt>
                <dd>
                  {definition.width} × {definition.height}
                </dd>
              </dl>
              <h4>Required inputs / tick (rated)</h4>
              <p>
                {definition.generation
                  ? 'Sunlight during daytime'
                  : inventoryList(definition.inputs)}
              </p>
              <h4>Outputs / tick (rated)</h4>
              <p>
                {definition.generation
                  ? `${definition.generation} kWh in daylight`
                  : inventoryList(definition.outputs)}
              </p>
              <h4>Connected input inventory</h4>
              <p>
                {colony &&
                  inventoryList(
                    Object.fromEntries(
                      Object.keys(definition.inputs).map((key) => [
                        key,
                        colony.inventory[key as keyof Stock],
                      ]),
                    ),
                  )}
              </p>
              <h4>Connected output inventory</h4>
              <p>
                {colony &&
                  inventoryList(
                    Object.fromEntries(
                      Object.keys(definition.outputs).map((key) => [
                        key,
                        colony.inventory[key as keyof Stock],
                      ]),
                    ),
                  )}
              </p>
              <h4>Storage capacity</h4>
              <p>{inventoryList(definition.capacity)}</p>
              <button
                onClick={() => {
                  if (clock.current)
                    publish(toggleBuilding(clock.current.colony, building.id));
                }}
              >
                {building.enabled ? 'Disable building' : 'Enable building'}
              </button>
              <p className="muted">
                Buildings share colony storage; disabling storage retains its
                contents.
              </p>
            </section>
          ) : (
            <section>
              <h3>
                {colony?.phase === 'landing'
                  ? 'Landing sequence'
                  : 'Surface operations'}
              </h3>
              <p className="muted">
                Select a building footprint or use the roster below. Construct
                facilities from the toolbar.
              </p>
            </section>
          )}
          {colony?.phase === 'active' && (
            <>
              <h4>Power grid / last tick</h4>
              <p>
                Solar {format(colony.telemetry.generated)} · Demand{' '}
                {format(colony.telemetry.demand)} · Used{' '}
                {format(colony.telemetry.used)} kWh
              </p>
              <p>Battery Δ {format(colony.telemetry.batteryDelta)} kWh</p>
              <h4>Colony stores</h4>
              <dl>
                {resourceKeys.map((key) => (
                  <div className="store-row" key={key}>
                    <dt>{resourceDefinitions[key].label}</dt>
                    <dd>
                      {format(colony.inventory[key])} / {cap?.[key]}
                    </dd>
                  </div>
                ))}
              </dl>
              <details>
                <summary>Production / consumption per tick</summary>
                {resourceKeys
                  .filter((key) => key !== 'energy')
                  .map((key) => (
                    <p key={key}>
                      {resourceDefinitions[key].label}: +
                      {format(colony.telemetry.produced[key])} / −
                      {format(colony.telemetry.consumed[key])}
                    </p>
                  ))}
              </details>
            </>
          )}
          <section aria-label="Alerts">
            <h4>Alerts</h4>
            {warnings.length ? (
              warnings.map((warning) => (
                <p className="alert" key={warning}>
                  {warning}
                </p>
              ))
            ) : (
              <p className="muted">
                {colony
                  ? 'No active alerts'
                  : 'Awaiting mission initialization'}
              </p>
            )}
          </section>
          {colony && (
            <details>
              <summary>Building roster ({colony.buildings.length})</summary>
              <div className="roster">
                {colony.buildings.map((b) => (
                  <button
                    key={b.id}
                    onClick={() => {
                      setConstruction(null);
                      setTile({ x: b.x, y: b.y });
                    }}
                  >
                    {buildingDefinitions[b.type].name} · {b.x},{b.y}
                  </button>
                ))}
              </div>
            </details>
          )}
          <p className="muted">
            Prototype artwork · Browser saves only · Mining and industry locked
          </p>
        </aside>
      </section>
      <footer className="construction-toolbar">
        <nav aria-label="Construction categories">
          {categories.map((item) => (
            <button
              key={item}
              disabled={!colony || colony.phase !== 'active'}
              aria-pressed={category === item}
              onClick={() => {
                setCategory(category === item ? null : item);
                setConstruction(null);
              }}
            >
              {item}
            </button>
          ))}
          <button disabled>Mining · locked</button>
          <button disabled>Industry · locked</button>
        </nav>
        {category && (
          <div className="build-menu">
            {(Object.keys(buildingDefinitions) as BuildingType[])
              .filter(
                (type) =>
                  type !== 'starship' &&
                  buildingDefinitions[type].category === category,
              )
              .map((type) => {
                const d = buildingDefinitions[type];
                return (
                  <button
                    key={type}
                    aria-pressed={construction === type}
                    onClick={() => setConstruction(type)}
                  >
                    {d.name}
                    <small>
                      {d.width}×{d.height} · {d.cost.metal} metal ·{' '}
                      {d.cost.credits} credits
                    </small>
                  </button>
                );
              })}
            <span>Metal: {colony?.inventory.metal} · Esc to cancel</span>
          </div>
        )}
      </footer>
      {message && (
        <div role="status" className="toast" onClick={() => setMessage('')}>
          {message}
          <button aria-label="Dismiss message" onClick={() => setMessage('')}>
            ×
          </button>
        </div>
      )}
    </main>
  );
}
createRoot(document.getElementById('root')!).render(<App />);
