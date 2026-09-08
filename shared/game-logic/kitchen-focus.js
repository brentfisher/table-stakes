/**
 * STORY-036. Rank a fixed set of already-valid, already-startable tickets for one kitchen
 * focus. This function never starts work or changes simulation state; worker-system keeps all
 * inventory, station-capacity, and execution authority.
 */
export function rankTicketsForFocus(focus, tickets, fallbackCompare = () => 0) {
  if (!focus) return [...tickets].sort(fallbackCompare);
  const sign = focus.direction === 'low' ? 1 : -1;
  return [...tickets].sort((a, b) => {
    const av = Number.isFinite(a[focus.metric]) ? a[focus.metric] : 0;
    const bv = Number.isFinite(b[focus.metric]) ? b[focus.metric] : 0;
    const focusDelta = sign * (av - bv);
    return focusDelta !== 0 ? focusDelta : fallbackCompare(a, b);
  });
}
