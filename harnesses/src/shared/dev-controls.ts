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

  addToggle(label: string, initial: boolean, onChange: (value: boolean) => void): void {
    const row = document.createElement('label');
    row.className = 'row';
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.checked = initial;
    input.addEventListener('change', () => onChange(input.checked));
    row.append(input, document.createTextNode(label));
    this.body.appendChild(row);
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
    this.body.appendChild(row);
    return (next: number) => {
      input.value = String(next);
      readout.textContent = next.toFixed(2);
    };
  }

  addButton(label: string, onClick: () => void): void {
    const button = document.createElement('button');
    button.textContent = label;
    button.addEventListener('click', onClick);
    this.body.appendChild(button);
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
  ): (options: { value: string; label: string }[], selected?: string) => void {
    const row = document.createElement('label');
    row.className = 'row column';
    const caption = document.createElement('span');
    caption.textContent = label;
    const select = document.createElement('select');
    select.addEventListener('change', () => onChange(select.value));
    row.append(caption, select);
    this.body.appendChild(row);

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
  addSeparator(): void {
    this.body.appendChild(document.createElement('hr'));
  }

  addReadout(label: string): (value: string) => void {
    const row = document.createElement('div');
    row.className = 'row';
    const caption = document.createElement('span');
    caption.textContent = `${label} `;
    const value = document.createElement('b');
    row.append(caption, value);
    this.body.appendChild(row);
    return (next: string) => {
      value.textContent = next;
    };
  }
}
