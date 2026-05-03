export interface DirectiveMeta {
  type: "select_model" | "router_model" | "router_command";
  value: string;
}

export type StageRecord =
  | { stage: "enhancement"; router_tags_stripped: number; directive: DirectiveMeta | null }
  | { stage: "tool_round_limit"; action: string; rounds: number }
  | { stage: "tool_guard"; action: string; tool: string }
  | { stage: "routing"; client_model: string; backend_model: string; provider_id: string; strategy: string }
  | { stage: "overflow"; triggered: boolean; redirect_to?: string; redirect_provider?: string }
  | { stage: "provider_patch"; types: string[] }
  | { stage: "response_transform"; model_info_tag_injected: boolean };

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
