export interface CascadingOption {
  value: string
  label: string
  tag?: string
}

export interface CascadingGroup {
  key: string
  label: string
  options: CascadingOption[]
}

export interface CascadingSelectedValue {
  groupKey: string
  value: string
}
