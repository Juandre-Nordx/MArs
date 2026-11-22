import type { ReactNode } from 'react';
import { CatalogueArt } from './catalogue-art';

export function ResourceStat({
  label,
  icon,
  value,
  capacity,
  low,
  testId,
}: {
  label: string;
  icon: string;
  value: string;
  capacity: string;
  low: boolean;
  testId: string;
}) {
  return (
    <div className="stat resource-stat" data-low={low}>
      <CatalogueArt
        className="hud-icon"
        reference={icon}
        kind="resource"
        width={22}
        height={22}
        alt=""
      />
      <span className="stat-label" title={label}>
        {label}
      </span>
      <strong data-testid={testId}>{value}</strong>
      <small title={capacity}>{capacity}</small>
      <span className="resource-warning" aria-hidden={!low}>
        Low
      </span>
    </div>
  );
}

export function StatusBadge({
  children,
  tone = 'neutral',
}: {
  children: ReactNode;
  tone?: 'neutral' | 'healthy' | 'warning' | 'critical';
}) {
  return <span className={`status-badge ${tone}`}>{children}</span>;
}
