import { useCallback, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  advance,
  colonySchema,
  resourceDefinitions,
  type ClockState,
} from '@mars/simulation';
import { World } from './World';
import './style.css';
function App() {
  const clock = useRef<ClockState | null>(null);
  const [colony, setColony] = useState<ClockState['colony'] | null>(null);
  const [tile, setTile] = useState<{ x: number; y: number } | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const select = useCallback(
    (value: { x: number; y: number }) => setTile(value),
    [],
  );
  useEffect(() => {
    let last = performance.now();
    const timer = window.setInterval(() => {
      const now = performance.now();
      const elapsed = now - last;
      last = now;
      if (clock.current) {
        clock.current = advance(clock.current, elapsed);
        setColony(clock.current.colony);
      }
    }, 100);
    return () => window.clearInterval(timer);
  }, []);
  async function start() {
    setBusy(true);
    setError('');
    try {
      const response = await fetch('/api/new-game', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ seed: 1 }),
      });
      if (!response.ok)
        throw new Error('API unavailable. Start the backend and retry.');
      const body: unknown = await response.json();
      const state = colonySchema.parse((body as { colony?: unknown }).colony);
      clock.current = { colony: state, remainderMs: 0 };
      setColony(state);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : 'Could not create colony',
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="flex h-dvh flex-col bg-stone-950 text-stone-100">
      <header className="flex flex-wrap items-center justify-between gap-4 border-b border-orange-900 p-5">
        <div>
          <p className="text-xs tracking-[.4em] text-orange-300">
            MISSION CONTROL / STAGE 01
          </p>
          <h1 className="text-2xl font-bold tracking-widest">
            MARS: FIRST COLONY
          </h1>
        </div>
        <button
          disabled={busy}
          onClick={() => void start()}
          className="rounded bg-orange-400 px-5 py-2 font-bold text-stone-950 disabled:opacity-50"
        >
          {busy ? 'Initializing…' : 'New game'}
        </button>
      </header>
      <section className="flex min-h-0 flex-1 flex-col md:flex-row">
        <div className="relative min-h-64 flex-1">
          <World onSelect={select} />
          <p className="pointer-events-none absolute bottom-4 left-4 rounded bg-black/60 p-2 text-sm">
            Drag to pan · Scroll to zoom · Click to select
          </p>
        </div>
        <aside className="w-full space-y-5 border-l border-orange-900 bg-stone-900 p-5 md:w-72">
          <h2 className="font-bold text-orange-300">
            {colony?.name ?? 'Awaiting landing'}
          </h2>
          <p data-testid="tick">Sol clock: {colony?.tick ?? 0} ticks</p>
          <p data-testid="selection">
            {tile ? `Sector ${tile.x}, ${tile.y}` : 'Select a terrain tile'}
          </p>
          {colony && (
            <dl>
              {Object.entries(resourceDefinitions).map(([key, definition]) => (
                <div key={key} className="flex justify-between py-2">
                  <dt>{definition.label}</dt>
                  <dd>
                    {colony.inventory[key as keyof typeof resourceDefinitions]}{' '}
                    {definition.unit}
                  </dd>
                </div>
              ))}
            </dl>
          )}
          <p className="text-sm text-stone-400">
            Prototype terrain and landing cargo. Production, survival,
            construction and cloud saves are not implemented. New game replaces
            the in-memory colony.
          </p>
          {error && (
            <p role="alert" className="text-red-300">
              {error}
            </p>
          )}
        </aside>
      </section>
    </main>
  );
}
createRoot(document.getElementById('root')!).render(<App />);
