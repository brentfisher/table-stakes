// Captures keyboard input and produces movement intent. PRD §8 "Controls": WASD move,
// Shift sprint, E contextual interact, F secondary, Tab tactical overview.
//
// This produces INTENT only. The client never moves the avatar itself — the server clamps
// and integrates, and the snapshot is the truth (PRD §12).

export interface MoveIntent {
  x: number;
  z: number;
  sprint: boolean;
}

const KEY_TO_AXIS: Record<string, [number, number]> = {
  KeyW: [0, -1],
  ArrowUp: [0, -1],
  KeyS: [0, 1],
  ArrowDown: [0, 1],
  KeyA: [-1, 0],
  ArrowLeft: [-1, 0],
  KeyD: [1, 0],
  ArrowRight: [1, 0],
};

export class InputController {
  private readonly pressed = new Set<string>();
  private facing = 0;
  private disposed = false;
  /**
   * STORY-015. PRD §8 gives `Tab` a job only during `service`/`final_rush` (the tactical
   * overview panel) — `GameClient` flips this on each phase transition. False everywhere else
   * (lobby, market_reveal, setup, results), so Tab does NOT `preventDefault()` there: `setup`
   * is `SetupScreen.tsx`'s full-bleed form, and swallowing Tab there would break ordinary
   * browser tab-order between its fields — an accessibility regression this story must not
   * introduce just because it is what finally gives the key a purpose elsewhere.
   */
  private tacticalOverviewEnabled = false;

  onInteract: (() => void) | null = null;
  onSecondary: (() => void) | null = null;
  onToggleOverview: (() => void) | null = null;

  constructor(private readonly element: HTMLElement | Window = window) {
    this.element.addEventListener('keydown', this.handleKeyDown as EventListener);
    this.element.addEventListener('keyup', this.handleKeyUp as EventListener);
    this.element.addEventListener('blur', this.handleBlur as EventListener);
  }

  /** STORY-015. See `tacticalOverviewEnabled`'s own comment. */
  setTacticalOverviewEnabled(enabled: boolean): void {
    this.tacticalOverviewEnabled = enabled;
  }

  private handleKeyDown = (event: KeyboardEvent): void => {
    if (event.repeat) return;
    this.pressed.add(event.code);
    if (event.code === 'KeyE') this.onInteract?.();
    if (event.code === 'KeyF') this.onSecondary?.();
    if (event.code === 'Tab' && this.tacticalOverviewEnabled) {
      event.preventDefault();
      this.onToggleOverview?.();
    }
  };

  private handleKeyUp = (event: KeyboardEvent): void => {
    this.pressed.delete(event.code);
  };

  /** Releasing every key on blur prevents an avatar walking forever after tab-out. */
  private handleBlur = (): void => {
    this.pressed.clear();
  };

  setFacing(radians: number): void {
    this.facing = radians;
  }

  getFacing(): number {
    return this.facing;
  }

  getMoveIntent(): MoveIntent {
    let x = 0;
    let z = 0;
    for (const code of this.pressed) {
      const axis = KEY_TO_AXIS[code];
      if (!axis) continue;
      x += axis[0];
      z += axis[1];
    }
    return {
      x: Math.max(-1, Math.min(1, x)),
      z: Math.max(-1, Math.min(1, z)),
      sprint: this.pressed.has('ShiftLeft') || this.pressed.has('ShiftRight'),
    };
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.element.removeEventListener('keydown', this.handleKeyDown as EventListener);
    this.element.removeEventListener('keyup', this.handleKeyUp as EventListener);
    this.element.removeEventListener('blur', this.handleBlur as EventListener);
    this.pressed.clear();
  }
}
