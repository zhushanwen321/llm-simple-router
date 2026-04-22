# 前端变更

## 新增 API Keys 管理页面（/admin/keys）

- 列表：名称、key 前缀、模型白名单摘要（Badge 展示）、状态、操作
- 创建：名称输入 + 模型白名单多选（从已有 backend_model 列表选取），创建后 Dialog 展示明文 key 并提示"仅显示一次"
- 编辑：名称、白名单多选、启用/禁用
- 删除：AlertDialog 确认

使用 shadcn-vue 组件：Table、Dialog、AlertDialog、Badge、Select、Input、Button。

## 日志页面

筛选栏新增 API Key 下拉框（Select 组件），选项从 router-keys 列表获取。查询参数 `router_key_id` 传递给后端。

## 指标/Dashboard 页面

同上，筛选栏新增 API Key 下拉框。

## 侧边栏

新增 "API Keys" 导航入口，图标用 Key。
