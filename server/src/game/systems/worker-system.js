// The two bodies on the floor. PRD §7 "Staffing setup" (1 cook, 1 server, 1 owner-player) and
// PRD §17 "Worker AI system", which gives both priority lists verbatim.
//
// Registered against `simulation-loop.js` per Decision 15 — one new file plus one line in
// `systems/index.js`. NOTHING IN `match.js` CHANGES.
//
// ============================================================================================
// THE RULES ARE A LIST, NOT A SCORE
// ============================================================================================
// PRD §17's first sentence about workers is "Workers need simple, explainable rules", and then
// it prints two numbered lists. `selectCookTask` and `selectServerTask` below are those lists,
// in that order, as an `if` chain you can read top to bottom and match line-for-line against the
// PRD. There is deliberately NO weighted score anywhere in this file — a heuristic that happened
// to behave the same way could not answer "why is the server clearing table 3 while a plate goes
// cold", and answering that question is the whole design requirement.
//
// DISTANCE IS NOT AN INPUT TO EITHER LIST. §17 never mentions it, so a nearer low-priority job
// never beats a further high-priority one. Distance is a COST the worker then pays: a task is
// travel-then-work, the travel is integrated per tick from `WORKER_MOVE_SPEED` and the real
// distance, and that is what makes "a server across the room is genuinely slower to deliver"
// true rather than asserted.
//
// ============================================================================================
// WHAT THE WORKERS TOOK OVER, AND WHAT STAYED ABSTRACTED
// ============================================================================================
// Before this story the restaurant ran itself through four stand-ins. Three of them are now
// bodies, and each is switched by a `match.brigade?.owns*()` question the owning system asks
// defensively — so with no worker system registered every one of those systems behaves exactly
// as it did before, which is what keeps the other check scripts honest rather than lucky.
//
//   ORDER_PASS_HANDOFF_MS      the plate that teleported to the table  ->  the SERVER carries it
//   CUSTOMER_SEATED_GREET_MS   the party greeted by nobody             ->  the SERVER greets
//   CUSTOMER_PAYING_MS         the bill settled by nobody              ->  the SERVER collects
//   automatic seating          the party that walked itself to a table ->  the SERVER seats it
//   INVENTORY_AUTO_RESTOCK     perfect knowledge, no walk              ->  the COOK walks
//
// Dirty tables did not exist at all — every table was permanently clean — so §17 server rule 4
// had nothing to act on. `customer-system.js` now soils a table when a party leaves it and
// refuses to seat anybody there until it is cleared. That is the one genuinely new piece of
// restaurant state this story adds, and it is added because a priority list with an
// unimplementable rule in the middle of it is not the priority list §17 specifies.
//
// STILL ABSTRACTED, on purpose:
//   - THE HOST. PRD §7: "1 cook, 1 server, 1 owner-player. Abstract host behavior or automatic
//     seating." `restaurant-layout.json` rosters no host and gives `server_1` the `host_stand`
//     post, so "abstract the host" means there is no host WORKER — not that nobody walks a party
//     to a table. Seating is the server's, exactly as §17's list says.
//   - STATION CONCURRENCY. `STATION_CONCURRENCY` stays what it always was: how many tickets a
//     station can have going at once, which is equipment, not hands. The cook LOADS a station
//     (`tend_station`, ~800ms at the rail) and the station then cooks on its own `stationSteps`
//     clock. Making one cook be all three pairs of prep hands would have collapsed STORY-005's
//     measured §24 kitchen balance into a queue nobody could clear, and would have made
//     `STATION_CONCURRENCY` — the dial PRD §10's upgrade table turns — meaningless.
//   - THE OTHER THREE STATIONS. §17 cook rule 2 says "highest urgency ticket at ASSIGNED
//     station", so the cook's gate is scoped to the one station `staffAssignments` posted it to;
//     the rest keep auto-dispatching, which is §7's "may be abstracted initially" for the prep
//     worker the MVP does not roster. This is what makes the assignment a real strategic choice
//     rather than a label: posting the cook to `grill` in `stadium_district` (the station
//     STORY-005 measured at 78-87% busy) is a different restaurant from posting it to `prep`.
//
// ============================================================================================
// SEAMS
// ============================================================================================
// This system talks to two facades and publishes one:
//
//   match.kitchen   (order-system.js)     queuedTicketsAt / startTicket / readyOrders /
//                                         deliverOrder / stationHasCapacity
//   match.floor     (customer-system.js)  waitingParties / seatParty / partiesToGreet /
//                                         takeOrderFrom / dirtyTables / clearTable /
//                                         partiesAwaitingPayment / collectPayment
//   match.pantry    (inventory-system.js) binShortfalls / restockSlotFree / requestRestock
//
//   match.brigade   published here        the `owns*()` questions those systems ask before
//                                         falling back to their abstraction.
//
// Nothing here reads another system's internals, and no ticket, party or bin object crosses a
// facade — only ids, positions and the two numbers §17's rules actually rank on.

