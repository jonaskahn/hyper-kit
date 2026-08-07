/* Active-tab tracking (shared between the bottom panel and the tab bar). */

let activeTabUid: string | null = null;
let activeMountAt = 0;

export function setActiveTab(uid?: string | null, mountAt?: number): void {
  activeTabUid = uid || null;
  if (mountAt) {
    activeMountAt = mountAt;
  }
}

export function getActiveTab(): { uid: string | null; mountAt: number } {
  return { uid: activeTabUid, mountAt: activeMountAt };
}
