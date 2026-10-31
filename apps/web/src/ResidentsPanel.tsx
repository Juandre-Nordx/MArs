import {
  arrivalReadiness,
  buildingDefinitions,
  populationRates,
  toggleArrivals,
  type ColonyState,
} from '@mars/simulation';
export function ResidentsPanel({
  colony,
  onCommand,
}: {
  colony: ColonyState;
  onCommand: (update: (state: ColonyState) => ColonyState) => void;
}) {
  const readiness = arrivalReadiness(colony),
    capacity = colony.buildings
      .filter((b) => b.enabled && b.health > 0)
      .reduce((sum, b) => sum + buildingDefinitions[b.type].housing, 0);
  return (
    <section aria-label="Colonists" className="residents-panel">
      <h4>Settlement residents</h4>
      <p data-testid="resident-summary">
        {colony.residents.length} residents ·{' '}
        {colony.residents.filter((r) => r.activity === 'walking').length}{' '}
        walking · {Math.max(0, capacity - colony.population)} vacant beds
      </p>
      <p className="muted">
        Each person uses {populationRates.oxygen} kg oxygen,{' '}
        {populationRates.water} kg water and {populationRates.food} kg food per
        tick, including while walking.
      </p>
      <h4>Buggy arrivals</h4>
      <p data-testid="arrival-status">
        {colony.immigration.convoy
          ? colony.immigration.convoy.phase === 'arriving'
            ? 'Buggy arriving with one newcomer'
            : 'Buggy returning to the outpost'
          : readiness.reason}
      </p>
      <p className="muted">{colony.immigration.lastEvent}</p>
      <button onClick={() => onCommand(toggleArrivals)}>
        {colony.immigration.enabled ? 'Pause arrivals' : 'Allow arrivals'}
      </button>
      <p className="muted">
        Newcomers need a reachable, connected vacant home and 30 ticks of safety
        reserves. One person joins at drop-off; no free supplies arrive.
      </p>
      <details>
        <summary>Resident roster</summary>
        <ul className="resident-roster">
          {colony.residents.map((r) => (
            <li key={r.id}>
              <strong>{r.id.replace('colonist-', 'Colonist ')}</strong> ·{' '}
              {r.activity}
              <small>
                {r.homeId ? `Home ${r.homeId}` : 'Needs a home'}
                {r.destinationId
                  ? ` · visiting ${buildingDefinitions[colony.buildings.find((b) => b.id === r.destinationId)?.type ?? 'starship'].name}`
                  : ''}
              </small>
            </li>
          ))}
        </ul>
      </details>
    </section>
  );
}