import layout from '../../../../shared/game-data/restaurant-layout.json' with { type: 'json' };
import {
  OWNER_TASK_SPEED_ADVANTAGE,
  WORKER_ARRIVAL_EPSILON,
  WORKER_MOVE_SPEED,
  WORKER_RESTOCK_THRESHOLD_UNITS,
  WORKER_RNG_STREAM,
  WORKER_TASK_DURATIONS_MS,
  WORKER_TASK_JITTER,
  WORKER_TASK_NEAR_COMPLETION_FRACTION,
  WORKER_TICKET_URGENCY_BUCKET_MS,
} from '../../../../shared/constants/tuning.js';

// --- the layout, read once ----------------------------------------------------------------------

const ENTITY_BY_ID = new Map(layout.entities.map((entity) => [entity.id, entity]));
const POST_BY_ID = new Map((layout.staff?.posts ?? []).map((post) => [post.id, post]));
const ROSTER = Object.freeze(layout.staff?.roster ?? []);

const vec = ([x, y, z]) => ({ x, y, z });

function zoneCentre(zoneId) {
  const zone = layout.zones.find((z) => z.id === zoneId);
  if (!zone) return vec(layout.spawn.owner);
  return { x: (zone.min[0] + zone.max[0]) / 2, y: 0, z: (zone.min[1] + zone.max[1]) / 2 };
}

/** Where a worker stands when it has nothing to do — §17 server rule 6, "idle near service area",
 * and the cook's own rail. Always a real place on the floor, never an origin. */
function postPosition(post) {
  if (post?.entityId && ENTITY_BY_ID.has(post.entityId)) {
    return vec(ENTITY_BY_ID.get(post.entityId).position);
  }
  if (post?.zoneId) return zoneCentre(post.zoneId);
  return vec(layout.spawn.owner);
}

const STATION_POSITION = new Map(
  layout.entities
    .filter((entity) => entity.type === 'station')
    .map((entity) => [entity.station, vec(entity.position)]),
);
const SERVICE_PASS_POSITION = vec(
  (ENTITY_BY_ID.get('service_pass') ?? { position: layout.spawn.owner }).position,
);
const PANTRY_POSITION = vec((ENTITY_BY_ID.get('pantry') ?? { position: layout.spawn.owner }).position);

const distance = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);

// --- per-match state ------------------------------------------------------------------------------
//
// Attached dynamically to the match, exactly as customer-system.js, order-system.js and
// inventory-system.js do: match.js knows nothing about workers, and a match that never reaches
// `service` never gets this property at all.

/**
 * PRD §7 item 5, "Worker station assignments", honoured. A submission names a post per rostered
 * worker and `setup-validator.js` has already refused an unknown worker or a post that worker
 * cannot hold — so the only case left here is a submission that predates the roster or was built
 * by hand, and the fallback is the worker's own first legal post rather than a crash.
 */
function resolvePost(entry, staffAssignments) {
  const requested = staffAssignments?.[entry.id] ?? null;
  const honoured = typeof requested === 'string' && entry.posts.includes(requested);
  const postId = honoured ? requested : entry.posts[0];
  return { postId, post: POST_BY_ID.get(postId) ?? null, honoured, requested };
}

function buildWorker(entry, staffAssignments) {
  const { postId, post, honoured, requested } = resolvePost(entry, staffAssignments);
  const home = postPosition(post);
  return {
    workerId: entry.id,
    role: entry.role,
    post: postId,
    /** The kitchen station this cook is posted to, or null for a front-of-house post. THE scope
     * of §17 cook rule 2's "assigned station". */
    station: post?.station ?? null,
    home,
    position: { ...home },
    task: null,
    needsHelp: null,
    assignmentHonoured: honoured,
    requestedPost: requested,
    // Instrumentation for the §24 balance run — never serialized, never gameplay.
    travelMs: 0,
    workMs: 0,
    idleMs: 0,
    helpMs: 0,
  };
}

/** An empty per-kind counter, so a kind that never happened reads 0 rather than missing. */
const zeroByKind = () => ({
  tend_station: 0,
  deliver_order: 0,
  seat_party: 0,
  take_order: 0,
  clear_table: 0,
  collect_payment: 0,
});

