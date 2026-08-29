// The React shell. PRD §13 "React responsibilities": React owns application UI and
// lower-frequency game state panels. It must NOT reconcile Three.js entities as JSX state
// every simulation tick — the scene is mounted once into a plain div and driven by
// GameClient, and React only re-renders on the low-frequency status callback.

import { useEffect, useRef, useState } from 'react';
import { GameClient, type GameClientStatus } from '../game/GameClient';
import { HudPanel } from '../ui/HudPanel';

export function App(): JSX.Element {
  const sceneRef = useRef<HTMLDivElement>(null);
  const clientRef = useRef<GameClient | null>(null);
  const [status, setStatus] = useState<GameClientStatus | null>(null);

  useEffect(() => {
    const container = sceneRef.current;
    if (!container) return undefined;

    const client = new GameClient(container);
    clientRef.current = client;
    // Status arrives on join and once per snapshot (~10 Hz), not per animation frame.
    client.onStatus = (next) => setStatus({ ...next });

    const roomId = new URLSearchParams(window.location.search).get('room') ?? undefined;
    client.start(roomId);

    return () => {
      clientRef.current = null;
      client.dispose();
    };
  }, []);

  return (
    <div className="app">
      <div className="scene" ref={sceneRef} />
      <HudPanel status={status} onReady={(ready) => clientRef.current?.setReady(ready)} />
      <div className="scope-note">
        <strong>Match lifecycle</strong> — the PRD §5 phase clock runs on the server; both
        owners ready up to leave the lobby. Customers, orders, menus, events, money and scoring
        each land in a later story.
      </div>
      <div className="help">
        <kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> move · <kbd>Shift</kbd> sprint ·{' '}
        <kbd>E</kbd> interact · <kbd>Tab</kbd> overview
      </div>
    </div>
  );
}
