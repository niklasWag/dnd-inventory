/**
 * R8.5 — custom ESLint rule: `no-sync-toast-success-after-dispatch`.
 *
 * Enforces the mutation-outcome-authority contract (BUG-005 fix). A
 * naive
 *
 *     dispatch(action);
 *     toast.success('Saved');
 *
 * fires the success toast the instant the local reducer didn't throw —
 * BEFORE the server round-trip can reject the mutation, producing the
 * green-then-red toast flash. The correct shape routes the terminal
 * toast through the `useDispatch` outcome:
 *
 *     dispatch(action, { onSuccess: () => toast.success('Saved') });
 *
 * This rule flags a `toast.success(...)` ExpressionStatement that is a
 * sibling appearing AFTER a `dispatch(...)` / `dispatchMintingAction(...)`
 * / `<x>.dispatch(...)` call within the SAME block. It does NOT flag:
 *   - `toast.success` nested inside a callback (e.g. the `onSuccess`
 *     option passed to `useDispatch` / `dispatch`) — that's the blessed
 *     shape, because it lives in a different function scope.
 *   - `toast.success` with no preceding dispatch sibling (clipboard
 *     copy, file export, direct Dexie wipe, hydrate, etc.).
 */

/** @type {import('eslint').Rule.RuleModule} */
const rule = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Disallow a synchronous toast.success() as a sibling after a raw dispatch() call; route the success toast through useDispatch({ onSuccess }) so it waits for the terminal mutation outcome (BUG-005).',
    },
    schema: [],
    messages: {
      syncToastAfterDispatch:
        'Do not fire toast.success() immediately after dispatch() — the mutation may still be rejected server-side (BUG-005). Pass it via useDispatch({ onSuccess: () => toast.success(...) }) instead.',
    },
  },

  create(context) {
    /** Is this call expression a dispatch-style mutation call? */
    function isDispatchCall(node) {
      if (node.type !== 'CallExpression') return false;
      const callee = node.callee;
      // `dispatch(...)` / `dispatchMintingAction(...)`
      if (callee.type === 'Identifier') {
        return callee.name === 'dispatch' || callee.name === 'dispatchMintingAction';
      }
      // `<x>.dispatch(...)` (e.g. useStore.getState().dispatch(...))
      if (callee.type === 'MemberExpression' && callee.property.type === 'Identifier') {
        return callee.property.name === 'dispatch';
      }
      return false;
    }

    /** Is this call expression a `toast.success(...)` call? */
    function isToastSuccessCall(node) {
      if (node.type !== 'CallExpression') return false;
      const callee = node.callee;
      return (
        callee.type === 'MemberExpression' &&
        callee.object.type === 'Identifier' &&
        callee.object.name === 'toast' &&
        callee.property.type === 'Identifier' &&
        callee.property.name === 'success'
      );
    }

    /**
     * Unwrap a statement to the bare CallExpression it represents, if
     * any. Handles `dispatch(...)` and `void dispatch(...)`.
     */
    function callExpressionOf(statement) {
      if (statement.type !== 'ExpressionStatement') return null;
      let expr = statement.expression;
      if (expr.type === 'UnaryExpression' && expr.operator === 'void') {
        expr = expr.argument;
      }
      return expr.type === 'CallExpression' ? expr : null;
    }

    function checkBlock(statements) {
      let sawDispatch = false;
      for (const statement of statements) {
        const call = callExpressionOf(statement);
        if (call === null) continue;
        if (isToastSuccessCall(call) && sawDispatch) {
          context.report({ node: call, messageId: 'syncToastAfterDispatch' });
        }
        if (isDispatchCall(call)) {
          sawDispatch = true;
        }
      }
    }

    return {
      BlockStatement(node) {
        checkBlock(node.body);
      },
      // Top-level program body (rare for this pattern, but complete).
      Program(node) {
        checkBlock(node.body);
      },
    };
  },
};

export default rule;