function buildStaff(player) {
  return {
    restaurantId: player.playerId,
    playerId: player.playerId,
    workers: ROSTER.map((entry) => buildWorker(entry, player.setup?.staffAssignments)),
    /**
     * PRD §24: "Automated staff should complete approximately 60-75% of routine work."
     *
     * THE DENOMINATOR IS WORK THE RESTAURANT NEEDED, NOT WORK IT GOT ROUND TO CREATING. That
     * distinction is the whole of why this counter is shaped the way it is, and it was chosen
     * after measuring the obvious alternative and finding it dishonest:
     *
     *   Counting only items that actually became observable makes a COLLAPSING restaurant look
     *   excellent. A party nobody seats abandons the queue and never generates an order, a plate,
     *   a bill or a dirty table — so a server that seats eight parties out of forty and serves
     *   those eight perfectly scores ~95%, and a server that keeps up with all forty scores about
     *   the same. A ratio that cannot tell those two apart is not measuring anything.
     *
     * So: every party that CHOSE this restaurant requires the five front-of-house touches §17's
     * server list names — seat, take the order, run the plate, take the money, wipe the table —
     * whether or not it ever got them, plus one `tend_station` load per ticket that reached the
     * cook's own station. Nothing is speculative: `partiesChosen` is counted, not modelled, and
     * five is the length of §17's own list.
     *
     * WHAT IS EXCLUDED, and why:
     *   - tickets at the three stations no cook is posted to. Those are auto-dispatched by
     *     `order-system.js`; counting an abstraction's output as staff work would inflate the
     *     share with work no body did.
     *   - restock trips. A bin below a threshold is a standing condition, not a discrete job that
     *     is either done or missed, so counting it would put a number with no honest denominator
     *     into the ratio. Trips are reported separately instead.
     *
     * The per-kind `created` counters are kept alongside, because "which of the five the server
     * never got to" is the interesting half of the answer and the ratio alone hides it.
     */
    work: {
      seen: new Set(),
      /** Parties that picked this restaurant and queued at its door. THE denominator's base. */
      partiesChosen: 0,
      created: zeroByKind(),
      completed: zeroByKind(),
      restockTrips: 0,
      restockRefusals: 0,
      helpSignals: 0,
    },
  };
}

function ensureState(match) {
  if (!match._workerSimState) {
    const state = {
      rng: match.createRngStream(WORKER_RNG_STREAM),
      restaurants: new Map(),
    };
    for (const player of match.players.values()) {
      state.restaurants.set(player.playerId, buildStaff(player));
    }
    match._workerSimState = state;
    match.brigade = createBrigadeFacade(state);
  }
  return match._workerSimState;
}

// --- tasks ------------------------------------------------------------------------------------------

/**
 * How long the hands take once they are there. Jitter comes from this match's own named RNG
 * sub-stream (Decision 18), so a worker is a person rather than a metronome and the match still
 * replays exactly from its seed. Travel is never jittered — that is geometry, not a person.
 */
function workDuration(state, kind) {
  const base = WORKER_TASK_DURATIONS_MS[kind];
  if (!Number.isFinite(base)) return 0;
  return Math.max(1, Math.round(base * (1 + (state.rng() * 2 - 1) * WORKER_TASK_JITTER)));
}

/**
 * @param {object} spec
 * @param {string} spec.kind      a WorkerTaskKind
 * @param {string} spec.itemId    the routine-work item this completes, or null for a restock
 * @param {string} spec.targetId  the ticket/order/party/table being worked
 * @param {Array<{x,y,z}>} spec.route  waypoints walked in order; work happens at the last one
 */
function makeTask({ kind, itemId, targetId, station = null, route, workMs, urgency = 0 }) {
  return {
    kind,
    itemId,
    targetId,
    station,
    route,
    legIndex: 0,
    phase: 'travel',
    workMs,
    remainingMs: workMs,
    urgency,
  };
}

const taskDestination = (task) => task.route[Math.min(task.legIndex, task.route.length - 1)];

/** PRD §17 cook rule 1's test, as a predicate: this much or less of the work left and the hands
 * are not taken off it, however urgent the ticket that just landed. */
function nearCompletion(task) {
  if (task.phase !== 'work' || task.workMs <= 0) return false;
  return task.remainingMs <= task.workMs * WORKER_TASK_NEAR_COMPLETION_FRACTION;
}

// --- PRD §17, the cook's list ---------------------------------------------------------------------

/**
 * Rule 2's urgency, and rule 3's tie-break, kept as two separate keys because §17 prints them as
 * two separate lines.
 *
 *   rule 2  how long the ticket has waited at the station, in `WORKER_TICKET_URGENCY_BUCKET_MS`
 *           buckets. Tickets queued within one bucket of each other are as urgent as each other —
 *           which is what a person looking at the rail would say, and what leaves rule 3
 *           something to decide.
 *   rule 3  among those, the ticket whose ORDER has the least patience left.
 *   then    ticket id, so the choice is reproducible rather than dependent on arrival luck.
 */
