// Harness registration. PRD §15 "Example harness registration".
//
// STORY-018 (customer flow) and STORY-019 (kitchen bottleneck) append here — those two plus
// this one satisfy the §22 requirement that at least three harnesses run independently of a
// live match. STORY-020 (event visualization) and STORY-021 (upgrade preview) follow.

import { restaurantLayoutHarness } from './restaurant-layout-harness';
import type { SceneHarness } from './harness-shell';

export const harnesses: SceneHarness[] = [restaurantLayoutHarness];
