import { lazy, Suspense, useEffect, useState } from 'react';
import {
  defaultBuildingModel,
  modelAnimationErrors,
  modelStates,
  type BuildingEntry,
  type BuildingModel,
  type ModelAnimation,
  type ModelMetadata,
  type ModelState,
} from '@mars/simulation';

import { Field, Num } from './admin-fields';

const Preview = lazy(() => import('./BuildingModelPreview'));
const maxBytes = 8 * 1024 * 1024;
const axisNames = ['X', 'Y', 'Z'] as const;
const displayState: Record<ModelState, string> = {
  working: 'Working',
  idle: 'Idle',
  construction: 'Construction',
  damaged: 'Damaged',
};
export type ModelUpload = { id: string; metadata: ModelMetadata };

function AnimationFields({
  model,
  state,
  metadata,
  onChange,
}: {
  model: BuildingModel;
  state: ModelState;
  metadata: ModelMetadata;
  onChange: (animation: ModelAnimation | undefined) => void;
}) {
  const animation = model.animations[state];
  return (
    <>
      <div className="admin-fields">
        <Field label="Animation method">
          <select
            aria-label="Animation method"
            value={animation?.method ?? 'none'}
            onChange={(e) => {
              const method = e.target.value;
              onChange(
                method === 'clip' && metadata.clips[0]
                  ? {
                      method,
                      clip: metadata.clips[0].index,
                      speed: 1,
                      loop: true,
                    }
                  : method === 'builtin'
                    ? {
                        method,
                        effect: 'rotate',
                        part: null,
                        axis: 'y',
                        direction: 1,
                        distance: 0.3,
                        speed: 1,
                        loop: true,
                      }
                    : undefined,
              );
            }}
          >
            <option value="none">None</option>
            <option value="clip" disabled={!metadata.clips.length}>
              Embedded GLB clip
            </option>
            <option value="builtin">Built-in motion</option>
          </select>
        </Field>
        {animation?.method === 'clip' && (
          <Field label="Animation clip">
            <select
              aria-label="Animation clip"
              value={animation.clip}
              onChange={(e) =>
                onChange({ ...animation, clip: Number(e.target.value) })
              }
            >
              {metadata.clips.map((clip) => (
                <option key={clip.index} value={clip.index}>
                  {clip.name} ({clip.index + 1})
                </option>
              ))}
            </select>
          </Field>
        )}
        {animation?.method === 'builtin' && (
          <>
            <Field label="Motion">
              <select
                aria-label="Motion"
                value={animation.effect}
                onChange={(e) => {
                  const effect = e.target.value as typeof animation.effect;
                  const axis =
                    effect === 'horizontal' && animation.axis === 'y'
                      ? 'x'
                      : animation.axis;
                  onChange({ ...animation, effect, axis });
                }}
              >
                <option value="rotate">Rotate</option>
                <option value="vertical">Oscillate vertically</option>
                <option value="horizontal">Oscillate horizontally</option>
                <option value="pulse">Pulse emissive lights</option>
              </select>
            </Field>
            <Field label="Model part">
              <select
                aria-label="Model part"
                value={animation.part ?? 'all'}
                onChange={(e) =>
                  onChange({
                    ...animation,
                    part:
                      e.target.value === 'all' ? null : Number(e.target.value),
                  })
                }
              >
                <option value="all">Entire model</option>
                {metadata.parts.map((part) => (
                  <option key={part.index} value={part.index}>
                    {part.name} ({part.index + 1})
                  </option>
                ))}
              </select>
            </Field>
            {(animation.effect === 'rotate' ||
              animation.effect === 'horizontal') && (
              <Field label="Motion axis">
                <select
                  aria-label="Motion axis"
                  value={animation.axis}
                  onChange={(e) =>
                    onChange({
                      ...animation,
                      axis: e.target.value as typeof animation.axis,
                    })
                  }
                >
                  <option value="x">X</option>
                  {animation.effect === 'rotate' && (
                    <option value="y">Y</option>
                  )}
                  <option value="z">Z</option>
                </select>
              </Field>
            )}
            {animation.effect !== 'pulse' && (
              <Field label="Direction">
                <select
                  aria-label="Direction"
                  value={animation.direction}
                  onChange={(e) =>
                    onChange({
                      ...animation,
                      direction: e.target.value === '1' ? 1 : -1,
                    })
                  }
                >
                  <option value="1">Positive</option>
                  <option value="-1">Negative</option>
                </select>
              </Field>
            )}
            {(animation.effect === 'vertical' ||
              animation.effect === 'horizontal') && (
              <Num
                label="Travel distance"
                value={animation.distance}
                min={0.01}
                max={5}
                onChange={(distance) => onChange({ ...animation, distance })}
              />
            )}
          </>
        )}
        {animation && (
          <Num
            label="Playback speed"
            value={animation.speed}
            min={0.05}
            max={8}
            onChange={(speed) => onChange({ ...animation, speed })}
          />
        )}
      </div>
      {animation && (
        <label>
          <input
            type="checkbox"
            checked={animation.loop}
            onChange={(e) => onChange({ ...animation, loop: e.target.checked })}
          />{' '}
          Loop animation
        </label>
      )}
    </>
  );
}