function urgencyBucket(ticket) {
  return Math.floor(ticket.queueAgeMs / WORKER_TICKET_URGENCY_BUCKET_MS);
}

function compareTickets(a, b) {
  const bucketDelta = urgencyBucket(b) - urgencyBucket(a);
  if (bucketDelta !== 0) return bucketDelta; // rule 2: older bucket first
  if (b.patienceRisk !== a.patienceRisk) return b.patienceRisk - a.patienceRisk; // rule 3
  return a.ticketId < b.ticketId ? -1 : a.ticketId > b.ticketId ? 1 : 0;
}

/** A queued ticket the cook already tried and could not start, whose blocker is STILL short. It
 * is skipped rather than retried every tick; the moment the bin refills the shortage clears and
 * the ticket becomes selectable again. */
function isBlockedNow(shortages, ticket) {
  if (!ticket.blockedByIngredientId) return false;
  return shortages.some(
    (s) => s.station === ticket.station && s.ingredientId === ticket.blockedByIngredientId,
  );
}

/** Bins worth a pantry trip, emptiest first — §17 cook rule 4's shopping list. Across every
 * station, not just the cook's own: rule 4 is "prep/restock", which is work for the restaurant,
 * while rule 2's "assigned station" scopes only which TICKETS are the cook's. */
function restockCandidates(match, restaurantId) {
  if (!match.pantry?.restockSlotFree(restaurantId)) return [];
  const shortfalls = match.pantry.binShortfalls(restaurantId);
  return shortfalls
    .filter((b) => b.binLevel <= WORKER_RESTOCK_THRESHOLD_UNITS && b.pantryUnits > 0 && !b.restocking)
    .sort((a, b) => a.binLevel - b.binLevel);
}

function selectCookTask(match, state, staff, worker) {
  const kitchen = match.kitchen;
  const restaurantId = staff.restaurantId;
  const shortages = match.pantry?.shortagesFor(restaurantId) ?? [];

  // §17 cook rules 2 and 3 — the highest-urgency startable ticket at the ASSIGNED station.
  if (kitchen && worker.station && kitchen.stationHasCapacity(restaurantId, worker.station)) {
    const startable = kitchen
      .queuedTicketsAt(restaurantId, worker.station)
      .filter((ticket) => !isBlockedNow(shortages, ticket));
    if (startable.length > 0) {
      const best = startable.sort(compareTickets)[0];
      return makeTask({
        kind: 'tend_station',
        itemId: workItemId('tend_station', `${best.ticketId}:${worker.station}`),
        targetId: best.ticketId,
        station: worker.station,
        route: [STATION_POSITION.get(worker.station) ?? worker.home],
        workMs: workDuration(state, 'tend_station'),
        // Rule 1 compares like with like: a ticket only takes the hands off another if it is
        // strictly more urgent by the same two keys that chose it.
        urgency: urgencyBucket(best) + best.patienceRisk,
      });
    }
  }

  // §17 cook rule 4 — "if no order exists, perform low-priority prep/restock". The duration is
  // whatever `requestRestock()` will return, so it is sampled on arrival at the pantry, not here.
  const [bin] = restockCandidates(match, restaurantId);
  if (bin) {
    return makeTask({
      kind: 'restock',
      itemId: null, // see `buildStaff().work` for why restocks are reported, not ratioed
      targetId: bin.ingredientId,
      station: bin.station,
      route: [PANTRY_POSITION],
      workMs: 0, // set when the cook gets there and the pantry quotes the trip
    });
  }

  return null;
}

/**
 * PRD §17 cook rule 5, "If blocked, emit a visible 'needs help' signal".
 *
 * Read as a STATE rather than as a sixth thing to do: rules 1-4 decide what the hands are on, and
 * this decides whether the cook is also standing there unable to move the rail. A cook that is
 * away carrying somebody else's ingredients while its own station is blocked is exactly when the
 * owner most needs to see the signal, and a rule that only fired when the cook was doing nothing
 * would go dark at that moment.
 *
 * BLOCKED means: tickets are queued at the assigned station, every one of them is held by an
 * empty bin, no restock for any of those ingredients is on its way, and the cook cannot start one
 * — the pantry is out, or the restaurant's one pair of carrying hands is already committed. Help
 * is then genuinely the only thing that fixes it, which is the difference between this and idle.
 */
