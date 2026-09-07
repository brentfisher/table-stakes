---
id: STORY-034
title: The Service Station
status: complete
prd_source: docs/rival-restaurant-manager-command-stories.pdf pp. 6-7
---
# The Service Station
Add a dining-room command post for temporary Relief Server and Busser contracts, one service
priority, visible staff arrival, and server-accounted payroll.

## Acceptance Criteria

- [x] A service station has a clear in-world interaction prompt.
- [x] The board shows live occupancy, open and dirty tables, ready-food backlog, worker load,
      satisfaction risk, and payroll burn.
- [x] The manager can hire a Relief Server and a Busser through server-authoritative actions.
- [x] Each hire has a data-defined fee, recurring wage interval, arrival delay, maximum count,
      duration, commitment, and role-specific priorities.
- [x] Labor costs deduct server-side and appear separately from revenue in net-profit results.
- [x] Extra labor improves its relevant tasks without resolving kitchen or stock bottlenecks.
- [x] One server-authoritative dining-room priority can be selected at a time.
- [x] New staff visibly enter at the pass, occupy an assignment, show a role icon, and trigger
      an arcade confirmation.
- [x] A service-station harness demonstrates understaffed, balanced, and overstaffed cases.

## Scope

Temporary contracts are match-scoped. Relief Servers perform front-of-house service work;
Bussers clear tables only. Priority changes carry a cooldown, and releases provide no refund.
