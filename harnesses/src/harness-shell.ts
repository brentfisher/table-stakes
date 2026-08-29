// The harness registry and shell. PRD §15 "Harness interface" defines the contract:
//
//   export interface SceneHarness {
//     id: string; title: string; description: string;
//     mount(container: HTMLElement): void; dispose(): void;
//   }
//
// The shell mounts one harness at a time into a container and disposes the previous one,
// so switching harnesses must not leak scene objects or listeners.

export interface SceneHarness {
  id: string;
  title: string;
  description: string;
  mount(container: HTMLElement): void;
  dispose(): void;
}

export class HarnessShell {
  private active: SceneHarness | null = null;
  private readonly stage: HTMLDivElement;
  private readonly sidebar: HTMLDivElement;
  private readonly description: HTMLParagraphElement;

  constructor(
    private readonly root: HTMLElement,
    private readonly harnesses: SceneHarness[],
  ) {
    this.root.className = 'harness-shell';

    this.sidebar = document.createElement('div');
    this.sidebar.className = 'harness-sidebar';
    const heading = document.createElement('h1');
    heading.textContent = 'Dev Harnesses';
    const note = document.createElement('p');
    note.className = 'muted';
    note.textContent = 'Standalone scenes. No backend, no match, no auth required.';
    this.sidebar.append(heading, note);

    for (const harness of this.harnesses) {
      const button = document.createElement('button');
      button.textContent = harness.title;
      button.dataset.harnessId = harness.id;
      button.addEventListener('click', () => this.activate(harness.id));
      this.sidebar.appendChild(button);
    }

    this.description = document.createElement('p');
    this.description.className = 'muted harness-description';
    this.sidebar.appendChild(this.description);

    this.stage = document.createElement('div');
    this.stage.className = 'harness-stage';

    this.root.append(this.sidebar, this.stage);
  }

  activate(id: string): void {
    const harness = this.harnesses.find((h) => h.id === id);
    if (!harness) return;
    if (this.active?.id === id) return;

    // Dispose before mounting: a harness that leaks fails its own acceptance criteria.
    this.active?.dispose();
    this.stage.replaceChildren();

    this.active = harness;
    this.description.textContent = harness.description;
    for (const button of this.sidebar.querySelectorAll('button')) {
      button.classList.toggle('active', button.dataset.harnessId === id);
    }
    harness.mount(this.stage);

    const url = new URL(window.location.href);
    url.searchParams.set('harness', id);
    window.history.replaceState({}, '', url);
  }

  start(): void {
    const requested = new URL(window.location.href).searchParams.get('harness');
    const initial = this.harnesses.find((h) => h.id === requested) ?? this.harnesses[0];
    if (initial) this.activate(initial.id);
  }

  dispose(): void {
    this.active?.dispose();
    this.active = null;
  }
}
