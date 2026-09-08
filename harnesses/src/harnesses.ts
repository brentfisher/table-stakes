// Harness registration. PRD §15 "Example harness registration".
//
// STORY-018 (customer flow) and STORY-019 (kitchen bottleneck) append here — those three
// satisfy the §22 requirement that at least three harnesses run independently of a live match.
// STORY-020 (event visualization) and STORY-021 (upgrade preview) follow — every story in the
// original slice is now built. STORY-026 (asset showcase) adds a sixth, outside that original
// slice — see its own header for the scope reality-check on why it reuses production views
// rather than building the model/texture/animation-loading pipeline its source PRD envisions.

import { restaurantLayoutHarness } from './restaurant-layout-harness';
import { customerFlowHarness } from './customer-flow-harness';
import { kitchenBottleneckHarness } from './kitchen-bottleneck-harness';
import { eventVisualizationHarness } from './event-visualization-harness';
import { upgradePreviewHarness } from './upgrade-preview-harness';
import { assetShowcaseHarness } from './asset-showcase-harness';
import { frontDoorPolicyHarness } from './front-door-policy-harness';
import { serviceStationHarness } from './service-station-harness';
import { pantryBoardHarness } from './pantry-board-harness';
import type { SceneHarness } from './harness-shell';

export const harnesses: SceneHarness[] = [
  restaurantLayoutHarness,
  customerFlowHarness,
  kitchenBottleneckHarness,
  eventVisualizationHarness,
  upgradePreviewHarness,
  assetShowcaseHarness,
  frontDoorPolicyHarness,
  serviceStationHarness,
  pantryBoardHarness,
];
