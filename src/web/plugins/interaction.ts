const NATIVE_INTERACTIVE_SELECTOR = [
  'a[href]',
  'button',
  'input',
  'select',
  'textarea',
  'audio',
  'video',
  '[contenteditable="true"]',
  '[tabindex]:not([tabindex="-1"])'
].join(',');

export function isPluginInteractiveEvent(event: Event): boolean {
  return event.composedPath().some((entry) => {
    if (!(entry instanceof Element)) return false;
    return entry.hasAttribute('data-agentcanvas-interactive') || entry.matches(NATIVE_INTERACTIVE_SELECTOR);
  });
}
