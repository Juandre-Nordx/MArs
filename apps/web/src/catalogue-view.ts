import {
  resourceDefinitions,
  mineralDefinitions,
  resourceKeys,
  type Resource,
  type CatalogueSnapshot,
} from '@mars/simulation';
export function catalogueResources(catalogue?: CatalogueSnapshot) {
  return Object.fromEntries(
    resourceKeys.map((id) => {
      const entry = catalogue?.document.resources.find((r) => r.id === id);
      return [
        id,
        {
          label: entry?.name ?? resourceDefinitions[id].label,
          unit: entry?.unit ?? resourceDefinitions[id].unit,
          icon: entry?.icon ?? 'placeholder:resource',
        },
      ];
    }),
  ) as Record<Resource, { label: string; unit: string; icon: string }>;
}
export function catalogueMinerals(catalogue: CatalogueSnapshot) {
  return Object.fromEntries(
    Object.entries(mineralDefinitions).map(([id, d]) => [
      id,
      {
        ...d,
        name:
          catalogue.document.resources.find((r) => r.id === id)?.name ?? d.name,
      },
    ]),
  ) as {
    [K in keyof typeof mineralDefinitions]: Omit<
      (typeof mineralDefinitions)[K],
      'name'
    > & { name: string };
  };
}
