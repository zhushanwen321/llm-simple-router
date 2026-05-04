export type StageRecord =
  | { stage: "tool_round_limit"; action: string; rounds: number }
  | { stage: "tool_guard"; action: string; tool: string }
  | { stage: "routing"; client_model: string; backend_model: string; provider_id: string; strategy: string }
  | { stage: "overflow"; triggered: boolean; redirect_to?: string; redirect_provider?: string }
  | { stage: "provider_patch"; types: string[] };

export class PipelineSnapshot {
  private readonly stages: StageRecord[];

  constructor(initial?: StageRecord[]) {
    this.stages = initial ? [...initial] : [];
  }

  add(record: StageRecord): void {
    this.stages.push(record);
  }

  toJSON(): string {
    return JSON.stringify(this.stages);
  }

  getStages(): readonly StageRecord[] {
    return this.stages;
  }
}
