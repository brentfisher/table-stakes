// STORY-023 AC: "How to Play opens a panel summarizing setup decisions, service actions,
// shared-market competition, and composite scoring (static copy is acceptable; source it from
// the PRD/openspec/config.yaml context block, not invented from scratch)."
//
// Every bullet below is traceable to a section already implemented and described elsewhere in
// this codebase — nothing here is invented copy:
//   - Setup decisions: PRD §7/§18, `SetupScreen.tsx`'s own header ("menu slots ... prices/
//     margins/starting resources ... staff assignments and upgrade/perk selection").
//   - Service actions: `App.tsx`'s (now `GameView.tsx`'s) `.help` legend — the actual key
//     bindings this build ships, not a paraphrase of them.
//   - Shared-market competition: `architecture.md`'s own description ("one shared pool of
//     customers ... softmax, including walking away") and openspec/config.yaml's ARCHITECTURAL
//     RULES ("probabilistic, never argmax, so a small early advantage cannot snowball").
//   - Composite scoring: `shared/schemas/messages.d.ts`'s `MatchResult.scoreBreakdown`/
//     `penaltyBreakdown` field list, verbatim term names.
//
// Same full-bleed-modal pattern as `SettingsPanel.tsx`; see that file's header.

import { useEffect } from 'react';

export function HowToPlay({ onClose }: { onClose: () => void }): JSX.Element {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  return (
    <div className="menu-modal-backdrop" role="presentation" onClick={onClose}>
      <div
        className="menu-modal how-to-play"
        role="dialog"
        aria-modal="true"
        aria-labelledby="how-to-play-title"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="menu-modal-header">
          <h2 id="how-to-play-title">How to Play</h2>
          <button type="button" className="menu-modal-close" onClick={onClose} aria-label="Close how to play">
            ×
          </button>
        </div>

        <section className="how-to-play-section">
          <h3>Setup</h3>
          <p>
            Each match opens with a timed setup phase. Both owners build their menu (mains and
            add-ons), set a price for each dish, allocate a starting inventory budget, assign
            staff to stations, and choose one starting upgrade and one policy. Price and menu
            feedback is qualitative only — good value, premium, and so on — never a number the
            simulation is using internally.
          </p>
        </section>

        <section className="how-to-play-section">
          <h3>Service</h3>
          <p>
            When setup ends, both restaurants open at once. Move with <kbd>W</kbd><kbd>A</kbd>
            <kbd>S</kbd><kbd>D</kbd> (<kbd>Shift</kbd> to sprint), press <kbd>E</kbd> to interact
            with whatever the game is prompting — cook a step, plate an order, work a station —
            and <kbd>F</kbd> to put down what you&rsquo;re carrying. <kbd>Tab</kbd> opens a
            tactical overview of both restaurants during service.
          </p>
        </section>

        <section className="how-to-play-section">
          <h3>One shared market</h3>
          <p>
            There is no separate customer pool per restaurant — every party in the district
            weighs both restaurants on the same public factors (menu fit, price, projected wait,
            reputation, capacity, and any active event) and picks probabilistically, including
            the option to walk away entirely. A small early lead never guarantees the match: the
            choice is a weighted draw, not "whichever restaurant scores highest wins the
            customer" every time.
          </p>
        </section>

        <section className="how-to-play-section">
          <h3>Scoring</h3>
          <p>Final score is a composite of, roughly in order of weight:</p>
          <ul>
            <li>Revenue earned</li>
            <li>Guests served</li>
            <li>Average customer satisfaction</li>
            <li>A reputation bonus</li>
            <li>An event-objective bonus, for serving well during active events</li>
          </ul>
          <p>
            minus penalties for abandoned parties, cancelled orders, severe dissatisfaction,
            wasted ingredients, and any failure during a food-critic visit. A tie on the
            composite score is broken by average satisfaction, then guests served, then net
            revenue, then fewest abandoned parties, in that order.
          </p>
        </section>
      </div>
    </div>
  );
}