export function BuildingModelEditor({
  entry,
  busy,
  uploading,
  canSave,
  canPublish,
  onUpload,
  onChange,
  onPublish,
}: {
  entry: BuildingEntry;
  busy: boolean;
  uploading: boolean;
  canSave: boolean;
  canPublish: boolean;
  onUpload: (file: File) => Promise<ModelUpload>;
  onChange: (model: BuildingModel | undefined) => void;
  onPublish: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<ModelState>('working');
  const [playing, setPlaying] = useState(false);
  const [reset, setReset] = useState(0);
  const [uploadError, setUploadError] = useState('');
  const [metadataError, setMetadataError] = useState('');
  const [uploaded, setUploaded] = useState('');
  const [cached, setCached] = useState<ModelUpload | null>(null);
  const model = entry.model;
  const id = model?.asset;
  const metadata = cached?.id === id ? cached?.metadata : undefined;
  useEffect(() => {
    if (!open || !id || metadata) return;
    const controller = new AbortController();
    setMetadataError('');
    void fetch(`/api/admin/models/${id}`, {
      signal: controller.signal,
      cache: 'no-store',
    })
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok)
          throw new Error(data.error ?? 'Model details are unavailable.');
        if (!controller.signal.aborted)
          setCached({ id, metadata: data as ModelMetadata });
      })
      .catch((error: Error) => {
        if (!controller.signal.aborted) setMetadataError(error.message);
      });
    return () => controller.abort();
  }, [open, id, metadata]);

  async function upload(file: File) {
    setUploadError('');
    setUploaded('');
    try {
      if (file.size > maxBytes)
        throw new Error('GLB models must be 8 MiB or smaller.');
      const result = await onUpload(file);
      setCached(result);
      onChange(
        model
          ? { ...model, asset: result.id, animations: {} }
          : defaultBuildingModel(result.id),
      );
      setPlaying(false);
      setUploaded(
        'Uploaded. Preview the model and save its settings before publishing.',
      );
    } catch (error) {
      setUploadError(
        error instanceof Error ? error.message : 'Model upload failed.',
      );
    }
  }
  const errors = model && metadata ? modelAnimationErrors(model, metadata) : [];
  function transform(
    field: 'position' | 'rotation',
    index: number,
    value: number,
  ) {
    if (!model) return;
    const next = [...model[field]] as BuildingModel[typeof field];
    next[index] = value;
    onChange({ ...model, [field]: next });
  }
  return (
    <details
      className="admin-building-model"
      onToggle={(e) => setOpen(e.currentTarget.open)}
    >
      <summary>3D Model and Animations</summary>
      {open && (
        <>
          <fieldset disabled={busy}>
            <legend>3D Model</legend>
            <Field label="Upload GLB model">
              <input
                type="file"
                aria-label="Upload GLB model"
                accept=".glb,model/gltf-binary"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  e.target.value = '';
                  if (file) void upload(file);
                }}
              />
            </Field>
            <small>
              GLB up to 8 MiB with embedded textures. Uploading creates a
              private draft asset.
            </small>
            {uploading && <p role="status">Uploading and validating GLB…</p>}
            {uploadError && (
              <p className="admin-error" role="alert">
                {uploadError}
              </p>
            )}
            {uploaded && (
              <p className="admin-success" role="status">
                {uploaded}
              </p>
            )}
            <div className="admin-model-grid">
              <Suspense fallback={<p role="status">Opening 3D preview…</p>}>
                <Preview
                  key={id ?? 'default'}
                  entry={entry}
                  state={state}
                  playing={playing}
                  reset={reset}
                />
              </Suspense>
              {model && (
                <div>
                  <div className="admin-fields">
                    <Num
                      label="Model scale"
                      value={model.scale}
                      min={0.01}
                      max={20}
                      onChange={(scale) => onChange({ ...model, scale })}
                    />
                    {axisNames.map((axis, index) => (
                      <Num
                        key={axis}
                        label={`Position ${axis}`}
                        value={model.position[index]!}
                        min={-10}
                        max={10}
                        onChange={(value) =>
                          transform('position', index, value)
                        }
                      />
                    ))}
                    {axisNames.map((axis, index) => (
                      <Num
                        key={axis}
                        label={`Rotation ${axis} (degrees)`}
                        value={model.rotation[index]!}
                        min={-360}
                        max={360}
                        onChange={(value) =>
                          transform('rotation', index, value)
                        }
                      />
                    ))}
                  </div>
                  <label>
                    <input
                      type="checkbox"
                      checked={model.ground}
                      onChange={(e) =>
                        onChange({ ...model, ground: e.target.checked })
                      }
                    />{' '}
                    Ground alignment
                  </label>
                  <button
                    type="button"
                    onClick={() => {
                      onChange(undefined);
                      setUploaded('');
                      setUploadError('');
                      setPlaying(false);
                    }}
                  >
                    Reset to default model
                  </button>
                </div>
              )}
            </div>
          </fieldset>
          <fieldset disabled={busy}>
            <legend>Animations</legend>
            {metadataError && id && <p role="alert">{metadataError}</p>}
            {model && metadata ? (
              <>
                <Field label="Simulated state">
                  <select
                    aria-label="Simulated state"
                    value={state}
                    onChange={(e) => {
                      setState(e.target.value as ModelState);
                      setPlaying(false);
                    }}
                  >
                    {modelStates.map((key) => (
                      <option key={key} value={key}>
                        {displayState[key]}
                      </option>
                    ))}
                  </select>
                </Field>
                <small>
                  {metadata.clips.length
                    ? `Embedded clips: ${metadata.clips.map((clip) => clip.name).join(', ')}`
                    : 'This GLB has no embedded clips. Built-in motion is available.'}
                </small>
                <AnimationFields
                  model={model}
                  state={state}
                  metadata={metadata}
                  onChange={(animation) => {
                    onChange({
                      ...model,
                      animations: { ...model.animations, [state]: animation },
                    });
                    setReset((value) => value + 1);
                  }}
                />
                <div className="admin-toolbar">
                  <button
                    type="button"
                    disabled={!model.animations[state] || playing}
                    onClick={() => setPlaying(true)}
                  >
                    Play
                  </button>
                  <button
                    type="button"
                    disabled={!playing}
                    onClick={() => setPlaying(false)}
                  >
                    Pause
                  </button>
                  <button
                    type="button"
                    disabled={!model.animations[state]}
                    onClick={() => {
                      setPlaying(false);
                      setReset((value) => value + 1);
                    }}
                  >
                    Reset
                  </button>
                </div>
                {errors.map((error) => (
                  <p key={error} role="alert">
                    {error}
                  </p>
                ))}
              </>
            ) : (
              <small>
                {model
                  ? 'Waiting for the model details.'
                  : 'Upload a GLB to configure its animations.'}
              </small>
            )}
          </fieldset>
          <div className="admin-toolbar">
            <button
              type="submit"
              className="primary"
              disabled={busy || !canSave || !!errors.length}
            >
              Save Model Settings
            </button>
            <button
              type="button"
              disabled={busy || !canPublish}
              onClick={onPublish}
            >
              Publish
            </button>
          </div>
          <small>
            Save the building draft before publishing. Publish activates the
            entire saved catalogue draft.
          </small>
        </>
      )}
    </details>
  );
}
