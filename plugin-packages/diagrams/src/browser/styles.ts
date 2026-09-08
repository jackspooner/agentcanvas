export const erdEditorStyles = `
:host{display:block;width:100%;height:100%}
.erd-editor,.erd-editor *{box-sizing:border-box}
.erd-editor{height:100%;width:100%;display:flex;flex-direction:column;position:relative;overflow:hidden;background:var(--erd-surface);color:var(--erd-text);font:13px/1.4 var(--erd-font);border:1px solid var(--erd-border);border-radius:8px}
.erd-toolbar{display:flex;align-items:center;gap:4px;flex-wrap:wrap;padding:6px;border-bottom:1px solid var(--erd-border)}
.erd-editor :is(button,input,select,textarea){font:inherit;color:inherit;background:var(--erd-surface);border:1px solid var(--erd-border);border-radius:4px;padding:5px 7px}
.erd-editor button{cursor:pointer}.erd-editor button:hover:not(:disabled){background:var(--erd-muted)}.erd-editor button:disabled{opacity:.5;cursor:default}
.erd-editor :focus-visible{outline:2px solid var(--erd-accent);outline-offset:2px}
.erd-stage{display:block;width:100%;flex:1;min-height:80px;touch-action:none;background:var(--erd-muted)}
.erd-stage [data-entity-id],.erd-stage [data-relationship-id],.erd-stage [data-connect-entity]{cursor:pointer}
.erd-stage [data-drag-entity]{cursor:grab}.erd-stage [data-selected=true]>rect:first-child{stroke:var(--erd-accent);stroke-width:3}
.erd-status{padding:4px 8px;min-height:25px;overflow-wrap:anywhere}
.erd-form-panel{position:absolute;right:8px;top:48px;bottom:8px;width:min(340px,calc(100% - 16px));overflow:auto;padding:12px;background:var(--erd-surface);border:1px solid var(--erd-border);border-radius:8px;box-shadow:0 8px 24px #0003;z-index:2}
.erd-form-panel[hidden]{display:none}.erd-form-panel h3{margin:0 0 10px;font-size:15px}
.erd-form-panel fieldset{border:0;padding:0;margin:0;min-width:0;display:grid;gap:9px}
.erd-form-panel label{display:grid;gap:3px}.erd-form-panel label:has(input[type=checkbox]){display:flex;align-items:center;gap:6px}
.erd-form-panel input:not([type=checkbox]),.erd-form-panel select{width:100%;min-width:0}
.erd-form-actions,.erd-attribute-list{display:flex;gap:6px;flex-wrap:wrap;margin-top:10px}
.erd-form-error{color:var(--erd-text);border-left:3px solid var(--erd-accent);padding-left:6px;white-space:pre-wrap;overflow-wrap:anywhere}
.erd-form-error:empty{display:none}.erd-connect-handle{fill:var(--erd-surface);stroke:var(--erd-accent);stroke-width:2}
`;
