---
id: STORY-033
title: The Pantry Is Open
status: complete
prd_source: docs/rival-restaurant-manager-command-stories.pdf pp. 4-5
---
# The Pantry Is Open

Give the manager service-phase control over inventory through a physical pantry decision point.
Stock risk, affected dishes, market movement, and incoming replenishment must be readable so a
shortage becomes a recoverable operational problem instead of a hidden failure.

## What ships

- A pantry or stockroom terminal beside inventory storage with a clear interaction prompt.
- A pantry board covering live ingredient counts, qualitative risk, affected dishes, blocked
  tickets, price direction, and replenishment progress.
- Deterministic market and delivery modifiers tied to the public match seed and event state.
- Plain-language explanations for material changes, such as a supplier shortage raising the
  price of lettuce.
- Four initial replenishment choices:

| Option | Benefit | Trade-off |
| --- | --- | --- |
| Standard supplier run | Normal quantity at the current market price | Medium delivery time |
| Emergency runner | Protects one critical menu item quickly | Smaller quantity at a material premium |
| Bulk delivery | Lower unit price and a larger quantity | High total spend and slow delivery |
| Priority delivery | Preferred supplier queue position | Slight premium |

Priority restock protects a promoted or high-value dish through a preferred supplier queue
position.

## Player flow

1. Walk to the pantry and open the board.
2. Read each active-menu ingredient as `STOCKED`, `WATCH`, `AT RISK`, `BLOCKING`, `EXPENSIVE`, or
   `DEAL`, together with affected dishes and likely orders remaining.
3. Choose a replenishment method and accept its cash, time, and quantity trade-off.
4. Return to the floor while delivery progress and received stock remain visible in the HUD and
   pantry world view.

## Acceptance criteria

- [x] The pantry panel covers every ingredient used by the active menu.
- [x] Each ingredient shows its count, qualitative risk, affected dishes, blocked-ticket impact,
  price direction, and a causal explanation for material market movement.
- [x] Market costs and delivery conditions are deterministic from match seed and event state and
  are public and fair to both players.
- [x] The player can place standard, emergency, and bulk restock orders during service.
- [x] Cash, availability, phase, stock rules, and order constraints validate server-side.
- [x] Emergency replenishment is materially faster and materially more expensive than planned
  replenishment.
- [x] A shortage alert identifies both the missing ingredient and the impacted dishes.
- [x] Inventory cost, stock orders, and shortages are recorded for results and telemetry.
- [x] The automatic-restock abstraction is removed, disabled, or explicitly narrowed when manual
  live purchasing ships.
- [x] A pantry harness covers low stock, active shortage, price spike, emergency order, bulk
  order, and delivery delay.

## Scope

This story adds bounded live purchasing without opening unrestricted mid-service menu editing.
All products and market modifiers belong in shared data, while prices, delivery timing, cash,
stock, and receipt remain server-authoritative.
