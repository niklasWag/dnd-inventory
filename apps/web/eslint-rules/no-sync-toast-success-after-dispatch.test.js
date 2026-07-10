import { RuleTester } from 'eslint';
import { describe, it } from 'vitest';

import rule from './no-sync-toast-success-after-dispatch.js';

// Route RuleTester's assertions through Vitest's globals so it runs in
// the normal `pnpm test` suite.
RuleTester.describe = describe;
RuleTester.it = it;

const ruleTester = new RuleTester({
  languageOptions: {
    ecmaVersion: 2022,
    sourceType: 'module',
    parserOptions: { ecmaFeatures: { jsx: true } },
  },
});

ruleTester.run('no-sync-toast-success-after-dispatch', rule, {
  valid: [
    // The blessed shape — toast.success lives in the onSuccess callback.
    {
      code: `function h() { void dispatch(a, { onSuccess: () => toast.success('X') }); }`,
    },
    // toast.success with no preceding dispatch (clipboard / export).
    {
      code: `async function h() { await navigator.clipboard.writeText(x); toast.success('Copied'); }`,
    },
    // A dispatch AFTER the toast (different intent) is not flagged.
    {
      code: `function h() { toast.success('X'); dispatch(a); }`,
    },
    // toast.error after dispatch is fine (only .success is the flash).
    {
      code: `function h() { void dispatch(a); toast.error('nope'); }`,
    },
  ],
  invalid: [
    // Classic naive pattern.
    {
      code: `function h() { dispatch(a); toast.success('Saved'); }`,
      errors: [{ messageId: 'syncToastAfterDispatch' }],
    },
    // `void dispatch(...)` still counts as a dispatch sibling.
    {
      code: `function h() { void dispatch(a); toast.success('Saved'); }`,
      errors: [{ messageId: 'syncToastAfterDispatch' }],
    },
    // dispatchMintingAction variant.
    {
      code: `function h() { dispatchMintingAction(a); toast.success('Created'); }`,
      errors: [{ messageId: 'syncToastAfterDispatch' }],
    },
    // Member-expression dispatch (useStore.getState().dispatch(...)).
    {
      code: `function h() { useStore.getState().dispatch(a); toast.success('Saved'); }`,
      errors: [{ messageId: 'syncToastAfterDispatch' }],
    },
    // Statements between them don't rescue it.
    {
      code: `function h() { dispatch(a); setOpen(false); toast.success('Saved'); }`,
      errors: [{ messageId: 'syncToastAfterDispatch' }],
    },
  ],
});
