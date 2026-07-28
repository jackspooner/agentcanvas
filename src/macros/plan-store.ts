import { MacroError } from './errors.js';
import { deepFreeze } from './canonical-json.js';
import { MACRO_PLAN_TTL_MS } from './definition.js';
import type { MacroPlan } from './types.js';

interface StoredPlan {
  plan: MacroPlan;
  sequence: number;
}

export interface MacroPlanStoreOptions {
  maxPlans?: number;
  now?: () => number;
}

export class InMemoryMacroPlanStore {
  private readonly plans = new Map<string, StoredPlan>();
  private readonly expired = new Map<string, number>();
  private readonly maxPlans: number;
  private readonly ttlMs: number;
  private sequence = 0;
  private readonly clock: () => number;

  constructor(options: MacroPlanStoreOptions = {}) {
    this.maxPlans = options.maxPlans ?? 500;
    this.ttlMs = MACRO_PLAN_TTL_MS;
    this.clock = options.now ?? (() => Date.now());
    if (!Number.isSafeInteger(this.maxPlans) || this.maxPlans < 1)
      throw new Error('macro plan store maxPlans must be positive');
    if (!Number.isFinite(this.ttlMs) || this.ttlMs <= 0) throw new Error('macro plan store ttlMs must be positive');
  }

  put(plan: MacroPlan, now = this.clock()): MacroPlan {
    this.sweep(now);
    const expiresAt = Date.parse(plan.expiresAt);
    if (!Number.isFinite(expiresAt) || expiresAt <= now)
      throw new MacroError('macro_plan_expired', 'cannot store an expired macro plan', 'plan');
    if (expiresAt - Date.parse(plan.createdAt) !== this.ttlMs)
      throw new MacroError('macro_plan_expired', 'macro plan expiry is not five minutes', 'plan');
    this.plans.delete(plan.planId);
    this.expired.delete(plan.planId);
    while (this.plans.size >= this.maxPlans) this.evictOldest();
    this.plans.set(plan.planId, { plan: deepFreeze(structuredClone(plan)), sequence: this.sequence++ });
    return plan;
  }

  peek(planId: string, now = this.clock()): MacroPlan {
    return this.get(planId, now);
  }

  size(now = this.clock()): number {
    this.sweep(now);
    return this.plans.size;
  }

  clear(): void {
    this.plans.clear();
    this.expired.clear();
  }

  private get(planId: string, now: number): MacroPlan {
    return this.getRecord(planId, now).plan;
  }

  private getRecord(planId: string, now: number): StoredPlan {
    const record = this.plans.get(planId);
    if (!record) {
      if (this.expired.has(planId))
        throw new MacroError('macro_plan_expired', 'macro plan has expired', 'plan', { status: 410 });
      throw new MacroError('macro_plan_not_found', 'macro plan was not found', 'plan', { status: 404 });
    }
    if (Date.parse(record.plan.expiresAt) <= now) {
      this.plans.delete(planId);
      this.expired.set(planId, Date.parse(record.plan.expiresAt));
      throw new MacroError('macro_plan_expired', 'macro plan has expired', 'plan', { status: 410 });
    }
    return record;
  }

  private sweep(now: number): void {
    for (const [id, record] of this.plans) {
      if (Date.parse(record.plan.expiresAt) <= now) {
        this.plans.delete(id);
        this.expired.set(id, Date.parse(record.plan.expiresAt));
      }
    }
    while (this.expired.size > this.maxPlans) this.expired.delete(this.expired.keys().next().value as string);
  }

  private evictOldest(): void {
    const oldest = [...this.plans.entries()].sort(([, left], [, right]) => left.sequence - right.sequence)[0];
    if (!oldest) return;
    this.plans.delete(oldest[0]);
  }
}

export const MacroPlanStore = InMemoryMacroPlanStore;
