// Maps entity ids to their scene views and reconciles a snapshot's entity list against
// what is currently in the scene. Keeping this seam explicit is what stops React from
// being asked to reconcile Three.js objects (PRD §13 "React responsibilities").
//
// Milestone 0 tracks owner avatars only; customers, orders, tables-with-state and workers
// register here as their stories land.

export interface EntityView<T> {
  upsert(state: T): void;
  remove(id: string): void;
  ids(): string[];
}

export class EntityViewRegistry {
  private readonly views = new Map<string, EntityView<unknown>>();

  register<T>(kind: string, view: EntityView<T>): void {
    this.views.set(kind, view as EntityView<unknown>);
  }

  /** Upsert every state in `states`, then remove any view whose id is no longer present. */
  reconcile<T extends { playerId?: string; id?: string }>(kind: string, states: T[]): void {
    const view = this.views.get(kind);
    if (!view) return;
    const present = new Set<string>();
    for (const state of states) {
      const id = state.playerId ?? state.id;
      if (!id) continue;
      present.add(id);
      view.upsert(state);
    }
    for (const id of view.ids()) {
      if (!present.has(id)) view.remove(id);
    }
  }
}
