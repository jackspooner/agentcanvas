import type { RendererOverlayService } from '@agentcanvas/extension-sdk';

/** The native dialog and explicit Tab wrapping contain focus; the host owns overlay lifetime. */
export function diagramModal(
  overlays: RendererOverlayService,
  signal: AbortSignal,
  label: string,
  dirty: () => boolean = () => false,
  busy: () => boolean = () => false
) {
  signal.throwIfAborted();
  let previous = document.activeElement;
  while (previous?.shadowRoot?.activeElement) previous = previous.shadowRoot.activeElement;
  const dialog = document.createElement('dialog');
  dialog.setAttribute('aria-label', label);
  dialog.dataset.agentcanvasInteractive = '';
  dialog.style.cssText =
    'width:min(1200px,94vw);height:min(850px,90vh);padding:16px;border:1px solid #888;border-radius:12px;box-sizing:border-box;overflow:auto';
  const closeButton = document.createElement('button');
  closeButton.type = 'button';
  closeButton.textContent = 'Close';
  const body = document.createElement('div');
  body.style.cssText = 'height:calc(100% - 40px);min-height:200px';
  const discard = document.createElement('div');
  discard.hidden = true;
  discard.setAttribute('role', 'alert');
  discard.textContent = 'Discard unsaved diagram changes? ';
  const keep = document.createElement('button');
  keep.type = 'button';
  keep.textContent = 'Keep editing';
  const abandon = document.createElement('button');
  abandon.type = 'button';
  abandon.textContent = 'Discard and close';
  discard.append(keep, abandon);
  dialog.append(closeButton, discard, body);
  const overlay = overlays.open(dialog, { label });
  const controller = new AbortController();
  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    controller.abort();
    dialog.close();
    overlay.close();
    signal.removeEventListener('abort', close);
    if (previous instanceof HTMLElement && previous.isConnected) previous.focus();
  };
  const requestClose = () => {
    if (busy()) {
      closeButton.textContent = 'Saving… wait before closing';
      return;
    }
    closeButton.textContent = 'Close';
    if (dirty()) {
      discard.hidden = false;
      keep.focus();
    } else close();
  };
  closeButton.onclick = requestClose;
  dialog.addEventListener('cancel', (event) => {
    event.preventDefault();
    requestClose();
  });
  keep.onclick = () => {
    discard.hidden = true;
    closeButton.focus();
  };
  abandon.onclick = () => {
    if (!busy()) close();
  };
  signal.addEventListener('abort', close, { once: true });
  dialog.addEventListener('keydown', (event) => {
    if (event.key !== 'Tab') return;
    const controls = [
      ...dialog.querySelectorAll<HTMLElement>('button, input, textarea, select, a[href], [tabindex]')
    ].filter(
      (control) => control.tabIndex >= 0 && !control.matches(':disabled') && control.getClientRects().length > 0
    );
    const first = controls[0] ?? closeButton;
    const last = controls.at(-1) ?? closeButton;
    if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog)) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  });
  dialog.showModal();
  closeButton.focus();
  if (signal.aborted) close();
  return { body, signal: controller.signal, close };
}
