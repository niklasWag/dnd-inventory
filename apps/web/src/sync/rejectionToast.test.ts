import { describe, expect, it } from 'vitest';

import { rejectionToastArgs } from './rejectionToast';

describe('rejectionToastArgs', () => {
  it('maps a server rejection code to `Action rejected: <code>` with the server message', () => {
    expect(rejectionToastArgs('dm_only', 'Only the DM may do that.')).toEqual({
      title: 'Action rejected: dm_only',
      description: 'Only the DM may do that.',
    });
  });

  it('omits the description when no server message is provided', () => {
    expect(rejectionToastArgs('banker_required_for_claim')).toEqual({
      title: 'Action rejected: banker_required_for_claim',
    });
  });

  it('gives offline_write_blocked a friendly title and no description', () => {
    expect(rejectionToastArgs('offline_write_blocked')).toEqual({
      title: 'Offline — changes are disabled until you reconnect.',
    });
  });

  it('gives sync_paused a friendly title', () => {
    expect(rejectionToastArgs('sync_paused')).toEqual({
      title: 'Sync paused — will retry on reconnect.',
    });
  });

  it('surfaces the reducer error message as the description', () => {
    expect(rejectionToastArgs('reducer_error', 'Insufficient funds')).toEqual({
      title: 'Action failed.',
      description: 'Insufficient funds',
    });
  });
});
