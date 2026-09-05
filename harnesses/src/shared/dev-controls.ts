// A tiny control panel so a harness can expose toggles and sliders without pulling in a
// UI library. PRD §15: "launch a harness, alter a scene configuration, and immediately
// inspect the result" — the emphasis is on immediacy, not on the panel being pretty.

export class DevControls {
  readonly element: HTMLDivElement;
  private readonly body: HTMLDivElement;

  constructor(title: string) {
    this.element = document.createElement('div');
    this.element.className = 'dev-controls';
    const heading = document.createElement('h2');
    heading.textContent = title;
    this.element.appendChild(heading);
    this.body = document.createElement('div');
    this.element.appendChild(this.body);
  }

  /** STORY-026. A grouping container appended into `body` that a caller can hide/show as a
   * unit (via `.hidden`) — e.g. one section per showcase category, only one of which is ever
   * visible. Every `addX` method below still defaults to appending straight into `body` when no
   * `container` is given, so this is purely additive: every existing call site across the other
   * five harnesses is unaffected. */
  section(): HTMLDivElement {
    const el = document.createElement('div');
    this.body.appendChild(el);
    return el;
  }

  /** STORY-026. Returns a setter, matching `addSlider`/`addSelect`/`addReadout` — a caller that
   * re-points this toggle at a different underlying entity (e.g. switching which worker/owner
   * is being inspected) needs to re-sync the checkbox to THAT entity's own current flag without
   * firing `onChange` and re-mutating state that is already correct. */
  addToggle(
    label: string,
    initial: boolean,
    onChange: (value: boolean) => void,
    container: HTMLElement = this.body,
  ): (value: boolean) => void {
    const row = document.createElement('label');
    row.className = 'row';
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.checked = initial;
    input.addEventListener('change', () => onChange(input.checked));
    row.append(input, document.createTextNode(label));
    container.appendChild(row);
    return (value: boolean) => {
      input.checked = value;
    };
  }

  /** Returns a setter so a caller can re-sync the slider's displayed value when the thing it
   * controls changes for a reason OTHER than dragging the slider itself (STORY-018: picking a
   * different "selected customer" must show THAT party's own patience, not silently overwrite
   * it with whatever the slider happened to be at). The setter never calls `onChange` — it is a
   * display-only sync, exactly like `addReadout`'s returned setter. */
  addSlider(
    label: string,
    { min, max, step, value }: { min: number; max: number; step: number; value: number },
    onChange: (value: number) => void,
    container: HTMLElement = this.body,
  ): (value: number) => void {
    const row = document.createElement('label');
    row.className = 'row column';
    const caption = document.createElement('span');
    const readout = document.createElement('b');
    readout.textContent = value.toFixed(2);
    caption.append(`${label} `, readout);
    const input = document.createElement('input');
    input.type = 'range';
    input.min = String(min);
    input.max = String(max);
    input.step = String(step);
    input.value = String(value);
    input.addEventListener('input', () => {
      const next = Number(input.value);
      readout.textContent = next.toFixed(2);
      onChange(next);
    });
    row.append(caption, input);
    container.appendChild(row);
    return (next: number) => {
      input.value = String(next);
      readout.textContent = next.toFixed(2);
    };
  }

  addButton(label: string, onClick: () => void, container: HTMLElement = this.body): void {
    const button = document.createElement('button');
    button.textContent = label;
    button.addEventListener('click', onClick);
    container.appendChild(button);
  }

  /** A plain `<select>` — used where the option set is a small closed vocabulary (a customer
   * segment id, a §8 `CustomerState`) that reads better as a dropdown than as one button per
   * value. Returns a setter so the caller can repopulate/reselect options (STORY-018: the
   * "selected customer" dropdown's own option list changes every time a party spawns, is
   * force-exited, or is otherwise removed from the mock roster) without rebuilding the DOM node
   * — same setter shape as `addSlider`/`addReadout`, and likewise never fires `onChange`. */
  addSelect(
    label: string,
    options: { value: string; label: string }[],
    onChange: (value: string) => void,
    container: HTMLElement = this.body,
  ): (options: { value: string; label: string }[], selected?: string) => void {
    const row = document.createElement('label');
    row.className = 'row column';
    const caption = document.createElement('span');
    caption.textContent = label;
    const select = document.createElement('select');
    select.addEventListener('change', () => onChange(select.value));
    row.append(caption, select);
    container.appendChild(row);

    const populate = (opts: { value: string; label: string }[], selected?: string) => {
      const previous = selected ?? select.value;
      select.replaceChildren();
      for (const opt of opts) {
        const option = document.createElement('option');
        option.value = opt.value;
        option.textContent = opt.label;
        select.appendChild(option);
      }
      if (opts.some((o) => o.value === previous)) select.value = previous;
    };
    populate(options);
    return populate;
  }

  /** A plain visual divider between control groups — STORY-018 has enough distinct groups
   * (spawn config, selected-party controls, queue simulation, display toggles) that an
   * unbroken list of rows reads as one undifferentiated pile; a few `<hr>`s cost nothing and
   * make the panel scannable. */
  addSeparator(container: HTMLElement = this.body): void {
    container.appendChild(document.createElement('hr'));
  }

  addReadout(label: string, container: HTMLElement = this.body): (value: string) => void {
    const row = document.createElement('div');
    row.className = 'row';
    const caption = document.createElement('span');
    caption.textContent = `${label} `;
    const value = document.createElement('b');
    row.append(caption, value);
    container.appendChild(row);
    return (next: string) => {
      value.textContent = next;
    };
  }

  /** STORY-026. A multi-line diagnostics readout — `addReadout`'s `<b>` is a single inline
   * span, wrong for the "loading failures, missing textures, unsupported animations, invalid
   * fixture metadata surface as visible diagnostics" requirement, which routinely needs several
   * sentence-long, independent notes at once. Returns a setter taking a list of lines (each its
   * own paragraph); an empty list renders a neutral placeholder rather than a blank box, so "no
   * diagnostics" always reads as an intentional state, not a missing readout. */
  addDiagnostics(label: string, container: HTMLElement = this.body): (lines: string[]) => void {
    const wrap = document.createElement('div');
    wrap.className = 'row column diagnostics-box';
    const caption = document.createElement('span');
    caption.textContent = label;
    const body = document.createElement('div');
    body.className = 'diagnostics-body';
    wrap.append(caption, body);
    container.appendChild(wrap);
    return (lines: string[]) => {
      body.replaceChildren();
      if (lines.length === 0) {
        const p = document.createElement('p');
        p.className = 'muted';
        p.textContent = 'No diagnostics for this selection.';
        body.appendChild(p);
        return;
      }
      for (const line of lines) {
        const p = document.createElement('p');
        p.textContent = line;
        body.appendChild(p);
      }
    };
  }
}
