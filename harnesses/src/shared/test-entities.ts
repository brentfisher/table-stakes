// Mocked state generators. The whole point of a harness is that it runs on state a human
// dialed in rather than state a live match produced (PRD §15).

import type { OwnerRenderState } from '../../../client/src/scenes/RestaurantScene';

export function mockOwner(
  playerId: string,
  x: number,
  z: number,
  facing = 0,
  isSelf = false,
): OwnerRenderState {
  return { playerId, position: { x, y: 0, z }, facing, isSelf };
}

/** Walks a mock owner in a slow circle so movement and camera follow can be eyeballed. */
export function orbitOwner(
  base: OwnerRenderState,
  elapsedSeconds: number,
  radius = 4,
): OwnerRenderState {
  const angle = elapsedSeconds * 0.6;
  return {
    ...base,
    position: { x: Math.cos(angle) * radius, y: 0, z: Math.sin(angle) * radius - 3 },
    facing: -angle + Math.PI / 2,
  };
}
