// STORY-060, generalized by STORY-063. The player's own owner avatar — the first rigged character
// in the game, and for a while the only one.
//
// All of the machinery that used to live here (cached GLB parse, `SkeletonUtils.clone` for the
// skinned-mesh clone, the idle/walk crossfade, disposal) now lives in `RiggedCharacterModel.ts`,
// which serves this character and the cast-pack workers alike. What remains here is Chef Blaze's
// own binding of that machinery: which GLB, which two clips, and the fact that this particular
// character owns its geometry and materials rather than sharing them.
//
// WHY THIS ONE OWNS ITS RESOURCES while the workers share theirs: `RestaurantScene.ts`'s
// `upsertOwner` only takes this path for `state.isSelf`, so exactly one instance is ever live per
// client. There is nothing to amortize, and owning its resources means `removeOwner`'s disposal
// can free them outright without reasoning about who else might still be pointing at them. The
// crowd characters make the opposite trade for the opposite reason — see
// `RiggedCharacterOptions.ownResources`.
import {
  buildRiggedCharacter,
  disposeObject,
  type RiggedCharacterInstance,
} from './RiggedCharacterModel';

const modelUrl = new URL('../../../assets/chef-blaze/ChefBlaze.glb', import.meta.url).href;

/** Kept as the exported name STORY-060's call sites already use. */
export type ChefBlazeInstance = RiggedCharacterInstance;

/** Load (once, cached) and instantiate the player's own Chef Blaze avatar. Rejects if the GLB
 * fails to load or is missing either clip; `upsertOwner` keeps its primitive placeholder in place
 * until/unless this resolves, so a rejection just means the self owner stays on the placeholder. */
export function buildChefBlaze(): Promise<ChefBlazeInstance> {
  return buildRiggedCharacter(
    {
      url: modelUrl,
      idleClip: 'ChefBlaze_Idle',
      walkClip: 'ChefBlaze_Walk_InPlace',
    },
    // See this file's header for why the owner avatar, uniquely, owns its geometry/materials.
    { ownResources: true },
  );
}

export { disposeObject as disposeChefBlaze };
