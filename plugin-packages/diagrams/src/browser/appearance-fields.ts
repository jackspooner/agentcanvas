import type { DiagramAppearance } from '../contracts.js';

/** Blank inputs remove overrides, so later canvas theme changes still apply. */
export function appearanceFields(
  parent: HTMLElement,
  initial: DiagramAppearance = {},
  box = true,
  header = box
): () => DiagramAppearance | undefined {
  const group = document.createElement('fieldset');
  const legend = document.createElement('legend');
  legend.textContent = 'Appearance (blank inherits theme)';
  group.append(legend);
  const controls = new Map<keyof DiagramAppearance, HTMLInputElement | HTMLSelectElement>();
  const fields: Array<readonly [keyof DiagramAppearance, string]> = [
    ['fill', box ? 'Box color' : 'Label background'],
    ...(header ? [['headerFill', 'Header color'] as const] : []),
    ['textColor', 'Text color'],
    ['borderColor', 'Border color'],
    ['borderWidth', 'Border width'],
    ['borderStyle', 'Border style'],
    ['fontFamily', 'Font family'],
    ['fontSize', 'Font size']
  ];
  for (const [key, title] of fields) {
    const label = document.createElement('label');
    const control = key === 'borderStyle' ? document.createElement('select') : document.createElement('input');
    if (control instanceof HTMLSelectElement)
      control.append(...['', 'solid', 'dashed', 'dotted'].map((value) => new Option(value || 'Inherit', value)));
    else if (key === 'fontSize' || key === 'borderWidth') {
      control.type = 'number';
      control.min = key === 'fontSize' ? '8' : '0';
      control.max = key === 'fontSize' ? '48' : '12';
      control.step = 'any';
    } else if (key === 'fontFamily') {
      control.maxLength = 100;
      control.pattern = '[A-Za-z0-9 ,_-]+';
      control.placeholder = 'Canvas font';
    } else {
      control.pattern = '#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?';
      control.placeholder = '#336699';
    }
    control.value = String(initial[key] ?? '');
    label.append(title, control);
    group.append(label);
    controls.set(key, control);
  }
  const reset = document.createElement('button');
  reset.type = 'button';
  reset.textContent = 'Reset appearance to theme';
  reset.onclick = () => {
    for (const control of controls.values()) control.value = '';
    group.dispatchEvent(new Event('input', { bubbles: true }));
  };
  group.append(reset);
  parent.append(group);
  return () => {
    const entries = [...controls]
      .filter(([, control]) => control.value !== '')
      .map(([key, control]) => [
        key,
        key === 'fontSize' || key === 'borderWidth' ? Number(control.value) : control.value
      ]);
    return entries.length ? (Object.fromEntries(entries) as DiagramAppearance) : undefined;
  };
}
