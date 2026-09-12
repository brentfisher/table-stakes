// Type declarations for recap-highlights.js (Decision 4). See that file for the full rationale.

export interface RecapBestSellingDish {
  dishId: string;
  count: number;
  revenue: number;
}

export interface RecapBestSellerSpotlight {
  featured: RecapBestSellingDish;
  tiedWith: RecapBestSellingDish[];
  supporting: RecapBestSellingDish[];
}

export declare function bestSellerSpotlight(
  bestSellingDishes: RecapBestSellingDish[],
): RecapBestSellerSpotlight | null;
