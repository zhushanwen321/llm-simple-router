export interface Schedule {
  id: string
  mapping_group_id: string
  name: string
  enabled: number
  week: string
  start_hour: number
  end_hour: number
  mapping_rule: string
  concurrency_rule: string | null
  transform_rule: string | null
  priority: number
  created_at: string
  updated_at: string
}

export interface SchedulePayload {
  mapping_group_id: string
  name: string
  week: string
  start_hour: number
  end_hour: number
  mapping_rule: string
  concurrency_rule?: string | null
  transform_rule?: string | null
}
