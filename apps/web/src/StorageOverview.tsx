import {
  buildingDefinitions,
  resourceDefinitions,
  storageOverview,
  type ColonyState,
} from '@mars/simulation';
export function StorageOverview({
  colony,
  onInspect,
}: {
  colony: ColonyState;
  onInspect: (id: string) => void;
}) {
  const overview = storageOverview(colony),
    format = (n: number) => n.toFixed(2);
  return (
    <section aria-label="Storage overview" data-testid="storage-overview">
      <h3>Storage overview</h3>
      <p>
        Totals below count colony reserves once. Raw mine buffers and charged
        drone batteries are separate.
      </p>
      <h4>Colony resources</h4>
      <table>
        <thead>
          <tr>
            <th>Resource / location</th>
            <th>Quantity / capacity</th>
            <th>Warning</th>
          </tr>
        </thead>
        <tbody>
          {overview.resources.map((r) => (
            <tr key={r.resource} data-testid={`storage-${r.resource}`}>
              <th>
                {resourceDefinitions[r.resource].label}
                <small>
                  {r.scope === 'shared'
                    ? 'Shared colony inventory'
                    : 'Physical utility stores (aggregate)'}
                </small>
              </th>
              <td>
                {format(r.quantity)} / {format(r.capacity)}{' '}
                {resourceDefinitions[r.resource].unit}
              </td>
              <td>{r.warning}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <details>
        <summary>Shared capacity contributors</summary>
        <p>
          Cargo ownership is shared; these buildings add capacity, not assigned
          stock.
        </p>
        {overview.resources
          .filter((r) => r.scope === 'shared')
          .map((r) => (
            <div key={r.resource}>
              {resourceDefinitions[r.resource].label}:{' '}
              {r.capacityBuildings.map((id) => (
                <button key={id} onClick={() => onInspect(id)}>
                  {
                    buildingDefinitions[
                      colony.buildings.find((b) => b.id === id)!.type
                    ].name
                  }{' '}
                  · {id}
                </button>
              ))}
            </div>
          ))}
      </details>
      <h4>Physical utility stores</h4>
      {colony.phase === 'landing' && (
        <p>Landing cargo remains aboard the descending Starship.</p>
      )}
      {overview.utilityStores.map((s) => (
        <p key={`${s.buildingId}-${s.resource}`}>
          <button onClick={() => onInspect(s.buildingId)}>
            {
              buildingDefinitions[
                colony.buildings.find((b) => b.id === s.buildingId)!.type
              ].name
            }{' '}
            · {s.buildingId}
          </button>{' '}
          {resourceDefinitions[s.resource].label}: {format(s.quantity)} /{' '}
          {s.capacity} {resourceDefinitions[s.resource].unit}
          {!s.enabled ? ' · Disabled; contents retained' : ''}
          {s.quantity >= s.capacity
            ? ' · Full'
            : s.quantity <= s.capacity * 0.2
              ? ' · Low stock'
              : ''}
        </p>
      ))}
      <h4>Raw minerals · local mine buffers</h4>
      <p>
        Cargo logistics and refining are pending. Ore stays at its mine; it
        cannot pay metal construction costs.
      </p>
      {overview.mines.length ? (
        overview.mines.map((m) => (
          <p key={m.buildingId} data-testid={`mine-buffer-${m.buildingId}`}>
            <button onClick={() => onInspect(m.buildingId)}>
              {m.label} · {m.buildingId}
            </button>{' '}
            {format(m.quantity)} / {m.capacity} kg ·{' '}
            {m.quantity >= m.capacity ? 'Full · ' : ''}
            {m.status.replaceAll('-', ' ')}
          </p>
        ))
      ) : (
        <p>No mines constructed.</p>
      )}
      <details>
        <summary>Drone batteries (already charged from the grid)</summary>
        {overview.droneBatteries.map((d) => (
          <p key={d.id}>
            <button onClick={() => onInspect(d.stationId)}>{d.id}</button>{' '}
            {format(d.quantity)} / {d.capacity} kWh
          </p>
        ))}
      </details>
    </section>
  );
}