function cookHelpSignal(match, staff, worker) {
  const kitchen = match.kitchen;
  if (!kitchen || !worker.station) return null;
  const restaurantId = staff.restaurantId;
  const shortages = match.pantry?.shortagesFor(restaurantId) ?? [];

  const queued = kitchen.queuedTicketsAt(restaurantId, worker.station);
  if (queued.length === 0) return null;
  if (queued.some((ticket) => !isBlockedNow(shortages, ticket))) return null; // something is startable

  const blockers = [...new Set(queued.map((t) => t.blockedByIngredientId).filter(Boolean))];
  if (blockers.length === 0) return null;

  const slotFree = match.pantry?.restockSlotFree(restaurantId) ?? false;
  for (const s of shortages) {
    if (s.station !== worker.station || !blockers.includes(s.ingredientId)) continue;
    if (s.restocking) return null; // already on its way
  }
  if (slotFree) {
    const fixable = restockCandidates(match, restaurantId).some(
      (b) => b.station === worker.station && blockers.includes(b.ingredientId),
    );
    if (fixable) return null; // rule 4 will handle it on the next selection
  }

  return { reason: 'blocked_on_ingredients', station: worker.station, ingredientId: blockers[0] };
}

// --- PRD §17, the server's list ---------------------------------------------------------------------

function selectServerTask(match, state, staff) {
  const restaurantId = staff.restaurantId;
  const kitchen = match.kitchen;
  const floor = match.floor;

  // 1. Deliver food that is ready. The oldest plate on the pass first — it is the one losing
  //    freshness fastest, which is the only thing §17 order quality scores a wait on.
  const [plate] = kitchen?.readyOrders(restaurantId) ?? [];
  if (plate) {
    const table = floor?.tablePositionOf(restaurantId, plate.tableId) ?? SERVICE_PASS_POSITION;
    return makeTask({
      kind: 'deliver_order',
      itemId: workItemId('deliver_order', plate.orderId),
      targetId: plate.orderId,
      // Two legs, because a plate does not arrive by itself: to the pass, then to the table.
      route: [SERVICE_PASS_POSITION, table],
      workMs: workDuration(state, 'deliver_order'),
    });
  }

  // 2. Seat a waiting party if a table is available.
  for (const party of floor?.waitingParties(restaurantId) ?? []) {
    if (!floor.hasTableFor(restaurantId, party.partySize)) continue;
    return makeTask({
      kind: 'seat_party',
      itemId: workItemId('seat_party', party.customerId),
      targetId: party.customerId,
      route: [floor.queuePosition()],
      workMs: workDuration(state, 'seat_party'),
    });
  }

  // 3. Take an order from a newly seated party.
  const [seated] = floor?.partiesToGreet(restaurantId) ?? [];
  if (seated) {
    return makeTask({
      kind: 'take_order',
      itemId: workItemId('take_order', seated.customerId),
      targetId: seated.customerId,
      route: [floor.tablePositionOf(restaurantId, seated.tableId) ?? SERVICE_PASS_POSITION],
      workMs: workDuration(state, 'take_order'),
    });
  }

  // 4. Clear a dirty table.
  const [dirty] = floor?.dirtyTables(restaurantId) ?? [];
  if (dirty) {
    return makeTask({
      kind: 'clear_table',
      itemId: workItemId('clear_table', `${dirty.tableId}:${dirty.soilCount}`),
      targetId: dirty.tableId,
      route: [dirty.position],
      workMs: workDuration(state, 'clear_table'),
    });
  }

  // 5. Handle payment.
  const [paying] = floor?.partiesAwaitingPayment(restaurantId) ?? [];
  if (paying) {
    return makeTask({
      kind: 'collect_payment',
      itemId: workItemId('collect_payment', paying.customerId),
      targetId: paying.customerId,
      route: [floor.tablePositionOf(restaurantId, paying.tableId) ?? SERVICE_PASS_POSITION],
      workMs: workDuration(state, 'collect_payment'),
    });
  }

  // 6. Idle near the service area — no task, and `advanceWorker` walks it home to its post.
  return null;
}

// --- routine-work accounting --------------------------------------------------------------------

const workItemId = (kind, key) => `${kind}:${key}`;

/** Register every item that is observable right now. Idempotent by construction: an id already in
 * `seen` is not a new job, it is the same job still waiting. */
function registerAvailableWork(match, staff) {
  const { work } = staff;
  const restaurantId = staff.restaurantId;
  const add = (kind, key) => {
    const id = workItemId(kind, key);
    if (work.seen.has(id)) return false;
    work.seen.add(id);
    work.created[kind] += 1;
    return true;
  };

  for (const worker of staff.workers) {
    if (worker.role !== 'cook' || !worker.station) continue;
    for (const ticket of match.kitchen?.queuedTicketsAt(restaurantId, worker.station) ?? []) {
      add('tend_station', `${ticket.ticketId}:${worker.station}`);
    }
  }
  if (staff.workers.some((w) => w.role === 'server')) {
    for (const plate of match.kitchen?.readyOrders(restaurantId) ?? []) add('deliver_order', plate.orderId);
    for (const party of match.floor?.waitingParties(restaurantId) ?? []) {
      // A party at the door is a party this restaurant owes the whole §17 server list to.
      if (add('seat_party', party.customerId)) work.partiesChosen += 1;
    }
    for (const party of match.floor?.partiesToGreet(restaurantId) ?? []) add('take_order', party.customerId);
    for (const table of match.floor?.dirtyTables(restaurantId) ?? []) {
      add('clear_table', `${table.tableId}:${table.soilCount}`);
    }
    for (const party of match.floor?.partiesAwaitingPayment(restaurantId) ?? []) {
      add('collect_payment', party.customerId);
    }
  }
}

