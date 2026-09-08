// STORY-034. Match-scoped dining-room contracts and one team priority. This system owns money,
// timing, and public state; worker-system owns the bodies and their task execution.
import data from '../../../../shared/game-data/service-station.json' with { type: 'json' };

const CONTRACT_BY_ID = new Map(data.contracts.map((contract) => [contract.id, contract]));
const PRIORITY_IDS = new Set(data.priorities.map((priority) => priority.id));
const cents = (value) => Math.round(value * 100) / 100;

function ensure(match) {
  if (match._serviceStationState) return match._serviceStationState;
  const restaurants = new Map([...match.players.keys()].map((id) => [id, {
    priorityId: 'balanced', priorityCooldownEndsAtMs: 0, spent: 0, hireFees: 0, wagesPaid: 0, contracts: [], nextSequence: 1,
  }]));
  match._serviceStationState = { restaurants };
  match.serviceStation = {
    priorityFor(id) { return restaurants.get(id)?.priorityId ?? 'balanced'; },
    spentFor(id) { return restaurants.get(id)?.spent ?? 0; },
    expensesFor(id) {
      const entry = restaurants.get(id);
      return { laborExpenses: entry?.spent ?? 0, hireFees: entry?.hireFees ?? 0, wagesPaid: entry?.wagesPaid ?? 0 };
    },
    command(id, commandId) {
      const entry = restaurants.get(id);
      if (!entry) return { ok: false, reason: 'unknown_restaurant' };
      if (commandId.startsWith('priority_')) {
        const priorityId = commandId.slice('priority_'.length);
        if (!PRIORITY_IDS.has(priorityId)) return { ok: false, reason: 'unknown_priority' };
        if (match.elapsedMs < entry.priorityCooldownEndsAtMs) return { ok: false, reason: 'priority_cooldown' };
        entry.priorityId = priorityId;
        entry.priorityCooldownEndsAtMs = match.elapsedMs + data.priorityCooldownMs;
        match.logEvent?.('service_priority_changed', { restaurantId: id, priorityId });
        return { ok: true };
      }
      if (commandId.startsWith('release_')) {
        const contractId = commandId.slice('release_'.length);
        const hire = entry.contracts.find((item) => item.contractId === contractId && item.status !== 'ended');
        if (!hire) return { ok: false, reason: 'no_active_contract' };
        if (match.elapsedMs < hire.commitmentEndsAtMs) return { ok: false, reason: 'contract_committed' };
        hire.status = 'ended';
        if (hire.workerId) match.brigade?.removeTemporaryWorker(id, hire.workerId);
        return { ok: true };
      }
      if (!commandId.startsWith('hire_')) return { ok: false, reason: 'unknown_service_command' };
      const contractId = commandId.slice('hire_'.length);
      const contract = CONTRACT_BY_ID.get(contractId);
      if (!contract) return { ok: false, reason: 'unknown_contract' };
      const count = entry.contracts.filter((item) => item.contractId === contractId && item.status !== 'ended').length;
      if (count >= contract.maxCount) return { ok: false, reason: 'maximum_staff_reached' };
      if ((match.upgrades?.cashAvailable(id) ?? 0) < contract.hireFee) return { ok: false, reason: 'insufficient_cash' };
      const workerId = `temp_${contractId}_${entry.nextSequence++}`;
      entry.spent = cents(entry.spent + contract.hireFee);
      entry.hireFees = cents(entry.hireFees + contract.hireFee);
      entry.contracts.push({
        contractId, workerId, status: 'arriving', hiredAtMs: match.elapsedMs,
        arrivesAtMs: match.elapsedMs + contract.arrivalDelayMs,
        commitmentEndsAtMs: match.elapsedMs + contract.commitmentMs,
        endsAtMs: match.elapsedMs + contract.durationMs,
        nextWageAtMs: match.elapsedMs + contract.arrivalDelayMs + contract.wageIntervalMs,
      });
      match.logEvent?.('service_contract_hired', { restaurantId: id, contractId, workerId, hireFee: contract.hireFee });
      return { ok: true };
    },
    publicFor(id) {
      const entry = restaurants.get(id);
      if (!entry) return { priorityId: 'balanced', priorityCooldownForMs: 0, payrollBurn: 0, laborExpenses: 0, contracts: [] };
      return {
        priorityId: entry.priorityId,
        priorityCooldownForMs: Math.max(0, entry.priorityCooldownEndsAtMs - match.elapsedMs),
        payrollBurn: entry.contracts.filter((item) => item.status === 'active').reduce((sum, item) => sum + CONTRACT_BY_ID.get(item.contractId).wage, 0),
        laborExpenses: entry.spent,
        contracts: entry.contracts.filter((item) => item.status !== 'ended').map((item) => ({
          contractId: item.contractId, workerId: item.workerId, status: item.status,
          arrivalForMs: Math.max(0, item.arrivesAtMs - match.elapsedMs),
          activeForMs: Math.max(0, item.endsAtMs - match.elapsedMs),
          committedForMs: Math.max(0, item.commitmentEndsAtMs - match.elapsedMs),
        })),
      };
    },
  };
  return match._serviceStationState;
}

export const serviceStationSystem = {
  id: 'service_station', phases: ['service', 'final_rush'],
  update(match) {
    const state = ensure(match);
    for (const [restaurantId, entry] of state.restaurants) {
      for (const hire of entry.contracts) {
        const contract = CONTRACT_BY_ID.get(hire.contractId);
        if (hire.status === 'ended') continue;
        if (match.elapsedMs >= hire.endsAtMs) {
          hire.status = 'ended';
          match.brigade?.removeTemporaryWorker(restaurantId, hire.workerId);
          continue;
        }
        if (hire.status === 'arriving' && match.elapsedMs >= hire.arrivesAtMs) {
          hire.status = 'active';
          match.brigade?.addTemporaryWorker(restaurantId, hire.workerId, contract.role, contract.taskPriorities);
          match.logEvent?.('service_worker_arrived', { restaurantId, contractId: hire.contractId, workerId: hire.workerId });
        }
        while (hire.status === 'active' && match.elapsedMs >= hire.nextWageAtMs) {
          if ((match.upgrades?.cashAvailable(restaurantId) ?? 0) < contract.wage) {
            hire.status = 'ended';
            match.brigade?.removeTemporaryWorker(restaurantId, hire.workerId);
            break;
          }
          entry.spent = cents(entry.spent + contract.wage);
          entry.wagesPaid = cents(entry.wagesPaid + contract.wage);
          match.logEvent?.('service_wage_paid', {
            restaurantId, contractId: hire.contractId, workerId: hire.workerId,
            wage: contract.wage, wagesPaid: entry.wagesPaid,
          });
          hire.nextWageAtMs += contract.wageIntervalMs;
        }
      }
    }
  },
  onPhaseChange(match, transition) { if (transition.to === 'service') ensure(match); },
};
