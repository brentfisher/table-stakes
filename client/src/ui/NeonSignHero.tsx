// STORY-032. The animated "TABLE / STAKES" marquee shown above `MainMenu`'s existing action
// list — the visual only. Every menu action (Play vs Bot, Invite Opponent, Join Private Match,
// How to Play, Settings) is unchanged, real wiring already on `MainMenu` itself; this component
// owns nothing but the sign.
//
// `NeonSign.ts` renders through its own `WebGLRenderer`/animation loop, entirely outside React's
// render cycle — this wrapper's only jobs are: mount it into a ref'd container once, keep it in
// sync with `Settings` when sparks/bloom/reduced-motion change, and dispose it on unmount (a
// route change away from the menu, or React strict-mode's double-invoke in dev).

import { useEffect, useRef } from 'react';
import { NeonRestaurantSign } from '../scenes/NeonSign';
import { loadSettings } from '../app/settings';

/** `SettingsPanel` is a sibling modal, not a parent/child of this component, and the sign
 * instance lives outside React state entirely — a DOM event is the least-coupled way for
 * "settings changed" to reach it without threading a ref through `MainMenu` for a value only
 * these two ever touch. Same event-as-signal shape the ported prototype already used for its
 * own `table-stakes:action` events. */
export const MENU_SIGN_SETTINGS_CHANGED_EVENT = 'table-stakes:menu-sign-settings-changed';

export function NeonSignHero(): JSX.Element {
  const stageRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const settings = loadSettings();
    const sign = new NeonRestaurantSign(stage, {
      sparks: settings.menuSignSparks,
      bloom: settings.menuSignBloom,
      reducedMotion: settings.reducedMotion,
    });
    sign.ready.catch((error) => {
      // A failed font-outline fetch leaves the facade (brick backing, tubes, bulbs) rendered
      // with no lettering — the fallback heading text in the JSX below stays visible either way
      // since it isn't tied to `sign-ready`, so there's nothing further to recover here beyond
      // logging for whoever's debugging the deploy.
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

    // Fired by `SettingsPanel` after every persisted change to sparks/bloom/reduced-motion —
    // re-reads the same `loadSettings()` source of truth `SettingsPanel` just wrote to.
    const onSettingsChanged = () => {
      const latest = loadSettings();
      sign.configure({
        sparks: latest.menuSignSparks,
        bloom: latest.menuSignBloom,
        reducedMotion: latest.reducedMotion,
      });
    };
    window.addEventListener(MENU_SIGN_SETTINGS_CHANGED_EVENT, onSettingsChanged);

    let lastSparkAt = 0;
    const clickSpark = () => {
      // Debounced the same way the ported prototype's own pointer-triggered spark was — an
      // eager clicker shouldn't be able to spawn overlapping bursts faster than they read.
      const now = performance.now();
      if (now - lastSparkAt < 500) return;
      lastSparkAt = now;
      sign.spark(65);
    };
    stage.addEventListener('click', clickSpark);

    return () => {
      stage.removeEventListener('pointermove', pointerMove);
      stage.removeEventListener('pointerleave', pointerLeave);
      stage.removeEventListener('click', clickSpark);
      window.removeEventListener(MENU_SIGN_SETTINGS_CHANGED_EVENT, onSettingsChanged);
      sign.dispose();
    };
  }, []);

  return (
    <div className="neon-sign-hero">
      <div ref={stageRef} className="neon-sign-stage" role="img" aria-label="Table Stakes neon restaurant sign">
        <span className="neon-sign-fallback">
          TABLE
          <br />
          STAKES
        </span>
      </div>
    </div>
  );
}