/** The five front-of-house touches PRD §17's server list names, per party. */
export const FOH_TOUCHES_PER_PARTY = 5;

/** PRD §24's figure, computed the same way everywhere it is printed or asserted. */
export function routineWorkShare(work) {
  const required = FOH_TOUCHES_PER_PARTY * work.partiesChosen + work.created.tend_station;
  const completed = Object.values(work.completed).reduce((sum, n) => sum + n, 0);
  return { required, completed, share: required > 0 ? completed / required : 0 };
}

// --- doing the work ---------------------------------------------------------------------------------

/** The effect of a finished task. Every one of these is a facade call — this file changes no
 * ticket, party, table or bin itself. Returns true when the routine-work item was completed. */
function completeTask(match, staff, worker, task) {
  const restaurantId = staff.restaurantId;

  switch (task.kind) {
    case 'tend_station': {
      const result = match.kitchen?.startTicket(restaurantId, task.targetId) ?? { ok: false };
      // A `blocked` refusal is what stamps `blockedByIngredientId` on the ticket, which is how
      // the cook learns not to keep picking it and how rule 5 learns what is missing.
      return result.ok === true;
    }
    case 'restock': {
      // The trip was quoted and started when the cook reached the pantry; the units are already
      // walking. `INVENTORY_RESTOCK_TRAVEL_MS` is the carry BACK, so the cook finishes standing
      // at the bin it filled rather than at the pantry door — one walk, counted once.
      if (task.station && STATION_POSITION.has(task.station)) {
        worker.position = { ...STATION_POSITION.get(task.station) };
      }
      return false;
    }
    case 'deliver_order':
      return match.kitchen?.deliverOrder(task.targetId) === true;
    case 'seat_party':
      return (match.floor?.seatParty(task.targetId) ?? {}).ok === true;
    case 'take_order':
      return (match.floor?.takeOrderFrom(task.targetId) ?? {}).ok === true;
    case 'clear_table':
      return (match.floor?.clearTable(restaurantId, task.targetId) ?? {}).ok === true;
    case 'collect_payment':
      return (match.floor?.collectPayment(task.targetId) ?? {}).ok === true;
    default:
      return false;
  }
}

/**
 * A restock is the one task whose duration is not this story's to invent: the cook walks to the
 * pantry, and what the trip costs is whatever STORY-006's model quotes for it. Called the instant
 * the cook arrives, so an ingredient that stopped being worth carrying while the cook was walking
 * simply drops the task.
 */
function beginRestockAtPantry(match, staff, worker, task) {
  const result = match.pantry?.requestRestock(staff.restaurantId, task.station, task.targetId) ?? {
    ok: false,
    reason: 'no_pantry',
  };
  if (!result.ok) {
    staff.work.restockRefusals += 1;
    worker.task = null;
    return;
  }
  staff.work.restockTrips += 1;
  task.workMs = result.durationMs;
  task.remainingMs = result.durationMs;
}

/** Walk, then work. Travel is integrated against the real distance every tick, which is the whole
 * of "travel time counts against their task". */
function advanceWorker(match, staff, worker, dtMs) {
  const task = worker.task;

  if (!task) {
    worker.idleMs += dtMs;
    stepToward(worker, worker.home, dtMs);
    return;
  }

  if (task.phase === 'travel') {
    worker.travelMs += dtMs;
    const arrived = stepToward(worker, taskDestination(task), dtMs);
    if (!arrived) return;
    if (task.legIndex < task.route.length - 1) {
      task.legIndex += 1;
      return;
    }
    task.phase = 'work';
    if (task.kind === 'restock') beginRestockAtPantry(match, staff, worker, task);
    return;
  }

  worker.workMs += dtMs;
  task.remainingMs -= dtMs;
  if (task.remainingMs > 0) return;

  const completed = completeTask(match, staff, worker, task);
  if (completed && task.itemId && staff.work.seen.has(task.itemId)) {
    staff.work.completed[task.kind] += 1;
  }
  worker.task = null;
}

