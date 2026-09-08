export interface KitchenFocusDefinition {
  id: string;
  name: string;
  metric: string;
  direction: 'high' | 'low';
  bestUse: string;
  benefit: string;
  downside: string;
}

export declare function rankTicketsForFocus<T extends Record<string, unknown>>(
  focus: KitchenFocusDefinition | null | undefined,
  tickets: T[],
  fallbackCompare?: (a: T, b: T) => number,
): T[];
