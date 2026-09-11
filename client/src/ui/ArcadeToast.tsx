// PRD-027 §5.4/§6/§9/§12 "Arcade event feedback" / "Notification Policy" / "Presentation Event
// Reducer" / "Accessibility". The React half of STORY-029's pipeline: `GameClient.ts` diffs
// consecutive `match_snapshot`s through `shared/game-logic/presentation-event-reducer.js` and
// hands this component the freshly-emitted batch (`GameClientStatus.presentationEvents`); this
// file owns turning that batch into "which ONE toast is on screen right now" and rendering it.
//
// Adapted from `docs/arcade-legibility-ui-components.tsx`'s `ArcadeToast` (markup/CSS classes) —
// but NOT from that file's `useArcadeToastQueue`. That hook sorts by an inline 6-value TONE order
// (`critical > bottleneck > attention > opportunity > premium > healthy`), a different axis from
// PRD §6.1's 7-CATEGORY priority list. This component's queue below ranks by
// `presentationEventPriority` (`shared/game-logic/presentation-event-reducer.js`), which is
// itself just `hud-alerts.js#ALERT_CATEGORIES` — the SAME ranking the persistent HUD alert strip
// already uses (STORY-015). Tone still drives color/icon here, exactly as PRD §14 intends; it
// never decides display ORDER.
//
// Mounted in `GameView.tsx` alongside `EventBanner` (same "reads GameClientStatus, no local
// simulation state" discipline — Notable Pattern 11). React state here updates only when
// `GameClient.handleMessage` patches a new `presentationEvents` batch in, i.e. at snapshot
// cadence (~10 Hz), never per animation frame (Notable Pattern 3).

import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import type { GameClientStatus } from '../game/GameClient';
import type { EmittedPresentationEvent, PresentationEvent } from '../../../shared/game-logic/presentation-event-reducer';
import { presentationEventPriority } from '../../../shared/game-logic/presentation-event-reducer';
import { ARCADE_TOAST_DISPLAY_MS } from '../../../shared/constants/tuning';
import { STATE_COLORS } from '../game/state-colors';

/** PRD §14's six-tone vocabulary, borrowed directly from `STATE_COLORS`'s own key set (STORY-029
 * AC: "use STATE_COLORS ... rather than hardcoding hex values") so a seventh tone can never be
 * introduced here without also being a real state color. */
export type ArcadeToastTone = keyof typeof STATE_COLORS;

/** `STATE_COLORS` values are Three.js-style `0xRRGGBB` numbers; CSS wants a `#rrggbb` string. A
 * pure formatting concern, not a new color source — see the import above. */
function cssColor(hex: number): string {
  return `#${hex.toString(16).padStart(6, '0')}`;
}

const ARCADE_TOAST_ICON: Record<ArcadeToastTone, string> = {
  healthy: '✓',
  attention: '!',
  bottleneck: '!',
  critical: '!',
  opportunity: '↗',
  premium: '★',
};

/**
 * Purely presentational: which of the six §14 tones a given transition reads as. `ticket-ready`
 * is healthy (good news); the three event states borrow the exact warning/active/ending → yellow/
 * blue/orange mapping `docs/arcade-legibility-ui-components.tsx`'s own `EventBanner` sample used,
 * which is itself just PRD §14's table applied to "incoming/live/winding-down". The three
 * `customer-*` types and `ingredient-blocked` are wired for completeness (matching the full §9
 * union) but not produced by the reducer yet — see that file's header.
 */
function toastToneFor(event: PresentationEvent): ArcadeToastTone {
  switch (event.type) {
    case 'ticket-ready':
    case 'owner-picked-up':
    case 'order-delivered':
      return 'healthy';
    case 'event-warning':
      return 'attention';
    case 'event-active':
      return 'opportunity';
    case 'event-ended':
      return 'bottleneck';
    case 'ingredient-blocked':
      return 'bottleneck';
    // STORY-031. Negative action feedback, not a game-state alert — `bottleneck` (orange) reads
    // as "that didn't work, try again" without the full alarm of `critical` (red), which this
    // repo's own §14 vocabulary reserves for something actually going wrong in the match.
    case 'delivery-rejected':
      return 'bottleneck';
    case 'customer-critical':
    case 'customer-lost-to-rival':
    case 'customer-abandoned':
      return 'critical';
    default:
      return 'healthy';
  }
}