/** Move `worker` toward `target` at `WORKER_MOVE_SPEED`; true once it is there. */
function stepToward(worker, target, dtMs) {
  const dx = target.x - worker.position.x;
  const dz = target.z - worker.position.z;
  const remaining = Math.hypot(dx, dz);
  if (remaining <= WORKER_ARRIVAL_EPSILON) {
    worker.position.x = target.x;
    worker.position.z = target.z;
    return true;
  }
  const stride = WORKER_MOVE_SPEED * (dtMs / 1000);
  if (stride >= remaining) {
    worker.position.x = target.x;
    worker.position.z = target.z;
    return true;
  }
  worker.position.x += (dx / remaining) * stride;
  worker.position.z += (dz / remaining) * stride;
  return false;
}

/**
 * One worker's decision for this tick, in §17's own order.
 *
 * PRD §17 cook rule 1, "Continue current task if near completion", is the only pre-emption rule
 * either list has, and it is the reason this is not simply "pick a task when idle": a cook halfway
 * through loading a ticket may be pulled off it by a more urgent one, and a cook nearly finished
 * may not. The server has no such rule and is never pre-empted — a body carrying a plate does not
 * put it down.
 */
function decide(match, state, staff, worker) {
  if (worker.role === 'cook') {
    worker.needsHelp = cookHelpSignal(match, staff, worker);
    if (worker.needsHelp) staff.work.helpSignals += 1;

    const current = worker.task;
    if (current && nearCompletion(current)) return; // rule 1
    const candidate = selectCookTask(match, state, staff, worker);
    if (!candidate) return; // keep whatever it is on; nothing better exists
    if (!current) {
      worker.task = candidate;
      return;
    }
    if (candidate.targetId === current.targetId && candidate.kind === current.kind) return;
    // A restock is never worth abandoning a ticket for, and a ticket is only worth abandoning
    // another ticket for when it is strictly more urgent by rules 2 and 3.
    if (current.kind === 'tend_station' && candidate.kind !== 'tend_station') return;
    if (candidate.urgency > current.urgency) worker.task = candidate;
    return;
  }

  if (worker.task) return; // the server finishes what it picked up
  worker.task = selectServerTask(match, state, staff);
}

// --- the facade the kitchen and the floor ask ------------------------------------------------------

function createBrigadeFacade(state) {
  const staffOf = (restaurantId) => state.restaurants.get(restaurantId) ?? null;
  const hasRole = (restaurantId, role) =>
    (staffOf(restaurantId)?.workers ?? []).some((w) => w.role === role);

  return {
    /** True when a cook is posted to this station, so `order-system.js` must not auto-dispatch
     * it out from under them. */
    ownsStation(restaurantId, station) {
      return (staffOf(restaurantId)?.workers ?? []).some(
        (w) => w.role === 'cook' && w.station === station,
      );
    },

    // The server's five §17 duties. All five turn on the same fact — this restaurant has a
    // server on the floor — but they are named separately so a story that rosters a host, or
    // takes a duty away, changes one line rather than reinterpreting a boolean.
    ownsDelivery(restaurantId) {
      return hasRole(restaurantId, 'server');
    },
    ownsSeating(restaurantId) {
      if (process.env.WK_NO_SEAT) return false;
      return hasRole(restaurantId, 'server');
    },
    ownsOrderTaking(restaurantId) {
      if (process.env.WK_NO_ORDER) return false;
      return hasRole(restaurantId, 'server');
    },
    ownsPayment(restaurantId) {
      if (process.env.WK_NO_PAY) return false;
      return hasRole(restaurantId, 'server');
    },
    ownsTableClearing(restaurantId) {
      return hasRole(restaurantId, 'server');
    },

    /** PRD §17's owner differential, exposed as one number so STORY-008 reads it from here rather
     * than importing tuning separately and drifting. */
    ownerSpeedAdvantage() {
      return OWNER_TASK_SPEED_ADVANTAGE;
    },

    /** The §24 routine-work figure for one restaurant, as a copy. */
    routineWorkFor(restaurantId) {
      const staff = staffOf(restaurantId);
      if (!staff) return null;
      return {
        ...routineWorkShare(staff.work),
        partiesChosen: staff.work.partiesChosen,
        created: { ...staff.work.created },
        completed: { ...staff.work.completed },
        restockTrips: staff.work.restockTrips,
        restockRefusals: staff.work.restockRefusals,
        helpSignals: staff.work.helpSignals,
      };
    },

    /** Server-side worker records for one restaurant, as copies. */
    workersOf(restaurantId) {
      return (staffOf(restaurantId)?.workers ?? []).map((w) => ({ ...w, position: { ...w.position } }));
    },
  };
}

// --- the public projection — the ONLY function allowed to shape restaurants[].workers -------------

