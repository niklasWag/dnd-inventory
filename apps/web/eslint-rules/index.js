/**
 * R8.5 — local ESLint flat-config plugin exposing the project's custom
 * rules. Currently just `no-sync-toast-success-after-dispatch`
 * (BUG-005 enforcement). Wired into `apps/web/eslint.config.js`.
 */
import noSyncToastSuccessAfterDispatch from './no-sync-toast-success-after-dispatch.js';

export default {
  rules: {
    'no-sync-toast-success-after-dispatch': noSyncToastSuccessAfterDispatch,
  },
};