/** STORY-031. `action-validator.js#resolveDeliver`'s own reason vocabulary, translated to the
 * plain-language "what to do differently" PRD §4.2 asks a toast's detail line to carry. Every
 * OTHER reason (a future validator addition) falls through to a generic uppercased/underscore-
 * stripped rendering of the raw reason string below, rather than a broken blank line. */
const DELIVERY_REJECTION_DETAIL: Record<string, string> = {
  wrong_table: 'WRONG TABLE',
  not_ready: 'ORDER NOT READY YET',
  out_of_range: 'TOO FAR FROM THE TABLE',
  no_such_target: 'NOT A TABLE',
};

/** PRD §4.2 "message must imply a decision": WHAT HAPPENED as the title, WHY IT MATTERS/WHAT TO
 * DO (or the plain-language event effect) as the detail line. Placeholder copy throughout — the
 * story's own Notes: "STORY-032 owns final large-toast visual polish and real sample copy." */
function toastCopyFor(event: PresentationEvent): { title: string; detail?: string } {
  switch (event.type) {
    case 'ticket-ready':
      return { title: `FOOD READY — TABLE ${event.tableId}`, detail: event.dishName.toUpperCase() };
    case 'event-warning':
    case 'event-active':
      return { title: event.title.toUpperCase(), detail: event.description };
    case 'event-ended':
      return { title: `${event.title.toUpperCase()} — ENDED`, detail: event.description };
    case 'owner-picked-up':
      return { title: 'PICKED UP', detail: `TABLE ${event.tableId} • ${event.dishName.toUpperCase()}` };
    case 'order-delivered':
      return {
        title: 'SERVED',
        detail: `TABLE ${event.tableId}${typeof event.revenue === 'number' ? ` • +$${event.revenue}` : ''}`,
      };
    case 'customer-critical':
      return { title: 'CUSTOMER CRITICAL', detail: event.tableId ? `TABLE ${event.tableId}` : undefined };
    case 'customer-lost-to-rival':
      return { title: 'CUSTOMERS CHOSE THE RIVAL' };
    case 'customer-abandoned':
      return { title: 'PARTY LOST', detail: 'WAIT TIME EXCEEDED' };
    case 'ingredient-blocked':
      return { title: 'INGREDIENT EMPTY', detail: `${event.stationId.toUpperCase()} BLOCKED` };
    case 'delivery-rejected':
      return {
        title: "CAN'T DELIVER HERE",
        detail: DELIVERY_REJECTION_DETAIL[event.reason] ?? event.reason.toUpperCase().replace(/_/g, ' '),
      };
    default:
      return { title: 'UPDATE' };
  }
}

/** Stable empty-array singleton — `GameClient` returns this exact reference whenever a snapshot
 * emits nothing new, so `usePresentationToastQueue`'s `useEffect` (keyed on `incoming` identity)
 * does not re-run at snapshot cadence (~10 Hz) when there is genuinely nothing new to enqueue. */
const EMPTY_PRESENTATION_EVENTS: EmittedPresentationEvent[] = [];

interface QueuedToast {
  key: string;
  event: PresentationEvent;
  priority: number;
}

/**
 * The toast queue/controller (PRD §7's `useArcadeToastQueue` component-inventory slot — a NEW
 * implementation, not the ported one; see this file's own header). Owns:
 *
 *  - At most one visible toast (§6.2): `current` is always `queue[0]`, never a list.
 *  - Interruption: a newly-arrived higher-priority event re-sorts the queue, so it becomes
 *    `current` immediately; the identity change (`current`'s own object reference) is what
 *    resets the display timer below, which is what makes this an interruption rather than a
 *    silent replace-in-place.
 *  - Coalescing: an incoming event of the SAME priority AND presentation type as one already
 *    queued replaces it rather than stacking a second entry — "equal-priority repeats coalesce
 *    into the currently visible toast" (STORY-029 AC). This is repeat-coalescing specifically;
 *    PRD §6.3's fuller "3 DISHES WAITING — OLDEST: TABLE 04" cross-entity grouping needs real
 *    copy synthesis and is explicitly later-story scope (see STORY-029's Notes).
 *
 * An interrupted toast that returns to the front of the queue later restarts its full display
 * window rather than resuming a remaining duration — a deliberate simplification for this
 * foundational story, not a PRD requirement either way.
 */
