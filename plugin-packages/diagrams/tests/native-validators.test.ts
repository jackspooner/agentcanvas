// @vitest-environment node
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import { transform } from 'esbuild';
import { expect, it } from 'vitest';

it('initializes and validates standalone schemas when runtime string code generation is forbidden', async () => {
  const source = await readFile(new URL('../src/erd/schema-validators.ts', import.meta.url), 'utf8');
  const compiled = await transform(source, { loader: 'ts', format: 'iife', globalName: 'validators' });
  const result = runInNewContext(
    `${compiled.code}\n({
    valid: validators.validShape({title:'',entities:[],relationships:[]}),
    invalid: validators.validShape({title:'',entities:[],relationships:[],extra:true}),
    operation: validators.validOperation({op:'set-title',title:'Hello'}),
    unknown: validators.validOperation({op:'run-code',code:'bad'})
  })`,
    {},
    { contextCodeGeneration: { strings: false, wasm: false } }
  );
  expect(result).toEqual({ valid: true, invalid: false, operation: true, unknown: false });
});
