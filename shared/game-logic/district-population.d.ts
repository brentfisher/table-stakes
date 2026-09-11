// Type declarations for district-population.js (Decision 4). See that file for the full
// rationale.

export declare function shouldRenderCustomerForViewer(
  customer: { restaurantId: string | null; state: string },
  viewerRestaurantId: string | null,
): boolean;
