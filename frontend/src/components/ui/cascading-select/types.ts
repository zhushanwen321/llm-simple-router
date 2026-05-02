export interface CascadingOption {
  value: string
  label: string
  tag?: string
}

export interface CascadingGroup {
  key: string
  label: string
  badge?: string
  options: CascadingOption[]
}

export interface CascadingSelectedValue {
  groupKey: string
  value: string
}
