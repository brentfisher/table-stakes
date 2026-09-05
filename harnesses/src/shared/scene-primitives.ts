// Re-exports the game's own scene/view modules so harnesses use the SAME components as the
// real client (PRD §15: "They must use the same reusable scene/entity/view components as
// the actual game where practical"). If a harness ever needs a private copy of one of
// these, that is a signal the rules/view separation has been broken.

export { RestaurantScene, ZONE_COLORS } from '../../../client/src/scenes/RestaurantScene';
export type {
  OwnerRenderState,
  RestaurantSceneOptions,
  CustomerRenderState,
  WorkerRenderState,
} from '../../../client/src/scenes/RestaurantScene';
export { CameraController, DEFAULT_CAMERA } from '../../../client/src/game/CameraController';
export type { CameraSettings } from '../../../client/src/game/CameraController';
