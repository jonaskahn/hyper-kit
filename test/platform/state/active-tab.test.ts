import { describe, it, expect } from 'vitest';

import { setActiveTab, getActiveTab } from '../../../src/platform/state/active-tab';

describe('ui-state', () => {
  it('tracks the active tab uid', () => {
    setActiveTab('g1', 1000);
    expect(getActiveTab()).toEqual({ uid: 'g1', mountAt: 1000 });
  });

  it('keeps the previous mount time when none is passed', () => {
    setActiveTab('g1', 1000);
    setActiveTab('g2');
    expect(getActiveTab()).toEqual({ uid: 'g2', mountAt: 1000 });
  });

  it('resets the uid to null', () => {
    setActiveTab('g1', 1000);
    setActiveTab(null, 0);
    expect(getActiveTab().uid).toBeNull();
  });
});
