import { useCallback, useEffect, useState } from 'react';
import { Bounds, OrbitControls, useBounds } from '@react-three/drei';
import { Canvas } from '@react-three/fiber';
import type { BuildingEntry, ModelState } from '@mars/simulation';
import { buildingTypeSchema } from '@mars/simulation';
import { Block, ProceduralBuilding } from './world3d/Buildings';
import { ModelBoundary, UploadedModel } from './world3d/UploadedModel';

function Fit({ revision }: { revision: number }) {
  const bounds = useBounds();
  useEffect(() => {
    bounds.refresh().clip().fit();
  }, [bounds, revision]);
  return null;
}

function ReportFailure({ report }: { report: () => void }) {
  useEffect(report, [report]);
  return null;
}

export default function BuildingModelPreview({
  entry,
  state,
  playing,
  reset,
}: {
  entry: BuildingEntry;
  state: ModelState;
  playing: boolean;
  reset: number;
}) {
  const [size, setSize] = useState<[number, number, number] | null>(null);
  const [failed, setFailed] = useState(false);
  const [unavailable, setUnavailable] = useState(false);
  const [frame, setFrame] = useState(0);
  const [fitted, setFitted] = useState(false);
  const onSize = useCallback((dimensions: [number, number, number]) => {
    setSize(dimensions);
    setFailed(false);
  }, []);
  const report = useCallback(() => {
    setSize(null);
    setFailed(true);
  }, []);
  useEffect(() => {
    if (size && !fitted) {
      setFitted(true);
      setFrame((value) => value + 1);
    }
  }, [size, fitted]);
  const type = buildingTypeSchema.safeParse(entry.id);
  const fallback = type.success ? (
    <ProceduralBuilding
      type={type.data}
      width={entry.width}
      depth={entry.height}
    />
  ) : (
    <Block
      at={[0, 0.2, 0]}
      size={[entry.width, 0.4, entry.height]}
      color="#a8a59a"
    />
  );
  return (
    <div>
      <div className="admin-model-canvas">
        <ModelBoundary
          onFailure={() => setUnavailable(true)}
          fallback={<p role="alert">Interactive preview requires WebGL 2.</p>}
        >
          <Canvas
            dpr={[1, 1.5]}
            camera={{ position: [3.6, 2.6, 4.4], fov: 44 }}
            onCreated={({ gl }) =>
              gl.domElement.setAttribute(
                'aria-label',
                'Interactive building model preview',
              )
            }
          >
            <color attach="background" args={['#14242d']} />
            <hemisphereLight args={['#e9f1ff', '#4b4138', 1.65]} />
            <directionalLight position={[4, 7, 2]} intensity={2.5} />
            <OrbitControls makeDefault enableDamping />
            <gridHelper
              args={[16, 16, '#607c82', '#344952']}
              position={[0, -0.085, 0]}
            />
            <Bounds margin={1.6}>
              <Block
                at={[0, -0.044, 0]}
                size={[entry.width, 0.08, entry.height]}
                color="#525d5b"
              />
              {entry.model ? (
                <UploadedModel
                  model={entry.model}
                  admin
                  state={state}
                  playing={playing}
                  reset={reset}
                  onSize={onSize}
                  loading={fallback}
                  fallback={
                    <>
                      {fallback}
                      <ReportFailure report={report} />
                    </>
                  }
                />
              ) : (
                fallback
              )}
              <Fit revision={frame} />
            </Bounds>
          </Canvas>
        </ModelBoundary>
      </div>
      <div className="admin-toolbar">
        <button type="button" onClick={() => setFrame((value) => value + 1)}>
          Frame model
        </button>
        {size && (
          <output aria-label="Model dimensions">
            X × Y × Z {size.map((value) => value.toFixed(2)).join(' × ')} tiles
          </output>
        )}
        {entry.model && !size && !failed && !unavailable && (
          <span role="status">Loading GLB preview…</span>
        )}
      </div>
      {failed && (
        <p role="alert">
          This GLB could not be rendered. The default building is shown.
        </p>
      )}
    </div>
  );
}
