import { describe, it, expect } from 'vitest';

import { decorateTab } from '../../../src/features/tabs/tabs';

function FakeTab(props: any) {
  return props;
}

describe('decorateTab', () => {
  it('wraps a tab component and forwards props through render', () => {
    const Decorated = decorateTab(FakeTab) as any;
    const inst = new Decorated({ a: 1 });
    const el = inst.render();
    expect(el.type).toBe(FakeTab);
    expect(el.props.a).toBe(1);
  });

  it('componentDidMount is a safe no-op when the DOM node is missing', () => {
    const Decorated = decorateTab(FakeTab) as any;
    const inst = new Decorated({});
    expect(() => inst.componentDidMount()).not.toThrow();
  });
});
