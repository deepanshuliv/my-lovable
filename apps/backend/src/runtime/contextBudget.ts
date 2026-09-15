export type TokenEstimator = (text: string) => number;

export type ContextBudgetConfig = {
  modelContextCapacity: number;
  responseReserve: number;
  safetyReserve?: number;
  estimator?: TokenEstimator;
};

export type ContextCategories = {
  systemPrompt: number;
  toolDefinitions: number;
  taskState: number;
  projectInstructions: number;
  compactedSummary: number;
  recentEvents: number;
  retrievedHistory: number;
  currentInput: number;
};

export type ContextBudgetReport = ContextCategories & {
  inputTokens: number;
  responseReserve: number;
  safetyReserve: number;
  totalReserved: number;
  capacity: number;
  remaining: number;
  utilization: number;
  fits: boolean;
};

export class ContextBudgetError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ContextBudgetError';
  }
}

const defaultEstimator: TokenEstimator = (text) => Math.ceil(text.length / 4);

/** Provider-independent accounting for the model request invariant. */
export class ContextBudgetManager {
  readonly capacity: number;
  readonly responseReserve: number;
  readonly safetyReserve: number;
  private readonly estimator: TokenEstimator;

  constructor(config: ContextBudgetConfig) {
    if (!Number.isFinite(config.modelContextCapacity) || config.modelContextCapacity <= 0) {
      throw new ContextBudgetError('model context capacity must be positive');
    }
    if (!Number.isFinite(config.responseReserve) || config.responseReserve < 0) {
      throw new ContextBudgetError('response reserve must be non-negative');
    }
    this.capacity = Math.floor(config.modelContextCapacity);
    this.responseReserve = Math.floor(config.responseReserve);
    this.safetyReserve = Math.max(0, Math.floor(config.safetyReserve ?? Math.ceil(this.capacity * 0.05)));
    if (this.responseReserve + this.safetyReserve >= this.capacity) {
      throw new ContextBudgetError(
        `response reserve (${this.responseReserve}) plus safety reserve (${this.safetyReserve}) leaves no input budget`,
      );
    }
    this.estimator = config.estimator ?? defaultEstimator;
  }

  estimate(text: string): number {
    return Math.max(0, this.estimator(text));
  }

  estimateJson(value: unknown): number {
    return this.estimate(JSON.stringify(value));
  }

  inputCapacity(): number {
    return this.capacity - this.responseReserve - this.safetyReserve;
  }

  report(categories: ContextCategories): ContextBudgetReport {
    const inputTokens = Object.values(categories).reduce((total, value) => total + Math.max(0, value), 0);
    const totalReserved = inputTokens + this.responseReserve + this.safetyReserve;
    return {
      ...categories,
      inputTokens,
      responseReserve: this.responseReserve,
      safetyReserve: this.safetyReserve,
      totalReserved,
      capacity: this.capacity,
      remaining: this.capacity - totalReserved,
      utilization: totalReserved / this.capacity,
      fits: totalReserved <= this.capacity,
    };
  }

  assertFits(report: ContextBudgetReport): void {
    if (!report.fits) {
      throw new ContextBudgetError(
        `context budget exceeded: ${report.totalReserved} estimated tokens > ${report.capacity} capacity ` +
          `(input=${report.inputTokens}, response reserve=${report.responseReserve}, safety reserve=${report.safetyReserve})`,
      );
    }
  }

  /** True when another provider request must compact before it is sent. */
  shouldCompact(inputTokens: number, toolDefinitionTokens = 0): boolean {
    return inputTokens + toolDefinitionTokens + this.responseReserve + this.safetyReserve > this.capacity;
  }

  estimateRequest(
    categories: Omit<ContextCategories, 'toolDefinitions'>,
    toolDefinitions: unknown,
  ): ContextBudgetReport {
    return this.report({
      ...categories,
      toolDefinitions: this.estimateJson(toolDefinitions),
    });
  }

  /** Deterministic, disclosed trimming used only for optional context. */
  fitOptionalText(text: string, maxTokens: number): string {
    if (maxTokens <= 0) return '';
    if (this.estimate(text) <= maxTokens) return text;
    let low = 0;
    let high = Math.max(0, maxTokens * 2);
    let best = '';
    while (low <= high) {
      const edge = Math.floor((low + high) / 2);
      const candidate = `${text.slice(0, edge)}\n… [optional context omitted] …\n${text.slice(-edge)}`;
      if (this.estimate(candidate) <= maxTokens) {
        best = candidate;
        low = edge + 1;
      } else {
        high = edge - 1;
      }
    }
    if (best) return best;
    let fallback = text.slice(0, Math.max(0, Math.floor(maxTokens * 4)));
    while (fallback && this.estimate(fallback) > maxTokens) fallback = fallback.slice(0, -1);
    return fallback;
  }
}
