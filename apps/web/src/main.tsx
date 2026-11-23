import { catalogueResources } from './catalogue-view';
import { BuildingPopup } from './BuildingPopup';
import { StorageOverview } from './StorageOverview';
import { GeologyPanel } from './GeologyPanel';
import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import { createRoot } from 'react-dom/client';
import {
  advance,
  buildInfrastructure,
  infrastructureDefinitions,
  infrastructureTypeSchema,
  routePreview,
  type InfrastructureType,
  alerts,
  buildingAt,
  runtimeCatalogue,
  buildingAvailable,
  catalogueSnapshotSchema,
  type CatalogueSnapshot,
  capacities,
  colonySchema,
  construct,
  deployColony,
  loadSave,
  placement,
  resourceKeys,
  setSpeed,
  SOL_TICKS,
  type BuildingType,
  type Category,
  type ClockState,
  type ColonyState,
  type Tile,
} from '@mars/simulation';
import { NetworkInspector } from './NetworkInspector';
import { ResidentsPanel } from './ResidentsPanel';
import { ColonistInspector } from './ColonistInspector';
import { World, type WorldProps } from './World';
import { placement3D } from './world3d/terrain';
import { WorldNavigator } from './WorldNavigator';
import './style.css';
import { CatalogueArt } from './catalogue-art';
import { ResourceStat, StatusBadge } from './game-ui';
const AdminApp = lazy(() => import('./AdminApp'));
const World3D = lazy(() => import('./world3d/World3D'));
const SAVE_KEY = 'mars-first-colony-save';
const categories: Category[] = [
  'Housing',
  'Life support',
  'Power',
  'Storage',
  'Mining',
];
const format = (value: number) => value.toFixed(2);
function App() {
  const clock = useRef<ClockState | null>(null);
  const last = useRef(performance.now());
  const inspectorRef = useRef<HTMLElement>(null);
  const catalogueOptionsRef = useRef<HTMLDetailsElement>(null);
  const [colony, setColony] = useState<ColonyState | null>(null);
  const buildingDefinitions = runtimeCatalogue(colony ?? undefined).buildings;
  const [catalogues, setCatalogues] = useState<{ id: string }[]>([]);
  const [selectedCatalogue, setSelectedCatalogue] = useState('current');
  const [currentCatalogue, setCurrentCatalogue] =
    useState<CatalogueSnapshot | null>(null);
  useEffect(() => {
    fetch('/api/catalogues/current')
      .then(async (r) => {
        if (r.ok)
          setCurrentCatalogue(catalogueSnapshotSchema.parse(await r.json()));
      })
      .catch(() => {});
    fetch('/api/catalogues')
      .then(async (r) => {
        if (r.ok) setCatalogues(await r.json());
      })
      .catch(() => {});
  }, []);
  const resourceDefinitions = catalogueResources(
    colony?.catalogue ?? currentCatalogue ?? undefined,
  );
  const [selectedResidentId, setSelectedResidentId] = useState<string | null>(
    null,
  );
  const selectResident = useCallback((id: string) => {
    setInspectorOpen(true);
    setSelectedResidentId(id);
    setTile(null);
  }, []);
  const [tile, setTile] = useState<Tile | null>(null);
  const [hover, setHover] = useState<Tile | null>(null);
  const [focus, setFocus] = useState<Tile | null>(null);
  const [mission, setMission] = useState(0);
  const [construction, setConstruction] = useState<BuildingType | null>(null);
  const constructionRef = useRef(construction);
  constructionRef.current = construction;
  const [category, setCategory] = useState<Category | 'Infrastructure' | null>(
    null,
  );
  const [infrastructureTool, setInfrastructureTool] = useState<{
    type: InfrastructureType;
    demolish: boolean;
  } | null>(null);
  const [draft, setDraft] = useState<Tile[]>([]);
  const [view, setView] = useState<InfrastructureType | 'normal' | 'geology'>(
    'normal',
  );
  const cancelPlacement = useCallback(() => {
    setConstruction(null);
    setInfrastructureTool(null);
    setDraft([]);
  }, []);
  const [message, setMessage] = useState('');
  const [inspectorOpen, setInspectorOpen] = useState(true);
  const [storageOpen, setStorageOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [threeD, setThreeD] = useState(false);
  const [lowGraphics, setLowGraphics] = useState(false);
  const fallback = useCallback(() => {
    setThreeD(false);
    setMessage('3D needs WebGL 2. The isometric map is active.');
  }, []);
  const validatePlacement = threeD ? placement3D : placement;
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
          if (threeD) {
            const check = placement3D(state, type, value);
            if (!check.valid) throw new Error(check.reason);
          }
          publish(construct(state, type, value));
          setConstruction(null);
          setMessage('Construction complete — costs deducted');
        } catch (error) {
          setMessage(
            error instanceof Error ? error.message : 'Construction failed',
          );
        }
      }
      setSelectedResidentId(null);
      setTile(value);
    },
    [publish, threeD],
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
        setInfrastructureTool(null);
        setDraft([]);
        setCategory(null);
        setSelectedResidentId(null);
        setTile(null);
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
    if (catalogueOptionsRef.current) catalogueOptionsRef.current.open = false;
    setMessage('');
    try {
      const response = await fetch('/api/new-game', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          seed: mission + 1,
          ...(selectedCatalogue === 'current'
            ? {}
            : { catalogueVersion: selectedCatalogue }),
        }),
      });
      if (!response.ok)
        throw new Error('API unavailable. Start the backend and retry.');
      const body: unknown = await response.json();
      const state = colonySchema.parse((body as { colony?: unknown }).colony);
      publish(state, true);
      setMessage(
        (body as { warning?: string }).warning ?? 'Colony initialized',
      );
      setFocus(null);
      setMission((value) => value + 1);
      setSelectedResidentId(null);
      setTile(null);
      setConstruction(null);
      setInfrastructureTool(null);
      setDraft([]);
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
      setMessage('Saved in this browser.');
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
      setFocus(null);
      setMission((value) => value + 1);
      setSelectedResidentId(null);
      setTile(null);
      setConstruction(null);
      setInfrastructureTool(null);
      setDraft([]);
      setCategory(null);
      setMessage('Browser save loaded');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Invalid save');
    }
  }
  const building = colony && tile ? buildingAt(colony, tile) : undefined;
  useEffect(() => {
    inspectorRef.current?.scrollTo({ top: 0 });
  }, [building?.id, selectedResidentId]);
  const cap = colony ? capacities(colony) : null;
  const warnings = colony ? alerts(colony) : [];
  const preview =
    colony && construction && hover
      ? validatePlacement(colony, construction, hover)
      : null;
  const infrastructurePreview =
    colony && infrastructureTool && draft.length
      ? routePreview(
          colony,
          infrastructureTool.type,
          draft,
          infrastructureTool.demolish,
        )
      : null;
  function confirmRoute() {
    if (!clock.current || !infrastructureTool) return;
    try {
      publish(
        buildInfrastructure(
          clock.current.colony,
          infrastructureTool.type,
          draft,
          infrastructureTool.demolish,
        ),
      );
      setDraft([]);
      setMessage(
        infrastructureTool.demolish
          ? 'Infrastructure removed'
          : 'Infrastructure constructed',
      );
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : 'Infrastructure command failed',
      );
    }
  }
  const worldProps: WorldProps = {
    colony,
    selectedResidentId,
    onResidentSelect: selectResident,
    view,
    infrastructureTool,
    draft,
    routeValid: infrastructurePreview?.valid ?? false,
    buildingPreviewValid: preview?.valid ?? true,
    onRoute: setDraft,
    onCancel: cancelPlacement,
    mission,
    focus,
    selected: tile,
    hovered: hover,
    construction,
    onSelect: select,
    onHover: setHover,
    onTouchdown: touchdown,
  };
  return (
    <main className="game-shell">
      <header className="topbar">
        <div className="brand">
          <h1>Mars: First Colony</h1>
          <h2>{colony?.name ?? 'Awaiting landing'}</h2>
        </div>
        <div className="mission-summary" aria-label="Mission status">
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
            <small data-testid="walking-count">
              {colony?.residents.filter((r) => r.activity === 'walking')
                .length ?? 0}{' '}
              walking
            </small>
          </div>
        </div>
        <div className="session-controls">
          <div
            className="session-buttons"
            role="group"
            aria-label="Colony controls"
          >
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
            <button
              disabled={!colony}
              aria-pressed={inspectorOpen && storageOpen}
              onClick={() => {
                setStorageOpen(!(inspectorOpen && storageOpen));
                setInspectorOpen(true);
                inspectorRef.current?.scrollTo({ top: 0 });
              }}
            >
              Storage overview
            </button>
          </div>
          <details className="catalogue-options" ref={catalogueOptionsRef}>
            <summary>Catalogue</summary>
            <label>
              New colony catalogue
              <select
                value={selectedCatalogue}
                onChange={(e) => setSelectedCatalogue(e.target.value)}
              >
                <option value="current">Current publication</option>
                <option value="builtin-v0331">Original game</option>
                {catalogues.map((c) => (
                  <option key={c.id} value={c.id} title={c.id}>
                    Publication {c.id.replace(/^published-/, '')}
                  </option>
                ))}
              </select>
            </label>
          </details>
        </div>
        <div className="hud" aria-label="Colony resources">
          {(['oxygen', 'water', 'food', 'energy'] as const).map((key) => {
            const resource = resourceDefinitions[key]!;
            return (
              <ResourceStat
                key={key}
                label={resource.label}
                icon={resource.icon}
                value={colony ? format(colony.inventory[key]) : '—'}
                capacity={
                  cap ? `/ ${cap[key]} ${resource.unit}` : resource.unit
                }
                low={
                  !!(colony && cap && colony.inventory[key] <= cap[key] * 0.2)
                }
                testId={`resource-${key}`}
              />
            );
          })}
        </div>
        <div className="simulation-controls">
          <StatusBadge
            tone={
              colony?.speed && colony.phase === 'active' ? 'healthy' : 'neutral'
            }
          >
            {!colony
              ? 'Standby'
              : colony.phase === 'landing'
                ? 'Landing'
                : colony.speed
                  ? 'Running'
                  : 'Paused'}
          </StatusBadge>
          <div
            className="time-controls"
            role="group"
            aria-label="Simulation speed"
          >
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
          <div className="map-tools">
            <label className="network-selector">
              Network display
              <select
                aria-label="Network display"
                value={view}
                onChange={(event) =>
                  setView(
                    event.target.value as
                      | InfrastructureType
                      | 'normal'
                      | 'geology',
                  )
                }
              >
                <option value="normal">Normal view</option>
                <option value="geology">Geological overlay</option>
                <option value="water">Water network</option>
                <option value="oxygen">Oxygen network</option>
                <option value="power">Electrical network</option>
                <option value="road">Road network</option>
              </select>
            </label>
            <button
              aria-expanded={inspectorOpen}
              aria-controls="colony-inspector"
              onClick={() => setInspectorOpen(!inspectorOpen)}
            >
              {inspectorOpen ? 'Hide inspector' : 'Show inspector'}
            </button>
          </div>
          {threeD ? (
            <Suspense
              fallback={
                <p className="map-loading" role="status">
                  Loading 3D terrain…
                </p>
              }
            >
              <World3D
                {...worldProps}
                low={lowGraphics}
                onFallback={fallback}
              />
            </Suspense>
          ) : (
            <World {...worldProps} />
          )}
          <div className="map-renderer-controls">
            <label>
              Map view
              <select
                aria-label="Map view"
                value={threeD ? '3d' : '2d'}
                onChange={(event) => {
                  cancelPlacement();
                  setHover(null);
                  setThreeD(event.target.value === '3d');
                }}
              >
                <option value="2d">Isometric</option>
                <option value="3d">3D preview</option>
              </select>
            </label>
            {threeD && (
              <label>
                Graphics
                <select
                  aria-label="Graphics"
                  value={lowGraphics ? 'low' : 'balanced'}
                  onChange={(event) =>
                    setLowGraphics(event.target.value === 'low')
                  }
                >
                  <option value="balanced">Balanced</option>
                  <option value="low">Low</option>
                </select>
              </label>
            )}
          </div>
          <div className="map-caption">
            <span className="eyebrow">
              {colony?.phase === 'landing'
                ? 'DESCENT / LANDING ZONE SECURED'
                : 'ARCADIA PLANITIA / SURFACE VIEW'}
            </span>
            <p>
              {threeD
                ? 'Drag or WASD to pan · Right drag to rotate and tilt · Scroll to zoom'
                : 'Drag to pan · Scroll to zoom · Click to select'}
            </p>
          </div>
          {colony && building && (
            <BuildingPopup
              key={building.id}
              colony={colony}
              building={building}
              onClose={() => setTile(null)}
              onCommand={(update) => {
                if (clock.current) publish(update(clock.current.colony));
              }}
            />
          )}
          <div className="map-dock">
            {colony?.phase === 'landing' && (
              <div className="landing-panel">
                <h3>Starship descending</h3>
                <p>Touchdown deploys 19 starter buildings for 10 colonists.</p>
                <button className="primary" onClick={touchdown}>
                  Skip landing
                </button>
              </div>
            )}
            {infrastructureTool && (
              <div
                className={`placement-panel infrastructure-preview ${infrastructurePreview && !infrastructurePreview.valid ? 'invalid' : ''}`}
                data-testid="route-preview"
              >
                <strong>
                  {infrastructureTool.demolish ? 'Demolish' : 'Place'}{' '}
                  {infrastructureDefinitions[infrastructureTool.type].name}
                </strong>
                <p>
                  Click or drag a connected route, then confirm. Right click /
                  Esc cancels.
                </p>
                <p>
                  {infrastructurePreview?.reason ?? 'Select route on terrain'} ·{' '}
                  {draft.length} tiles
                </p>
                <p data-testid="route-cost">
                  Cost: {infrastructurePreview?.cost ?? 0} metal · Refund:{' '}
                  {infrastructurePreview?.refund ?? 0} metal
                </p>
                <button
                  disabled={!infrastructurePreview?.valid}
                  onClick={confirmRoute}
                >
                  Confirm route
                </button>
                <button onClick={() => setDraft([])}>Clear route</button>
                <button onClick={cancelPlacement}>Cancel route</button>
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
                <small>
                  {buildingDefinitions[construction].cost.metal} metal ·{' '}
                  {buildingDefinitions[construction].cost.credits} credits · Esc
                  to cancel
                </small>
                <button onClick={cancelPlacement}>Cancel placement</button>
              </div>
            )}
            {category === 'Infrastructure' && (
              <div className="build-menu infrastructure-menu">
                {infrastructureTypeSchema.options.map((type) => (
                  <button
                    key={type}
                    aria-pressed={infrastructureTool?.type === type}
                    onClick={() => {
                      setConstruction(null);
                      setInfrastructureTool({ type, demolish: false });
                      setDraft([]);
                      setView(type);
                    }}
                  >
                    {infrastructureDefinitions[type].name}
                    <small>
                      {infrastructureDefinitions[type].metal} metal / tile
                    </small>
                  </button>
                ))}
                <button
                  disabled={!infrastructureTool}
                  aria-pressed={infrastructureTool?.demolish ?? false}
                  onClick={() => {
                    setInfrastructureTool((tool) =>
                      tool ? { ...tool, demolish: !tool.demolish } : null,
                    );
                    setDraft([]);
                  }}
                >
                  Demolish tool
                </button>
                <span className="build-hint">
                  Layers can cross on free terrain. Pipes, cables and roads
                  connect directly beside any building side.
                </span>
              </div>
            )}
            {category && category !== 'Infrastructure' && (
              <div className="build-menu">
                {(Object.keys(buildingDefinitions) as BuildingType[])
                  .filter(
                    (type) =>
                      type !== 'starship' &&
                      buildingDefinitions[type].category === category,
                  )
                  .map((type) => {
                    const d = buildingDefinitions[type];
                    const available =
                      !!colony && buildingAvailable(colony, type);
                    return (
                      <button
                        key={type}
                        aria-pressed={construction === type}
                        disabled={!available}
                        onClick={() => {
                          setInfrastructureTool(null);
                          setDraft([]);
                          setConstruction(type);
                          setCategory(null);
                        }}
                      >
                        <CatalogueArt
                          className="build-icon"
                          width={34}
                          height={34}
                          reference={
                            colony?.catalogue.document.buildings.find(
                              (b) => b.id === type,
                            )?.icon ?? 'placeholder:building'
                          }
                          kind="building"
                          alt=""
                        />
                        <span className="build-name">{d.name}</span>
                        <small>
                          {d.width}×{d.height} · {d.cost.metal} metal ·{' '}
                          {d.cost.credits} credits
                          {!available && ' · Unavailable in this catalogue'}
                        </small>
                      </button>
                    );
                  })}
                <span className="build-hint">
                  Metal: {colony?.inventory.metal} · Esc to cancel
                </span>
              </div>
            )}
          </div>
          {message && (
            <div className="toast">
              <span role="status">{message}</span>
              <button
                aria-label="Dismiss message"
                onClick={() => setMessage('')}
              >
                ×
              </button>
            </div>
          )}
        </div>
        <aside
          ref={inspectorRef}
          id="colony-inspector"
          className="inspector"
          hidden={!inspectorOpen}
        >
          <span className="eyebrow">COLONY INSPECTOR</span>
          {colony && storageOpen && (
            <StorageOverview
              colony={colony}
              onInspect={(id) => {
                const b = colony.buildings.find((b) => b.id === id);
                if (b) {
                  setSelectedResidentId(null);
                  setTile({ x: b.x, y: b.y });
                  setFocus({ x: b.x, y: b.y });
                  setStorageOpen(false);
                }
              }}
            />
          )}
          <p data-testid="selection">
            {selectedResidentId
              ? 'Resident conversation'
              : tile
                ? `Sector ${tile.x}, ${tile.y}`
                : 'Select a terrain tile'}
          </p>
          {colony && selectedResidentId && (
            <ColonistInspector
              colony={colony}
              id={selectedResidentId}
              onClose={() => setSelectedResidentId(null)}
            />
          )}
          {!building && !selectedResidentId && (
            <section>
              <h3>Surface operations</h3>
              <p className="muted">
                Select a building footprint or use the roster to open its
                information popup.
              </p>
            </section>
          )}
          {colony && (
            <WorldNavigator
              key={`navigation-${colony.seed}-${colony.landingZone.x}-${colony.landingZone.y}`}
              colony={colony}
              selected={tile}
              onFocus={(value) => {
                cancelPlacement();
                setSelectedResidentId(null);
                setTile(value);
                setFocus(value);
              }}
            />
          )}
          {colony?.phase === 'active' && (
            <ResidentsPanel
              colony={colony}
              onSelect={selectResident}
              selectedId={selectedResidentId}
              onCommand={(update) => {
                if (clock.current) publish(update(clock.current.colony));
              }}
            />
          )}
          {colony?.phase === 'active' && (
            <NetworkInspector
              colony={colony}
              building={building}
              tile={tile}
              onChange={(update) => {
                if (clock.current) publish(update(clock.current.colony));
              }}
              onView={setView}
            />
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
                    <dt>{resourceDefinitions[key]!.label}</dt>
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
                      {resourceDefinitions[key]!.label}: +
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
            <GeologyPanel
              key={`geology-${colony.seed}-${colony.landingZone.x}-${colony.landingZone.y}`}
              colony={colony}
              selected={tile}
              onChange={publish}
              onFocus={(p) => {
                setSelectedResidentId(null);
                setTile(p);
                setFocus(p);
                setView('geology');
              }}
            />
          )}
          {colony && (
            <details>
              <summary>Building roster ({colony.buildings.length})</summary>
              <div className="roster">
                {colony.buildings.map((b) => (
                  <button
                    key={b.id}
                    onClick={() => {
                      setSelectedResidentId(null);
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
            Temporary original sprite artwork · Browser saves only · Cargo
            logistics and refining pending
          </p>
        </aside>
      </section>
      <footer className="construction-toolbar">
        <nav aria-label="Construction categories">
          {[...categories, 'Infrastructure' as const].map((item) => (
            <button
              key={item}
              disabled={!colony || colony.phase !== 'active'}
              aria-pressed={category === item}
              onClick={() => {
                setCategory(category === item ? null : item);
                setTile(null);
                setConstruction(null);
                setInfrastructureTool(null);
                setDraft([]);
              }}
            >
              {item}
            </button>
          ))}
          {construction && (
            <span className="active-tool">
              Placing {buildingDefinitions[construction].name}
            </span>
          )}
          <button disabled title="Refining and factories are pending">
            Industry · locked
          </button>
        </nav>
      </footer>
    </main>
  );
}
createRoot(document.getElementById('root')!).render(
  location.pathname === '/admin' ? (
    <Suspense fallback={<p>Loading administration…</p>}>
      <AdminApp />
    </Suspense>
  ) : (
    <App />
  ),
);
