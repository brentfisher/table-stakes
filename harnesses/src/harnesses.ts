// Harness registration. PRD §15 "Example harness registration".
//
// STORY-018 (customer flow) and STORY-019 (kitchen bottleneck) append here — those three
// satisfy the §22 requirement that at least three harnesses run independently of a live match.
// STORY-020 (event visualization) follows; STORY-021 (upgrade preview) remains pending.

import { restaurantLayoutHarness } from './restaurant-layout-harness';
import { customerFlowHarness } from './customer-flow-harness';
import { kitchenBottleneckHarness } from './kitchen-bottleneck-harness';
import { eventVisualizationHarness } from './event-visualization-harness';
import type { SceneHarness } from './harness-shell';

export const harnesses: SceneHarness[] = [
  restaurantLayoutHarness,
  customerFlowHarness,
  kitchenBottleneckHarness,
  eventVisualizationHarness,
];
