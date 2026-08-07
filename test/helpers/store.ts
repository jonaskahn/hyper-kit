/* Shared Hyper-store mocks for tests: the termGroups tree shape that the
   plugin reads (getTermGroups / listPaneSessions / rootGroupUid walk) is
   built once here so every suite exercises the same fixture. */

export function tabStore(
  termGroups: Record<string, any>,
  activeSessions: Record<string, string> = {},
  activeRootGroup: string | null = 'g1',
): any {
  return {
    getState: () => ({ termGroups: { termGroups, activeSessions, activeRootGroup } }),
  };
}

/* g1 (root, unsplit until it has children) -> one group per child, each
   owning session s2..sN, as after splits */
export function splitGroups(children: string[] = ['g2', 'g3']): Record<string, any> {
  const groups: Record<string, any> = {
    g1: { uid: 'g1', sessionUid: null, parentUid: null, children },
  };
  children.forEach((uid, i) => {
    groups[uid] = { uid, sessionUid: 's' + (i + 2), parentUid: 'g1', children: [] };
  });
  return groups;
}

/* single pane: root group g1 owns session s1 */
export function unsplitGroup(sessionUid = 's1'): Record<string, any> {
  return { g1: { uid: 'g1', sessionUid, parentUid: null, children: [] } };
}
