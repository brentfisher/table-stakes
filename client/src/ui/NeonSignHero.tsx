// STORY-032. The left-hand "restaurant" column of the main menu: the animated "TABLE / STAKES"
// marquee plus its surrounding marketing copy and spark button — ported as one unit because the
// source design (`docs/table-stakes-neon-menu.zip`'s `start.html`) treats them as one visual
// block (the copy and spark button are positioned relative to the sign itself), and because the
// spark button needs the live `NeonRestaurantSign` instance this component already owns.
//
// `MainMenu.tsx` owns everything else on the page (header, the real menu panel on the right,
// footer) — every actual menu ACTION lives there, unchanged. This component is decorative.

import { useEffect, useRef, useState } from 'react';
import { NeonRestaurantSign } from '../scenes/NeonSign';
import { loadSettings } from '../app/settings';

/** `SettingsPanel` is a sibling modal, not a parent/child of this component, and the sign
 * instance lives outside React state entirely — a DOM event is the least-coupled way for
 * "settings changed" to reach it without threading a ref through `MainMenu` for a value only
 * these two ever touch. Same event-as-signal shape the ported prototype already used for its
 * own `table-stakes:action` events. Also used by `MainMenu`'s own "SIGN EFFECTS" quick toggle. */
export const MENU_SIGN_SETTINGS_CHANGED_EVENT = 'table-stakes:menu-sign-settings-changed';

export function NeonSignHero(): JSX.Element {
  const stageRef = useRef<HTMLDivElement | null>(null);
  const signRef = useRef<NeonRestaurantSign | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const settings = loadSettings();
    const sign = new NeonRestaurantSign(stage, {
      sparks: settings.menuSignSparks,
      bloom: settings.menuSignBloom,
      reducedMotion: settings.reducedMotion,
    });
    signRef.current = sign;
    sign.ready
      .then(() => setReady(true))
      .catch((error) => {
        // A failed font-outline fetch leaves the facade (brick backing, tubes, bulbs) rendered
        // with no lettering — the fallback heading stays visible either way since `ready` never
        // resolves, so there's nothing further to recover here beyond logging for whoever's
        // debugging the deploy.
        console.error('Neon sign failed to load its title artwork', error);
      });

    const pointerMove = (event: PointerEvent) => {
      const rect = stage.getBoundingClientRect();
      sign.pointer.set(
        ((event.clientX - rect.left) / rect.width) * 2 - 1,
        ((event.clientY - rect.top) / rect.height) * 2 - 1,
      );
    };
    const pointerLeave = () => sign.pointer.set(0, 0);
    stage.addEventListener('pointermove', pointerMove);
    stage.addEventListener('pointerleave', pointerLeave);

    // Fired by `SettingsPanel` after every persisted change to sparks/bloom/reduced-motion, and
    // by `MainMenu`'s own header toggle — both re-read the same `loadSettings()` source of truth
    // rather than passing a value through the event.
    const onSettingsChanged = () => {
      const latest = loadSettings();
      sign.configure({
        sparks: latest.menuSignSparks,
        bloom: latest.menuSignBloom,
        reducedMotion: latest.reducedMotion,
      });
    };
    window.addEventListener(MENU_SIGN_SETTINGS_CHANGED_EVENT, onSettingsChanged);

    return () => {
      stage.removeEventListener('pointermove', pointerMove);
      stage.removeEventListener('pointerleave', pointerLeave);
      window.removeEventListener(MENU_SIGN_SETTINGS_CHANGED_EVENT, onSettingsChanged);
      signRef.current = null;
      sign.dispose();
    };
  }, []);

  const lastSparkAtRef = useRef(0);
  const spark = () => {
    // Debounced the same way the ported prototype's own pointer-triggered spark was — an eager
    // clicker shouldn't be able to spawn overlapping bursts faster than they read. A `useRef`
    // rather than a plain local, since a local would reset to 0 on every re-render.
    const now = performance.now();
    if (now - lastSparkAtRef.current < 500) return;
    lastSparkAtRef.current = now;
    signRef.current?.spark(65);
  };

  return (
    <section className="restaurant" aria-label="Table Stakes neon restaurant sign">
      <div ref={stageRef} className={`neon-sign-stage${ready ? ' sign-ready' : ''}`} onClick={spark}>
        <h1 className="neon-sign-fallback-title">
          TABLE
          <br />
          STAKES
        </h1>
        {!ready ? <div className="neon-sign-loading">Warming up the sign</div> : null}
      </div>

      <div className="sign-caption">
        <span className="open-tag">
          <i /> Open for competition
        </span>
        <span className="coordinates">Est. tonight&nbsp; / &nbsp;table for two rivals</span>
      </div>

      <div className="restaurant-copy">
        <span className="eyebrow">Welcome to the neighborhood</span>
        <h2>
          Your house.
          <br />
          <em>Your rules.</em>
        </h2>
        <p>
          Run the floor. Win the crowd.
          <br />
          Beat the restaurant next door.
        </p>
      </div>

      <button type="button" className="spark-button" onClick={spark}>
        <span>✧</span> Give it a spark
      </button>
    </section>
  );
}
