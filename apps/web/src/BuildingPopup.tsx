import { ProductionPanel } from './ProductionPanel';
import { useEffect, useRef } from 'react';
import {
  buildingDefinitions,
  resourceDefinitions,
  resourceKeys,
  connectionTiles,
  networkFor,
  isUsable,
  isMine,
  extractionDefinitions,
  mineralDefinitions,
  type ColonyState,
  type Building,
  type BuildingType,
  toggleBuilding,
} from '@mars/simulation';
import { connectionLabels } from './NetworkInspector';
const purposes: Record<BuildingType, string> = {
  starship: 'Command centre, landing cargo and shared colony capacity.',
  housing: 'A home for one resident with connected life support.',
  'oxygen-generator': 'Turns water into oxygen using electricity and workers.',
  'oxygen-tank': 'Physically stores oxygen for its connected network.',
  'water-recycler':
    'Recovers water from wastewater using electricity and workers.',
  'water-tank': 'Physically stores water and adds shared wastewater capacity.',
  farm: 'Produces food and oxygen from water, carbon dioxide and nutrients.',
  solar: 'Generates electrical energy in daylight.',
  battery: 'Stores electrical energy for connected consumers.',
  warehouse: 'Adds shared metal, nutrients and carbon dioxide capacity.',
  'survey-station':
    'Operates survey and extraction drones and charges their batteries.',
  'surface-mine':
    'Extracts discovered surface minerals into a finite local buffer.',
  'underground-mine':
    'Extracts compatible underground minerals into a local buffer.',
  'ice-drill':
    'Extracts raw ice into a local buffer; water refining remains pending.',
  'deep-mine': 'Extracts compatible deep deposits into a local buffer.',
};
export function BuildingPopup({
  colony,
  building,
  onClose,
  onCommand,
}: {
  colony: ColonyState;
  building: Building;
  onClose: () => void;
  onCommand: (update: (s: ColonyState) => ColonyState) => void;
}) {
  const close = useRef<HTMLButtonElement>(null);
  useEffect(() => close.current?.focus({ preventScroll: true }), []);
  const definition = buildingDefinitions[building.type];
  const power = networkFor(colony.networks, building.id, 'power');
  const drones = colony.industry.drones.filter(
    (d) =>
      d.stationId === building.id ||
      (d.job?.type === 'mine' && d.job.id === building.id),
  );
  const mine = colony.industry.mines.find((m) => m.buildingId === building.id);
  const deposit = mine
    ? Object.values(colony.world.chunks)
        .flatMap((c) => c.deposits)
        .find((d) => d.id === mine.depositId)
    : undefined;
  return (
    <section
      role="dialog"
      aria-modal="false"
      aria-labelledby={`building-title-${building.id}`}
      className="building-popup"
      data-testid="building-inspector"
      onPointerDown={(e) => e.stopPropagation()}
      onPointerUp={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
      onWheel={(e) => e.stopPropagation()}
    >
      <header className="building-popup-header">
        <h3 id={`building-title-${building.id}`}>{definition.name}</h3>
        <button
          ref={close}
          aria-label="Close building information"
          onClick={onClose}
        >
          ×
        </button>
      </header>
      <svg
        width="100"
        height="65"
        viewBox="0 0 100 65"
        role="img"
        aria-label={`${definition.name} placeholder artwork`}
      >
        <path d="M10 32 50 12 90 32 50 52Z" fill="#252e34" />
        <path
          d="M22 25 50 11 78 25 50 39Z"
          fill={`#${definition.color.toString(16).padStart(6, '0')}`}
        />
        <path d="M22 25V43L50 57V39Z" fill="#586b77" />
        <path d="M50 39V57L78 43V25Z" fill="#8ba2a7" />
      </svg>
      <p className="muted">
        {building.type} · {building.id} · {building.x},{building.y} · Original
        placeholder art
      </p>
      <p>{purposes[building.type]}</p>
      <dl>
        <dt>Condition</dt>
        <dd>
          {building.health}% · {building.enabled ? 'Enabled' : 'Disabled'}
        </dd>
        <dt>Workers assigned</dt>
        <dd>
          {building.workers} / {definition.workers}
        </dd>
        <dt>Production status</dt>
        <dd data-testid="building-status">
          {connectionLabels[building.status] ?? building.status}
        </dd>
        <dt>Base power demand</dt>
        <dd>{definition.power} kWh/tick</dd>
        <dt>Connected grid</dt>
        <dd>
          {power
            ? `${power.supply.toFixed(2)} supply / ${power.demand.toFixed(2)} demand / ${power.allocated.toFixed(2)} allocated (whole grid)`
            : 'No electrical connection'}
        </dd>
      </dl>
      <h4>Utility connections</h4>
      {(['water', 'oxygen', 'power', 'road'] as const).map((type) => {
        const contacts = connectionTiles(building, type);
        if (!contacts.length) return null;
        const connected = contacts.filter((t) =>
          colony.infrastructure.some(
            (s) => s.type === type && s.x === t.x && s.y === t.y && isUsable(s),
          ),
        );
        return (
          <p key={type}>
            {type}: {connected.length} connected footprint contact(s)
          </p>
        );
      })}
      <h4>Local utility storage</h4>
      {(['water', 'oxygen', 'energy'] as const).map((key) => (
        <p key={key}>
          {resourceDefinitions[key].label}: {building.stores[key].toFixed(2)} /{' '}
          {definition.capacity[key] ?? 0} {resourceDefinitions[key].unit}
        </p>
      ))}
      {mine && deposit && isMine(building.type) && (
        <section aria-label="Mine output">
          <h4>Local raw mineral buffer</h4>
          <p>
            {mineralDefinitions[deposit.resource].name}:{' '}
            {mine.quantity.toFixed(2)} /{' '}
            {extractionDefinitions[building.type].capacity} kg
          </p>
          <p>
            Cargo logistics and refining are pending. This buffer does not add
            usable metal or water to shared inventory.
          </p>
        </section>
      )}
      <details>
        <summary>Shared colony inventory (not local ownership)</summary>
        {resourceKeys
          .filter((k) => !['water', 'oxygen', 'energy'].includes(k))
          .map((k) => (
            <p key={k}>
              {resourceDefinitions[k].label}: {colony.inventory[k].toFixed(2)}{' '}
              {resourceDefinitions[k].unit} · capacity contributed here:{' '}
              {definition.capacity[k] ?? 0}
            </p>
          ))}
      </details>
      {drones.length > 0 && (
        <details>
          <summary>Assigned drones ({drones.length})</summary>
          {drones.map((d) => (
            <p key={d.id}>
              {d.id} · {d.kind} · {d.activity} · {d.battery.toFixed(2)} kWh ·{' '}
              {d.job ? `${d.job.type}: ${d.job.id}` : 'No job'}
            </p>
          ))}
        </details>
      )}
      <h4>Required continuous inputs / tick</h4>
      <p>
        {Object.entries(definition.inputs)
          .map(([key, value]) => `${key}: ${value}`)
          .join(' · ') || 'No material inputs'}
      </p>
      <h4>Continuous production per tick</h4>
      <p>
        {definition.generation
          ? `${definition.generation} kWh in daylight`
          : Object.entries(definition.outputs)
              .map(([key, value]) => `${key}: ${value}`)
              .join(' · ') || 'No continuous output'}
      </p>
      <ProductionPanel
        colony={colony}
        building={building}
        onCommand={onCommand}
      />
      <button onClick={() => onCommand((s) => toggleBuilding(s, building.id))}>
        {building.enabled ? 'Disable building' : 'Enable building'}
      </button>
    </section>
  );
}
