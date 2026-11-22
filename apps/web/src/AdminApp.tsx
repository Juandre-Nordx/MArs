import {
  cloneElement,
  isValidElement,
  useEffect,
  useRef,
  useState,
  type ReactNode,
  type ReactElement,
} from 'react';
import {
  builtinCatalogue,
  buildingLayoutRules,
  maxBatteryFootprint,
  type CatalogueDocument,
  type ResourceEntry,
  type BuildingEntry,
  type RecipeEntry,
} from '@mars/simulation';
import { CatalogueArt } from './catalogue-art';
import { SpritePreview } from './SpritePreview';
import './admin.css';
type Kind = 'resources' | 'buildings' | 'recipes';
type Entry = ResourceEntry | BuildingEntry | RecipeEntry;
type Draft = {
  revision: number;
  baseVersion: number | null;
  document: CatalogueDocument;
};
type ArtworkField = 'icon' | 'sprite';
type ArtworkUpload = { id: string; width: number; height: number };
type ArtworkFeedback =
  | { result: ArtworkUpload }
  | { error: string; reauthenticate: boolean };
type Data = {
  artworkLimits?: {
    inputBytes: number;
    outputBytes: number;
    spriteOutputBytes?: number;
    minSide: number;
    maxSide: number;
    iconSide: number;
    maxPixels: number;
  };
  draft: Draft | null;
  current: { id: number } | null;
  errors: string[];
  diff: { kind: string; id: string; before: unknown; after: unknown }[];
  history: { id: number; createdAt: string; digest: string }[];
};
type Session = { email: string; csrfToken: string; expiresAt: string };
class AdminRequestError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}
function displayBytes(bytes: number) {
  if (bytes % (1024 * 1024) === 0) return `${bytes / (1024 * 1024)} MiB`;
  if (bytes % 1024 === 0) return `${bytes / 1024} KiB`;
  return `${bytes.toLocaleString()} bytes`;
}
const pages = [
  'Overview',
  'Minerals & Resources',
  'Industry Buildings',
  'Drafts & Publishing',
  'Audit History',
  'Admin Account',
];
function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="admin-field">
      <span>{label}</span>
      {isValidElement(children)
        ? cloneElement(children as ReactElement<{ 'aria-label'?: string }>, {
            'aria-label': label,
          })
        : children}
    </label>
  );
}
function Text({
  label,
  value,
  onChange,
  disabled = false,
}: {
  label: string;
  value: string;
  onChange: (s: string) => void;
  disabled?: boolean;
}) {
  return (
    <Field label={label}>
      <input
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
      />
    </Field>
  );
}
function Num({
  label,
  value,
  onChange,
  min = 0,
  max = 1000000,
  step = 'any',
  disabled = false,
}: {
  label: string;
  value: number;
  onChange: (n: number) => void;
  min?: number;
  max?: number;
  step?: string;
  disabled?: boolean;
}) {
  return (
    <Field label={label}>
      <input
        type="number"
        min={min}
        max={max}
        step={step}
        disabled={disabled}
        required
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </Field>
  );
}
function Select({
  label,
  value,
  choices,
  onChange,
}: {
  label: string;
  value: string;
  choices: readonly string[];
  onChange: (s: string) => void;
}) {
  return (
    <Field label={label}>
      <select
        aria-label={label}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      >
        {choices.map((c) => (
          <option key={c}>{c}</option>
        ))}
      </select>
    </Field>
  );
}
type Quantity = { resourceId: string; quantity: number };
function Quantities({
  label,
  value,
  resources,
  onChange,
}: {
  label: string;
  value: Quantity[];
  resources: ResourceEntry[];
  onChange: (q: Quantity[]) => void;
}) {
  return (
    <fieldset>
      <legend>{label}</legend>
      {value.map((q, i) => (
        <div className="admin-quantity" key={i}>
          <Field label={`${label} resource ${i + 1}`}>
            <select
              value={q.resourceId}
              onChange={(e) =>
                onChange(
                  value.map((v, n) =>
                    n === i ? { ...v, resourceId: e.target.value } : v,
                  ),
                )
              }
            >
              {resources.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name} ({r.unit})
                </option>
              ))}
            </select>
          </Field>
          <Num
            label={`${label} quantity ${i + 1}`}
            value={q.quantity}
            onChange={(quantity) =>
              onChange(value.map((v, n) => (n === i ? { ...v, quantity } : v)))
            }
          />
          <button
            type="button"
            onClick={() => onChange(value.filter((_, n) => n !== i))}
          >
            Remove
          </button>
        </div>
      ))}
      <button
        type="button"
        onClick={() =>
          onChange([...value, { resourceId: resources[0]!.id, quantity: 1 }])
        }
      >
        Add {label.toLowerCase()}
      </button>
    </fieldset>
  );
}
export default function AdminApp() {
  const uploadRequest = useRef<AbortController | null>(null);
  useEffect(() => () => uploadRequest.current?.abort(), []);
  const [session, setSession] = useState<Session | null>(null),
    [boot, setBoot] = useState(true),
    [data, setData] = useState<Data | null>(null),
    [page, setPage] = useState('Overview'),
    [kind, setKind] = useState<Kind>('resources'),
    [entry, setEntry] = useState<Entry | null>(null),
    [creating, setCreating] = useState(false),
    [dirty, setDirty] = useState(false),
    [message, setMessage] = useState(''),
    [error, setError] = useState(''),
    [working, setBusy] = useState(false),
    [uploading, setUploading] = useState<ArtworkField | null>(null),
    [artworkFeedback, setArtworkFeedback] = useState<
      Partial<Record<ArtworkField, ArtworkFeedback>>
    >({}),
    [query, setQuery] = useState(''),
    [sort, setSort] = useState('name'),
    [descending, setDescending] = useState(false),
    [validated, setValidated] = useState<number | null>(null),
    [audit, setAudit] = useState<
      {
        id: number;
        actorId: string;
        action: string;
        detail: unknown;
        createdAt: string;
      }[]
    >([]);
  const busy = working || uploading !== null;
  async function request<T>(
    path: string,
    body?: unknown,
    {
      signal,
      csrfToken = session?.csrfToken,
    }: { signal?: AbortSignal; csrfToken?: string } = {},
  ): Promise<T> {
    const response = await fetch(`/api/admin/${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      credentials: 'same-origin',
      signal,
      headers: {
        ...(body !== undefined
          ? {
              'Content-Type': 'application/json',
              'X-CSRF-Token': csrfToken ?? '',
            }
          : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const result = await response.json().catch(() => null);
    if (!response.ok) {
      // Upload errors stay with the editor, including a session that expired mid-edit.
      if (response.status === 401 && !signal) setSession(null);
      const details = [
        result?.error,
        ...(Array.isArray(result?.issues) ? result.issues : []),
      ]
        .filter(Boolean)
        .join('\n');
      throw new AdminRequestError(
        response.status,
        details ||
          (response.status === 413
            ? 'File too large for the server.'
            : 'The admin service is unavailable. Try again.'),
      );
    }
    if (!result)
      throw new Error('The admin service returned an unreadable response.');
    return result as T;
  }
  async function action(fn: () => Promise<void>) {
    setBusy(true);
    setError('');
    setMessage('');
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Request failed');
    } finally {
      setBusy(false);
    }
  }
  async function refresh() {
    setData(await request<Data>('catalogue'));
    setValidated(null);
  }
  useEffect(() => {
    fetch('/api/admin/session')
      .then(async (r) => {
        if (r.ok) setSession(await r.json());
        else if (r.status !== 401) setError((await r.json()).error);
      })
      .catch(() => setError('Admin service unavailable'))
      .finally(() => setBoot(false));
  }, []);
  useEffect(() => {
    if (session) void action(refresh);
  }, [session]); // Session changes reload the authoritative draft.
  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      if (dirty) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);
  function discard() {
    if (busy || uploadRequest.current) return false;
    return (
      !dirty ||
      window.confirm('Discard unsaved changes? Your form has not been saved.')
    );
  }
  function navigate(next: string) {
    if (!discard()) return;
    setPage(next);
    if (next === 'Minerals & Resources') setKind('resources');
    if (next === 'Industry Buildings') setKind('buildings');
    setEntry(null);
    setArtworkFeedback({});
    setDirty(false);
    setQuery('');
    if (next === 'Audit History')
      void action(async () => setAudit(await request('audit')));
  }
  function edit(value: Entry, create = false) {
    if (!discard()) return;
    setEntry(structuredClone(value));
    setCreating(create);
    setArtworkFeedback({});
    setDirty(false);
  }
  function change(patch: Record<string, unknown>) {
    setEntry((e) => (e ? ({ ...e, ...patch } as Entry) : e));
    setDirty(true);
    setValidated(null);
  }
  function add() {
    const common = {
      id: '',
      name: 'New definition',
      description: '',
      revision: 1,
      status: 'archived' as const,
      support: 'planned' as const,
    };
    const value: Entry =
      kind === 'resources'
        ? {
            ...common,
            icon: 'placeholder:resource',
            category: 'raw-mineral',
            baseValue: 0,
            unit: 'kg',
          }
        : kind === 'buildings'
          ? {
              ...builtinCatalogue().document.buildings[0]!,
              ...common,
              category: 'Industry',
              icon: 'placeholder:building',
              sprite: 'placeholder:building',
              width: 1,
              height: 1,
              cost: [],
              creditCost: 0,
              workers: 0,
              utilities: [],
              storage: [],
              electricity: { quantity: 0, unit: 'kWh/tick' },
            }
          : {
              ...common,
              producerId: data!.draft!.document.buildings[0]!.id,
              kind: 'planned',
              inputs: [],
              outputs: [],
              drone: null,
              duration: 1,
              electricity: { quantity: 0, unit: 'kWh/tick' },
              external: 'planned',
              workers: 0,
              equipment: [],
            };
    edit(value, true);
  }
  async function upload(
    file: File | undefined,
    slot: string,
    field: ArtworkField,
  ) {
    const limits = data?.artworkLimits;
    if (!file || !limits || !entry || busy || uploadRequest.current) return;
    const controller = new AbortController();
    uploadRequest.current = controller;
    setUploading(field);
    setMessage('');
    try {
      const { inputBytes } = limits;
      if (file.size > inputBytes)
        throw new Error(
          `File too large. The input limit is ${displayBytes(inputBytes)}.`,
        );

      const buffer = new Uint8Array(await file.arrayBuffer());
      controller.signal.throwIfAborted();
      let binary = '';
      for (let offset = 0; offset < buffer.length; offset += 8192)
        binary += String.fromCharCode(
          ...buffer.subarray(offset, offset + 8192),
        );
      const { signal } = controller;
      const previous = artworkFeedback[field];
      const activeSession =
        previous && 'error' in previous && previous.reauthenticate
          ? await request<Session>('session', undefined, { signal })
          : session;
      const result = await request<ArtworkUpload>(
        'assets',
        { slot, data: btoa(binary) },
        { signal, csrfToken: activeSession?.csrfToken },
      );
      if (uploadRequest.current !== controller || signal.aborted) return;
      if (activeSession !== session) setSession(activeSession);
      if (
        field === 'sprite' &&
        'sprite' in entry &&
        entry.sprite.startsWith('placeholder:') &&
        !entry.spriteAlignment
      )
        change({ sprite: result.id, spriteAlignment: 'footprint-front' });
      else change({ [field]: result.id });
      setArtworkFeedback((feedback) => ({ ...feedback, [field]: { result } }));
    } catch (error) {
      if (uploadRequest.current !== controller || controller.signal.aborted)
        return;
      const reauthenticate =
        error instanceof AdminRequestError &&
        (error.status === 401 ||
          (error.status === 403 && error.message.includes('CSRF')));
      const reason = reauthenticate
        ? 'Your administrator session has expired or changed.'
        : error instanceof TypeError
          ? 'The upload could not reach the admin service. Check your connection and retry.'
          : error instanceof Error
            ? error.message
            : 'Please try again.';
      setArtworkFeedback((feedback) => ({
        ...feedback,
        [field]: { error: reason, reauthenticate },
      }));
    } finally {
      if (uploadRequest.current === controller) {
        uploadRequest.current = null;
        setUploading(null);
      }
    }
  }
  function asset(
    label: string,
    field: ArtworkField,
    reference: string,
    slot: string,
  ) {
    const artKind = slot === 'resource-icon' ? 'resource' : 'building';
    const limits = data?.artworkLimits;
    const feedback = artworkFeedback[field];
    const helpId = `artwork-${slot}-limits`;
    const feedbackId = `artwork-${slot}-feedback`;
    const uploadError = feedback && 'error' in feedback ? feedback : undefined;
    return (
      <fieldset>
        <legend>{label}</legend>
        <CatalogueArt
          key={reference}
          reference={reference}
          kind={artKind}
          admin
          alt={`${label} preview`}
          className="admin-art"
        />
        <Field label={`Upload ${label.toLowerCase()}`}>
          <input
            type="file"
            accept="image/png,image/webp"
            disabled={busy || !limits}
            aria-describedby={`${helpId} ${feedbackId}`}
            aria-invalid={!!uploadError && uploading !== field}
            onChange={(e) => {
              const file = e.currentTarget.files?.[0];
              e.currentTarget.value = '';
              void upload(file, slot, field);
            }}
          />
        </Field>
        <div id={feedbackId}>
          {uploading === field ? (
            <p role="status">Uploading…</p>
          ) : uploadError ? (
            <p role="alert" className="admin-error">
              Artwork upload failed. {uploadError.error}
              {uploadError.reauthenticate && (
                <>
                  {' '}
                  <a href="/admin" target="_blank" rel="noreferrer">
                    Sign in again in a new tab
                  </a>
                  , then retry here.
                </>
              )}
            </p>
          ) : feedback &&
            'result' in feedback &&
            feedback.result.id === reference ? (
            <p role="status" className="admin-success">
              Uploaded — save this draft to attach the image (
              {feedback.result.width}×{feedback.result.height}).
            </p>
          ) : null}
        </div>
        <button
          type="button"
          disabled={busy}
          onClick={() => {
            change({ [field]: `placeholder:${artKind}` });
            setArtworkFeedback((current) => ({
              ...current,
              [field]: undefined,
            }));
          }}
        >
          Reset {label.toLowerCase()} to placeholder
        </button>
        <small id={helpId}>
          {limits ? (
            <>
              Still PNG or WebP. Input up to {displayBytes(limits.inputBytes)},{' '}
              {limits.minSide}–{limits.maxSide} px per side, and{' '}
              {limits.maxPixels.toLocaleString()} pixels total.
              {field === 'icon'
                ? ` Larger icons shrink to fit ${limits.iconSide}×${limits.iconSide} px.`
                : ' Sprites keep their original dimensions.'}{' '}
              Processed PNG limit{' '}
              {displayBytes(
                field === 'sprite'
                  ? (limits.spriteOutputBytes ?? limits.outputBytes)
                  : limits.outputBytes,
              )}
              . Publishing makes the saved artwork public.
            </>
          ) : (
            'Artwork limits are unavailable. Refresh after the API is updated.'
          )}
        </small>
      </fieldset>
    );
  }
  function electricity(value: BuildingEntry['electricity'], label: string) {
    return (
      <fieldset>
        <legend>{label}</legend>
        <Num
          label={`${label} quantity`}
          value={value.quantity}
          onChange={(quantity) =>
            change({ electricity: { ...value, quantity } })
          }
        />
        <Select
          label={`${label} unit`}
          value={value.unit}
          choices={['kWh/tick', 'kW', 'MW']}
          onChange={(unit) => change({ electricity: { ...value, unit } })}
        />
        <small>
          A simulation tick is one second; kW ÷ 3600 = kWh/tick. MW is a rate,
          never stored stock.
        </small>
      </fieldset>
    );
  }
  function form() {
    if (!entry || !data?.draft) return null;
    const resources = data.draft.document.resources;
    const layout = 'sprite' in entry ? buildingLayoutRules(entry) : undefined;
    return (
      <form
        className="admin-editor"
        onSubmit={(e) => {
          e.preventDefault();
          if (busy || uploadRequest.current) return;
          void action(async () => {
            const draft = await request<Draft>('entries', {
              revision: data.draft!.revision,
              kind,
              create: creating,
              entry,
            });
            setData({ ...data, draft });
            setEntry(draft.document[kind].find((v) => v.id === entry.id)!);
            setCreating(false);
            setArtworkFeedback({});
            setDirty(false);
            await refresh();
            setMessage(
              'Draft saved. Validate and publish to make its artwork public.',
            );
          });
        }}
      >
        <div className="admin-toolbar">
          <h2>
            {creating ? 'Create' : 'Edit'} {entry.name}
          </h2>
          <button
            type="button"
            onClick={() => {
              if (discard()) {
                setEntry(null);
                setArtworkFeedback({});
                setDirty(false);
              }
            }}
          >
            Close editor
          </button>
        </div>
        <p>
          Revision {entry.revision} · {entry.support}.{' '}
          {dirty ? 'Unsaved changes' : ''}
        </p>
        <div className="admin-fields">
          <Text
            label="Permanent ID"
            value={entry.id}
            disabled={!creating}
            onChange={(id) => change({ id })}
          />
          <Text
            label="Name"
            value={entry.name}
            onChange={(name) => change({ name })}
          />
          <Field label="Description">
            <textarea
              value={entry.description}
              maxLength={2000}
              onChange={(e) => change({ description: e.target.value })}
            />
          </Field>
          <Select
            label="Status"
            value={entry.status}
            choices={['active', 'archived']}
            onChange={(status) => change({ status })}
          />
          <Select
            label="Simulation support"
            value={entry.support}
            choices={['implemented', 'planned']}
            onChange={(support) => change({ support })}
          />
        </div>
        {'baseValue' in entry && (
          <>
            <div className="admin-fields">
              <Select
                label="Resource category"
                value={entry.category}
                choices={[
                  'raw-mineral',
                  'refined-solid',
                  'liquid',
                  'gas',
                  'energy',
                  'manufactured',
                ]}
                onChange={(category) => change({ category })}
              />
              <Num
                label="Value (credits per unit)"
                value={entry.baseValue}
                onChange={(baseValue) => change({ baseValue })}
              />
              <Select
                label="Measurement unit"
                value={entry.unit}
                choices={['kg', 'L', 'items', 'kWh', 'kW', 'MW']}
                onChange={(unit) => change({ unit })}
              />
            </div>
            <p>
              Existing gameplay units are fixed. Converting saved quantities
              requires a separate tested migration. New resources remain planned
              and archived until simulation support exists. Base price is
              catalogue metadata; trading is pending.
            </p>
            {asset('Resource icon', 'icon', entry.icon, 'resource-icon')}
          </>
        )}
        {'sprite' in entry && (
          <>
            <div className="admin-fields">
              <Text
                label="Building category"
                value={entry.category}
                onChange={(category) => change({ category })}
              />
              <Num
                label="Footprint width"
                value={entry.width}
                min={1}
                max={entry.id === 'battery' ? maxBatteryFootprint : 8}
                step="1"
                disabled={layout?.footprintEditable === false}
                onChange={(width) => change({ width })}
              />
              <Num
                label="Footprint height"
                value={entry.height}
                min={1}
                max={entry.id === 'battery' ? maxBatteryFootprint : 8}
                step="1"
                disabled={layout?.footprintEditable === false}
                onChange={(height) => change({ height })}
              />
              <Num
                label="Credit cost"
                value={entry.creditCost}
                onChange={(creditCost) => change({ creditCost })}
              />
              <Num
                label="Required workers"
                value={entry.workers}
                max={1000}
                step="1"
                onChange={(workers) => change({ workers })}
              />
            </div>
            <Quantities
              label="Construction costs"
              value={entry.cost}
              resources={resources}
              onChange={(cost) => change({ cost })}
            />
            {electricity(entry.electricity, 'Building operating demand')}
            <p>
              {layout?.footprintEditable
                ? `Battery footprints can be 1–${maxBatteryFootprint} tiles wide and high. New colonies use the published dimensions. Existing saves keep their pinned size.`
                : layout
                  ? 'This building has a fixed gameplay footprint. Use Sprite alignment and Sprite scale to fit the artwork to its tiles.'
                  : 'Planned building geometry can be recorded in the draft.'}
            </p>
            <fieldset>
              <legend>Utility capabilities</legend>
              {(['water', 'oxygen', 'power'] as const).map((t) => (
                <label key={t}>
                  <input
                    type="checkbox"
                    checked={entry.utilities.includes(t)}
                    disabled={!!layout}
                    onChange={(e) =>
                      change({
                        utilities: e.target.checked
                          ? [...entry.utilities, t]
                          : entry.utilities.filter((v) => v !== t),
                      })
                    }
                  />
                  {t}
                </label>
              ))}
            </fieldset>
            {layout && Object.keys(layout.changes).length > 0 && (
              <p>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => change(layout.changes)}
                >
                  Restore supported layout for this building
                </button>{' '}
                Save the draft to apply the repair. Artwork and other fields
                stay in your edit.
              </p>
            )}
            <fieldset>
              <legend>Storage capacities</legend>
              {entry.storage.map((s, i) => (
                <div className="admin-quantity" key={i}>
                  <Field label={`Storage resource ${i + 1}`}>
                    <select
                      value={s.resourceId}
                      onChange={(e) =>
                        change({
                          storage: entry.storage.map((v, n) =>
                            n === i ? { ...v, resourceId: e.target.value } : v,
                          ),
                        })
                      }
                    >
                      {resources.map((r) => (
                        <option key={r.id} value={r.id}>
                          {r.name} ({r.unit})
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Num
                    label={`Storage capacity ${i + 1}`}
                    value={s.capacity}
                    onChange={(capacity) =>
                      change({
                        storage: entry.storage.map((v, n) =>
                          n === i ? { ...v, capacity } : v,
                        ),
                      })
                    }
                  />
                  <Select
                    label={`Storage scope ${i + 1}`}
                    value={s.scope}
                    choices={['shared', 'utility']}
                    onChange={(scope) =>
                      change({
                        storage: entry.storage.map((v, n) =>
                          n === i ? { ...v, scope } : v,
                        ),
                      })
                    }
                  />
                  <button
                    type="button"
                    onClick={() =>
                      change({
                        storage: entry.storage.filter((_, n) => n !== i),
                      })
                    }
                  >
                    Remove
                  </button>
                </div>
              ))}
              <button
                type="button"
                onClick={() =>
                  change({
                    storage: [
                      ...entry.storage,
                      { resourceId: 'metal', capacity: 0, scope: 'shared' },
                    ],
                  })
                }
              >
                Add storage
              </button>
            </fieldset>
            <p>
              Compatible recipes:{' '}
              {data.draft.document.recipes
                .filter((r) => r.producerId === entry.id)
                .map((r) => `${r.name} (${r.status})`)
                .join(', ') || 'None'}
              . Use the Recipes table to edit them.
            </p>
            <div className="admin-artwork">
              {asset('Building icon', 'icon', entry.icon, 'building-icon')}
              {asset(
                'Isometric sprite',
                'sprite',
                entry.sprite,
                'building-sprite',
              )}
              <fieldset>
                <legend>Sprite alignment preview</legend>
                <SpritePreview key={entry.sprite} entry={entry} />
                <Field label="Sprite alignment">
                  <select
                    value={entry.spriteAlignment ?? 'footprint-front'}
                    onChange={(event) =>
                      change({ spriteAlignment: event.target.value })
                    }
                  >
                    <option value="footprint-front">Footprint front</option>
                    <option value="tile-center">First tile (legacy)</option>
                  </select>
                </Field>
                <small>
                  Match the sprite's front ground corner to the dot. Start with
                  Anchor X 0.5 and Y 1. Lower Anchor Y if there is transparent
                  space below the sprite. Adjust scale to fit the tile grid.
                  This preview uses the new-colony proportions.
                </small>
                <Num
                  label="Sprite scale"
                  value={entry.scale}
                  min={0.1}
                  max={4}
                  onChange={(scale) => change({ scale })}
                />
                <Num
                  label="Anchor X"
                  value={entry.anchor.x}
                  max={1}
                  onChange={(x) => change({ anchor: { ...entry.anchor, x } })}
                />
                <Num
                  label="Anchor Y"
                  value={entry.anchor.y}
                  max={1}
                  onChange={(y) => change({ anchor: { ...entry.anchor, y } })}
                />
              </fieldset>
            </div>
          </>
        )}
        {'producerId' in entry && (
          <>
            <div className="admin-fields">
              <Field label="Producer building">
                <select
                  value={entry.producerId}
                  onChange={(e) => change({ producerId: e.target.value })}
                >
                  {data.draft.document.buildings.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name}
                    </option>
                  ))}
                </select>
              </Field>
              <Select
                label="Recipe mechanic"
                value={entry.kind}
                choices={['continuous', 'drone', 'planned']}
                onChange={(kind) => change({ kind })}
              />
              <Select
                label="Drone output"
                value={entry.drone ?? 'none'}
                choices={['none', 'survey', 'extractor']}
                onChange={(drone) =>
                  change({ drone: drone === 'none' ? null : drone })
                }
              />
              <Num
                label="Duration (simulation ticks)"
                value={entry.duration}
                min={1}
                max={100000}
                step="1"
                onChange={(duration) => change({ duration })}
              />
              <Num
                label="Assembly workers"
                value={entry.workers}
                max={1000}
                step="1"
                onChange={(workers) => change({ workers })}
              />
              <Select
                label="External source"
                value={entry.external}
                choices={['none', 'sunlight', 'planned']}
                onChange={(external) => change({ external })}
              />
            </div>
            <Quantities
              label="Inputs"
              value={entry.inputs}
              resources={resources}
              onChange={(inputs) => change({ inputs })}
            />
            <Quantities
              label="Outputs"
              value={entry.outputs}
              resources={resources}
              onChange={(outputs) => change({ outputs })}
            />
            {electricity(entry.electricity, 'Additional recipe demand')}
            <p className="admin-summary">
              Consumes{' '}
              {entry.inputs
                .map(
                  (q) =>
                    `${q.quantity} ${resources.find((r) => r.id === q.resourceId)?.unit} ${resources.find((r) => r.id === q.resourceId)?.name}`,
                )
                .join(', ') || 'no stored input'}{' '}
              over {entry.duration} simulation ticks; produces{' '}
              {entry.drone
                ? `1 ${entry.drone} drone`
                : entry.outputs
                    .map(
                      (q) =>
                        `${q.quantity} ${resources.find((r) => r.id === q.resourceId)?.unit} ${resources.find((r) => r.id === q.resourceId)?.name}`,
                    )
                    .join(', ') || 'no output'}
              . External source: {entry.external}.
            </p>
            <p>
              Building demand is charged separately. Continuous recipes must
              have zero additional demand and a one-tick duration. Drone
              assembly adds recipe power per active tick, reserves materials
              once, requires road access and power, and uses the existing queue
              limit of 5 and station fleet limit of 8. Equipment is unsupported;
              deployment waits for an available station exit.
            </p>
          </>
        )}
        <button
          className="primary"
          disabled={busy || (!dirty && !creating)}
          type="submit"
        >
          Save draft
        </button>
        <small>
          Publication validation runs separately. Invalid planned mechanics
          cannot become active gameplay.
        </small>
      </form>
    );
  }
  if (boot)
    return (
      <main className="admin-login">
        <p role="status">Checking administrator session…</p>
      </main>
    );
  if (!session)
    return (
      <main className="admin-login">
        <h1>MARS / Administration</h1>
        <p>Authorised administrators only.</p>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const fields = new FormData(e.currentTarget);
            void action(async () =>
              setSession(
                await request<Session>('login', {
                  email: fields.get('email'),
                  password: fields.get('password'),
                }),
              ),
            );
          }}
        >
          <Field label="Email">
            <input name="email" type="email" autoComplete="username" required />
          </Field>
          <Field label="Password">
            <input
              name="password"
              type="password"
              autoComplete="current-password"
              required
              maxLength={128}
            />
          </Field>
          <button className="primary" disabled={busy}>
            Sign in
          </button>
        </form>
        {error && <p role="alert">{error}</p>}
        <a href="/">Return to colony</a>
      </main>
    );
  const draft = data?.draft;
  const layoutsToRepair =
    draft?.document.buildings.filter((entry) => {
      const rules = buildingLayoutRules(entry);
      return rules && Object.keys(rules.changes).length;
    }) ?? [];
  const rows = draft
    ? draft.document[kind]
        .filter((e) =>
          `${e.id} ${e.name} ${e.description}`
            .toLowerCase()
            .includes(query.toLowerCase()),
        )
        .slice()
        .sort((a, b) => {
          const av = String(
              (a as unknown as Record<string, unknown>)[sort] ?? '',
            ),
            bv = String((b as unknown as Record<string, unknown>)[sort] ?? '');
          return (
            av.localeCompare(bv, undefined, { numeric: true }) *
            (descending ? -1 : 1)
          );
        })
    : [];
  return (
    <main className="admin-shell">
      <aside className="admin-sidebar">
        <h1>
          MARS <small>CATALOGUE CONTROL / V0.4</small>
        </h1>
        <nav>
          {pages.map((p) => (
            <button
              key={p}
              disabled={busy}
              aria-current={page === p ? 'page' : undefined}
              onClick={() => navigate(p)}
            >
              {p}
            </button>
          ))}
        </nav>
        <p>{session.email}</p>
        <a href="/">Return to colony</a>
      </aside>
      <section className="admin-main" aria-busy={working}>
        <header className="admin-toolbar">
          <h1>{page}</h1>
          <span>
            {busy
              ? 'Working…'
              : `Published: ${data?.current ? `v${data.current.id}` : 'built-in'} · Draft revision ${draft?.revision ?? 'none'}`}
          </span>
        </header>
        {error && (
          <p role="alert" className="admin-error">
            {error}
          </p>
        )}
        {message && (
          <p role="status" className="admin-success">
            {message}
          </p>
        )}
        {!data && (
          <button onClick={() => void action(refresh)}>
            Retry loading catalogue
          </button>
        )}
        {page === 'Overview' && (
          <>
            <p>
              Draft edits are private. Validate, inspect the difference preview
              and publish one immutable version. Existing saves keep their
              embedded catalogue.
            </p>
            {data && !draft ? (
              <button
                disabled={busy}
                onClick={() =>
                  void action(async () => {
                    await request('seed', {});
                    await refresh();
                    setMessage(
                      'Initial draft seeded from implemented game definitions.',
                    );
                  })
                }
              >
                Initialise draft from game
              </button>
            ) : (
              <div className="admin-cards">
                {(['resources', 'buildings', 'recipes'] as const).map((k) => (
                  <article key={k}>
                    <strong>{draft?.document[k].length ?? 0}</strong>
                    <p>{k}</p>
                  </article>
                ))}
              </div>
            )}
            <p>
              New mechanics must remain planned and archived. Base prices are
              metadata; trade, refining, cargo logistics and custom building
              behavior remain future work. The fixed-tick simulation supports
              existing continuous life support, solar generation and drone
              assembly recipes.
            </p>
            <p>
              Save uploaded artwork to a draft, then validate and publish it.
              Back up PostgreSQL and the API artwork volume when configured.
              Existing colonies keep the artwork references from their own
              catalogue.
            </p>
          </>
        )}
        {(page === 'Minerals & Resources' || page === 'Industry Buildings') &&
          draft && (
            <>
              <div className="admin-toolbar">
                {page === 'Industry Buildings' ? (
                  <>
                    <button
                      disabled={busy}
                      aria-pressed={kind === 'buildings'}
                      onClick={() => {
                        if (discard()) {
                          setKind('buildings');
                          setEntry(null);
                          setDirty(false);
                        }
                      }}
                    >
                      Buildings
                    </button>
                    <button
                      disabled={busy}
                      aria-pressed={kind === 'recipes'}
                      onClick={() => {
                        if (discard()) {
                          setKind('recipes');
                          setEntry(null);
                          setDirty(false);
                        }
                      }}
                    >
                      Recipes
                    </button>
                  </>
                ) : kind !== 'resources' ? (
                  <button
                    onClick={() => {
                      if (discard()) {
                        setKind('resources');
                        setEntry(null);
                        setDirty(false);
                      }
                    }}
                  >
                    Show resources
                  </button>
                ) : null}
                <Text
                  label="Search catalogue"
                  value={query}
                  onChange={setQuery}
                />
                <Select
                  label="Sort by"
                  value={sort}
                  choices={
                    kind === 'resources'
                      ? [
                          'name',
                          'description',
                          'baseValue',
                          'unit',
                          'id',
                          'status',
                        ]
                      : ['name', 'id', 'status', 'support']
                  }
                  onChange={setSort}
                />
                <button onClick={() => setDescending(!descending)}>
                  {descending ? 'Descending' : 'Ascending'}
                </button>
                <button disabled={busy} onClick={add}>
                  Create{' '}
                  {kind === 'resources'
                    ? 'resource'
                    : kind === 'recipes'
                      ? 'recipe'
                      : 'building'}
                </button>
                <button
                  disabled={busy}
                  onClick={() => {
                    if (discard()) {
                      setEntry(null);
                      setDirty(false);
                      void action(refresh);
                    }
                  }}
                >
                  Reload draft
                </button>
              </div>
              <div className="admin-table-wrap">
                <table>
                  <thead>
                    <tr>
                      {kind === 'resources' ? (
                        <>
                          <th>Icon</th>
                          <th>Name</th>
                          <th>Description</th>
                          <th>Value</th>
                          <th>Measurement Unit</th>
                        </>
                      ) : (
                        <>
                          <th>Name</th>
                          <th>Description</th>
                          <th>Permanent ID</th>
                          <th>Support</th>
                          <th>Status</th>
                        </>
                      )}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row) => (
                      <tr key={row.id}>
                        {'baseValue' in row ? (
                          <>
                            <td>
                              <CatalogueArt
                                reference={row.icon}
                                kind="resource"
                                admin
                                alt={`${row.name} icon`}
                                width={40}
                              />
                            </td>
                            <td>
                              <button disabled={busy} onClick={() => edit(row)}>
                                {row.name}
                              </button>
                              <small>
                                {row.id} · r{row.revision} · {row.status} ·{' '}
                                {row.support}
                              </small>
                            </td>
                            <td>{row.description}</td>
                            <td>
                              {row.baseValue} credits/{row.unit}
                            </td>
                            <td>{row.unit}</td>
                          </>
                        ) : (
                          <>
                            <td>
                              <button disabled={busy} onClick={() => edit(row)}>
                                {row.name}
                              </button>
                            </td>
                            <td>{row.description}</td>
                            <td>{row.id}</td>
                            <td>{row.support}</td>
                            <td>{row.status}</td>
                          </>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
                {!rows.length && <p>No matching definitions.</p>}
              </div>
              {form()}
            </>
          )}
        {(page === 'Minerals & Resources' || page === 'Industry Buildings') &&
          !draft && <p>Initialise the draft in Overview first.</p>}
        {page === 'Drafts & Publishing' && draft && (
          <>
            <button
              disabled={busy}
              onClick={() =>
                void action(async () => {
                  const result = await request<{
                    revision: number;
                    errors: string[];
                  }>('validate', {});
                  await refresh();
                  if (result.errors.length) {
                    setError(result.errors.join('\n'));
                    return;
                  }
                  setValidated(result.revision);
                  setMessage(
                    `Revision ${result.revision} validated. Review the differences below before publishing.`,
                  );
                })
              }
            >
              Validate and preview changes
            </button>
            <button
              className="primary"
              disabled={busy || validated !== draft.revision}
              onClick={() =>
                void action(async () => {
                  await request('publish', { revision: draft.revision });
                  await refresh();
                  setMessage(
                    'Catalogue published atomically. New colonies can select this version.',
                  );
                })
              }
            >
              Publish validated revision
            </button>
            <h2>Validation</h2>
            {layoutsToRepair.length > 0 && (
              <section aria-label="Unsupported building layouts">
                <p>
                  Restore supported footprints and utility channels for{' '}
                  {layoutsToRepair.length}{' '}
                  {layoutsToRepair.length === 1 ? 'building' : 'buildings'}.
                  Artwork, sprite alignment, and other draft edits stay in
                  place.
                </p>
                <button
                  disabled={busy}
                  onClick={() =>
                    void action(async () => {
                      const { repaired } = await request<{ repaired: number }>(
                        'restore-building-layouts',
                        { revision: draft.revision },
                      );
                      await refresh();
                      setMessage(
                        `Restored supported layouts for ${repaired} ${repaired === 1 ? 'building' : 'buildings'}. Validate the draft before publishing.`,
                      );
                    })
                  }
                >
                  Restore supported building layouts
                </button>
              </section>
            )}
            {data.errors.length ? (
              <ul>
                {data.errors.map((e, i) => (
                  <li key={i}>{e}</li>
                ))}
              </ul>
            ) : (
              <p>No publication errors in the loaded draft.</p>
            )}
            <h2>Changes from current publication</h2>
            {data.diff.length ? (
              data.diff.map((d) => (
                <details key={`${d.kind}-${d.id}`}>
                  <summary>
                    {d.kind} / {d.id}
                  </summary>
                  <div className="admin-diff">
                    <div>
                      Before<pre>{JSON.stringify(d.before, null, 2)}</pre>
                    </div>
                    <div>
                      Draft<pre>{JSON.stringify(d.after, null, 2)}</pre>
                    </div>
                  </div>
                </details>
              ))
            ) : (
              <p>No changes from the current catalogue.</p>
            )}
            <h2>Publication history</h2>
            {data.history.length ? (
              data.history.map((v) => (
                <p key={v.id}>
                  v{v.id} · {new Date(v.createdAt).toLocaleString()} ·{' '}
                  <code>{v.digest.slice(0, 16)}</code>
                </p>
              ))
            ) : (
              <p>
                No admin publications yet. Original definitions remain
                available.
              </p>
            )}
          </>
        )}
        {page === 'Audit History' && (
          <>
            {audit.length ? (
              audit.map((a) => (
                <details key={a.id}>
                  <summary>
                    {new Date(a.createdAt).toLocaleString()} · {a.action} ·{' '}
                    {a.actorId}
                  </summary>
                  <pre>{JSON.stringify(a.detail, null, 2)}</pre>
                </details>
              ))
            ) : (
              <p>No audit records loaded.</p>
            )}
          </>
        )}
        {page === 'Admin Account' && (
          <>
            <p>
              Session expires {new Date(session.expiresAt).toLocaleString()}.
            </p>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const f = new FormData(e.currentTarget);
                void action(async () => {
                  await request('password', {
                    current: f.get('current'),
                    password: f.get('password'),
                  });
                  setSession(null);
                  setMessage('Password changed. Sign in again.');
                });
              }}
            >
              <Field label="Current password">
                <input
                  name="current"
                  type="password"
                  required
                  autoComplete="current-password"
                />
              </Field>
              <Field label="New password (12–128 characters)">
                <input
                  name="password"
                  type="password"
                  required
                  minLength={12}
                  maxLength={128}
                  autoComplete="new-password"
                />
              </Field>
              <button disabled={busy}>
                Change password and revoke sessions
              </button>
            </form>
            <button
              disabled={busy}
              onClick={() => {
                if (discard())
                  void action(async () => {
                    await request('logout', {});
                    setSession(null);
                    setData(null);
                    setDirty(false);
                  });
              }}
            >
              Sign out
            </button>
          </>
        )}
      </section>
    </main>
  );
}
