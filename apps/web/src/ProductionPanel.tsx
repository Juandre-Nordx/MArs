import { catalogueResources } from './catalogue-view';
import { useState } from 'react';
import {
  productsFor,
  productById,
  selectProduct,
  queueProduct,
  cancelProduction,
  productionLimits,
  productionBlock,
  productionReasons,
  droneFleetLimits,
  type ColonyState,
  type Building,
  type Stock,
} from '@mars/simulation';
export function ProductionPanel({
  colony,
  building,
  onCommand,
}: {
  colony: ColonyState;
  building: Building;
  onCommand: (fn: (s: ColonyState) => ColonyState) => void;
}) {
  const resourceDefinitions = catalogueResources(colony.catalogue);
  const [error, setError] = useState('');
  const available = productsFor(building.type, colony);
  if (!available.length) return null;
  const selected =
    colony.production.selections.find((s) => s.buildingId === building.id)
      ?.productId ?? available[0]!.id;
  const product = productById(selected, colony)!;
  const orders = colony.production.orders.filter(
    (o) => o.buildingId === building.id,
  );
  const fleet = colony.industry.drones.filter(
    (d) => d.stationId === building.id,
  ).length;
  const command = (fn: (s: ColonyState) => ColonyState) => {
    try {
      onCommand(fn);
      setError('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Production command failed');
    }
  };
  const cost = (stock: Stock) =>
    Object.entries(stock)
      .filter(([, n]) => n > 0)
      .map(
        ([key, n]) =>
          `${n} ${resourceDefinitions[key as keyof Stock].label.toLowerCase()}`,
      )
      .join(' · ');
  return (
    <section aria-label="Production queue" className="production-panel">
      <h4>Build drones</h4>
      <label>
        Available product
        <select
          aria-label="Available product"
          value={selected}
          onChange={(e) =>
            command((s) => selectProduct(s, building.id, e.target.value))
          }
        >
          {available.map((p) => (
            <option key={p.id} value={p.id}>
              {p.icon} {p.name}
            </option>
          ))}
        </select>
      </label>
      <p>{product.description}</p>
      <p data-testid="product-cost">
        Reserve: {cost(product.inputs)} · {product.duration} assembly ticks · +
        {product.electricity} kWh per assembly tick
      </p>
      <p>
        Output: {product.output.quantity} {product.output.kind} drone · no
        technology prerequisites · {product.workers} assembly workers required.
        Deployment follows assembly on the next powered tick, when a footprint
        entry is free.
      </p>
      <p data-testid="fleet-capacity">
        Fleet: {fleet} deployed + {orders.length} reserved /{' '}
        {droneFleetLimits.station}. Queue: {orders.length} /{' '}
        {productionLimits.queue}.
      </p>
      <p>
        Available shared metal: {colony.inventory.metal.toFixed(2)}.
        Reservations are already deducted; raw mine ore cannot pay these
        recipes.
      </p>
      <button
        onClick={() => command((s) => queueProduct(s, building.id, selected))}
      >
        Queue {product.name.toLowerCase()}
      </button>
      {error && <p role="alert">{error}</p>}
      {orders.length > 0 && (
        <ol>
          {orders.map((o, i) => {
            const p = productById(o.productId, colony)!;
            const block = productionBlock(colony, building, o);
            const reason =
              block === 'ready'
                ? o.blocked === 'no-power'
                  ? 'no-power'
                  : 'ready'
                : block;
            return (
              <li key={o.id} data-testid="production-order">
                <strong>
                  {p.name} · {o.id}
                </strong>
                <p>
                  {o.progress} / {p.duration} assembly ticks ·{' '}
                  {o.status.replaceAll('-', ' ')}
                </p>
                <progress
                  aria-label={`${o.id} assembly progress`}
                  max={p.duration}
                  value={o.progress}
                />
                <p>
                  {i > 0
                    ? 'Waiting behind the current order'
                    : reason === 'ready'
                      ? o.status === 'awaiting-deployment'
                        ? 'Completed output awaiting deployment'
                        : colony.speed === 0
                          ? 'Simulation paused'
                          : 'Assembly ready / running'
                      : productionReasons[reason]}
                </p>
                <small>Reserved: {cost(o.reserved)}</small>
                <button
                  aria-label={`Cancel ${o.id}`}
                  onClick={() => command((s) => cancelProduction(s, o.id))}
                >
                  Cancel order
                </button>
              </li>
            );
          })}
        </ol>
      )}
      <p>
        Cancel returns the reserved materials in full, even after partial
        assembly. Electricity already consumed is not refunded. If refund
        storage is full, cancellation is rejected and the reservation stays
        saved.
      </p>
    </section>
  );
}