function usePresentationToastQueue(incoming: EmittedPresentationEvent[]): QueuedToast | null {
  const [queue, setQueue] = useState<QueuedToast[]>([]);

  useEffect(() => {
    if (incoming.length === 0) return;
    setQueue((prev) => {
      let next = prev;
      for (const { key, event } of incoming) {
        const priority = presentationEventPriority(event);
        next = next.filter((queued) => !(queued.priority === priority && queued.event.type === event.type));
        next = [...next, { key, event, priority }];
      }
      // Lower `priority` number is more urgent (hud-alerts.js convention) — sorting puts the
      // most urgent pending entry at index 0, which is what "current" reads below.
      return [...next].sort((a, b) => a.priority - b.priority);
    });
  }, [incoming]);

  const current = queue[0] ?? null;

  useEffect(() => {
    if (!current) return undefined;
    const timeout = window.setTimeout(() => {
      setQueue((prev) => prev.filter((queued) => queued.key !== current.key));
    }, ARCADE_TOAST_DISPLAY_MS);
    return () => window.clearTimeout(timeout);
  }, [current]);

  return current;
}

/**
 * The connected component: reads `GameClientStatus` directly (same self-contained style as
 * `EventBanner.tsx`), feeds this snapshot's freshly-emitted batch into the queue above, and
 * renders whichever single toast is currently on top.
 */
export function ArcadeToast({ status }: { status: GameClientStatus | null }): JSX.Element | null {
  // Reported: this toast's own "FOOD READY — TABLE N" popup was easy to miss/ignore mid-rush.
  // Replaced with a physical bell on the counter (`RestaurantScene#buildReadyBell`) that bounces
  // and sparks instead — `ticket-ready` is filtered out here rather than at the reducer, since
  // the reducer's own contract is "emit every §9 transition" and other future consumers of
  // `presentationEvents` may still want it. `useMemo`, keyed on the same object reference
  // `GameClient` already holds stable across empty snapshots (see `EMPTY_PRESENTATION_EVENTS`'s
  // own comment), so a snapshot with nothing new still doesn't re-run `usePresentationToastQueue`'s
  // effect below.
  const toastableEvents = useMemo(
    () => (status?.presentationEvents ?? EMPTY_PRESENTATION_EVENTS).filter((e) => e.event.type !== 'ticket-ready'),
    [status?.presentationEvents],
  );
  const current = usePresentationToastQueue(toastableEvents);
  if (!current) return null;

  const tone = toastToneFor(current.event);
  const { title, detail } = toastCopyFor(current.event);
  // PRD §12 "role=alert / assertive live announcement for truly critical toasts only; polite for
  // everything else" — gated on TONE, not presentation type, so any future critical-tone type
  // gets this for free.
  const isCritical = tone === 'critical';

  return (
    <section
      key={current.key}
      className={`arcade-toast arcade-toast--${tone}`}
      role={isCritical ? 'alert' : 'status'}
      aria-live={isCritical ? 'assertive' : 'polite'}
      style={{ '--arcade-toast-tone': cssColor(STATE_COLORS[tone]) } as CSSProperties}
    >
      <span className="arcade-toast__burst" aria-hidden="true" />
      <span className="arcade-toast__icon" aria-hidden="true">
        {ARCADE_TOAST_ICON[tone]}
      </span>
      <span className="arcade-toast__copy">
        <strong>{title}</strong>
        {detail ? <small>{detail}</small> : null}
      </span>
    </section>
  );
}
