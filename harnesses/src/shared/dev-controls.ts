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

  addSlider(
    label: string,
    { min, max, step, value }: { min: number; max: number; step: number; value: number },
    onChange: (value: number) => void,
  ): void {
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
  }

  addButton(label: string, onClick: () => void): void {
    const button = document.createElement('button');
    button.textContent = label;
    button.addEventListener('click', onClick);
    this.body.appendChild(button);
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
