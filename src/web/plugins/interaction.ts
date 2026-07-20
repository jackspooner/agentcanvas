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

/** Detects interactive extension content without leaking into focusable editor chrome above its renderer host. */
export function isPluginInteractiveEvent(event: Event, rendererHost?: Element): boolean {
  for (const entry of event.composedPath()) {
    if (!(entry instanceof Element)) continue;
    if (entry.hasAttribute('data-agentcanvas-interactive') || entry.matches(NATIVE_INTERACTIVE_SELECTOR)) {
      return true;
    }
    if (entry === rendererHost) return false;
  }
  return false;
}
