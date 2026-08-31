// The React shell. PRD §13 "React responsibilities": React owns application UI and
// lower-frequency game state panels. It must NOT reconcile Three.js entities as JSX state
// every simulation tick — the scene is mounted once into a plain div and driven by
// GameClient, and React only re-renders on the low-frequency status callback.

import { useEffect, useRef, useState } from 'react';
import { GameClient, type GameClientStatus } from '../game/GameClient';
import { HudPanel } from '../ui/HudPanel';
import { SetupScreen } from '../ui/SetupScreen';

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
      {/*
        PRD §18's setup screen is a full-bleed overlay, mounted only during `setup`. It is
        React UI over a live Three.js canvas — it never reconciles a scene entity, which is
        what PRD §13 and Milestone 0 Decision 5 ask for.
      */}
      {status?.matchPhase === 'setup' ? (
        <SetupScreen
          status={status}
          onSubmit={(payload) => clientRef.current?.submitSetup(payload)}
        />
      ) : null}
      <div className="scope-note">
        <strong>Match lifecycle</strong> — the PRD §5 phase clock runs on the server; both
        owners ready up to leave the lobby, then build a menu during setup. Customers, orders,
        events, money and scoring each land in a later story.
      </div>
      <div className="help">
        <kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> move · <kbd>Shift</kbd> sprint ·{' '}
        <kbd>E</kbd> interact · <kbd>F</kbd> put down · <kbd>Tab</kbd> overview
      </div>
      {/* PRD §8 "contextual prompt": InteractionController resolved a target within range and
          this is it, verbatim — nothing here decides whether pressing E will succeed. */}
      {status?.prompt ? (
        <div className="interact-prompt">
          <kbd>E</kbd>
          {status.prompt.label}
        </div>
      ) : null}
      {status && (status.carrying.length > 0 || status.currentAction) ? (
        <div className="carry-status">
          {status.currentAction ? `${status.currentAction}…` : null}
          {status.currentAction && status.carrying.length > 0 ? ' · ' : null}
          {status.carrying.length > 0 ? `carrying ${status.carrying.length}` : null}
        </div>
      ) : null}
    </div>
  );
}