/**
 * PRD §14 "Worker role icon" and "Workers display current jobs". An explicit allowlist, like every
 * other projection in this repo: the internal worker holds instrumentation counters and a route,
 * and neither belongs on the wire.
 *
 * `needsHelp` is a separate field from `task`/`busy` on purpose — §17 rule 5's signal has to be
 * distinguishable from a worker who simply has nothing to do, or STORY-015 cannot rank it as an
 * alert and STORY-016 cannot colour it.
 */
function toPublicWorkerSnapshot(worker) {
  return {
    workerId: worker.workerId,
    role: worker.role,
    post: worker.post,
    position: {
      x: Number(worker.position.x.toFixed(3)),
      y: worker.position.y,
      z: Number(worker.position.z.toFixed(3)),
    },
    busy: worker.task !== null,
    task: worker.task
      ? {
          kind: worker.task.kind,
          phase: worker.task.phase,
          targetId: worker.task.targetId,
          station: worker.task.station,
          remainingMs: Math.max(0, Math.round(worker.task.remainingMs)),
        }
      : null,
    needsHelp: worker.needsHelp ? { ...worker.needsHelp } : null,
  };
}

// --- the system ---------------------------------------------------------------------------------------

export const workerSystem = {
  id: 'workers',
  phases: ['service', 'final_rush'],

  update(match, dtMs) {
    const state = ensureState(match);

    for (const staff of state.restaurants.values()) {
      registerAvailableWork(match, staff);
      for (const worker of staff.workers) {
        decide(match, state, staff, worker);
        if (worker.needsHelp) worker.helpMs += dtMs;
        advanceWorker(match, staff, worker, dtMs);
      }
    }

    // `customer-system.js` reassigns `match.restaurants` wholesale during its own update, and
    // `inventory-system.js` decorates it after that — which is why this system is registered
    // LAST. Decoration, not construction: the entries are the district's and this adds one field.
    for (const restaurant of match.restaurants ?? []) {
      const staff = state.restaurants.get(restaurant.restaurantId);
      restaurant.workers = staff ? staff.workers.map(toPublicWorkerSnapshot) : [];
    }
  },

  onPhaseChange(match, transition) {
    if (transition.to === 'service') {
      // `match.brigade` must exist before `customer-system.js` and `order-system.js` first tick
      // in service, or their opening tick would run the abstractions this story replaced. The
      // loop runs every system's onPhaseChange before any update, so this is a guarantee.
      ensureState(match);
      for (const staff of match._workerSimState.restaurants.values()) {
        for (const worker of staff.workers) {
          if (worker.assignmentHonoured) continue;
          console.log(
            `[workers] ${match.id} ${staff.restaurantId} ${worker.workerId}: no legal post in ` +
              `staffAssignments (got ${JSON.stringify(worker.requestedPost)}) — posted to ` +
              `"${worker.post}"`,
          );
        }
      }
      return;
    }
    if (transition.to !== 'results') return;
    if (!match._workerSimState) return;

    // PRD §24's balance figure, in the dev log, per restaurant — the acceptance criterion is that
    // it can be tuned against, and a number nobody prints cannot be.
    for (const staff of match._workerSimState.restaurants.values()) {
      const { required, completed, share } = routineWorkShare(staff.work);
      const perKind = Object.keys(staff.work.created)
        .filter((kind) => staff.work.created[kind] > 0)
        .map((kind) => `${kind}=${staff.work.completed[kind]}/${staff.work.created[kind]}`)
        .join(' ');
      const posts = staff.workers.map((w) => `${w.role}@${w.post}`).join(' ');
      console.log(
        `[workers] ${match.id} ${staff.restaurantId} routine work ${completed}/${required} ` +
          `= ${(share * 100).toFixed(1)}% (PRD §24 target 60-75%) — ${perKind} ` +
          `restockTrips=${staff.work.restockTrips} helpTicks=${staff.work.helpSignals} ` +
          `posts=[${posts}]`,
      );
    }

    match.brigade = undefined;
    match._workerSimState = undefined;
  },
};

/**
 * Exported for scripts/check-workers.mjs ONLY — not part of the system's contract, and no other
 * system or route may import it. Decision 8: the repo has no test framework, so a runnable script
 * is the only way to force a specific branch (a blocked cook, two equally-old tickets, a server
 * standing next to a dirty table with a plate going cold) deterministically rather than hoping a
 * seeded run produces one.
 */
export const _internal = {
  ensureState,
  buildStaff,
  buildWorker,
  resolvePost,
  selectCookTask,
  selectServerTask,
  cookHelpSignal,
  compareTickets,
  urgencyBucket,
  nearCompletion,
  decide,
  advanceWorker,
  stepToward,
  registerAvailableWork,
  restockCandidates,
  toPublicWorkerSnapshot,
  postPosition,
  workItemId,
  STATION_POSITION,
  SERVICE_PASS_POSITION,
  PANTRY_POSITION,
  ROSTER,
};
