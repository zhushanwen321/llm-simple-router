<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Provider Multi-API-Type - 前端 UI Demo</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #f8f9fa; color: #1a1a2e; padding: 24px; }
  h1 { font-size: 20px; margin-bottom: 8px; }
  h2 { font-size: 16px; margin: 24px 0 12px; color: #555; border-bottom: 1px solid #e0e0e0; padding-bottom: 8px; }
  h3 { font-size: 14px; margin: 16px 0 8px; color: #666; }
  .note { background: #fff3cd; border: 1px solid #ffc107; border-radius: 6px; padding: 10px 14px; margin: 12px 0; font-size: 13px; }
  
  /* Badge */
  .badge { display: inline-flex; align-items: center; padding: 2px 10px; border-radius: 9999px; font-size: 12px; font-weight: 500; margin-right: 4px; }
  .badge-openai { background: #e8f5e9; color: #2e7d32; }
  .badge-responses { background: #e3f2fd; color: #1565c0; }
  .badge-anthropic { background: #fce4ec; color: #c62828; }
  
  /* Table */
  .table-wrap { overflow-x: auto; background: white; border-radius: 8px; box-shadow: 0 1px 3px rgba(0,0,0,0.1); }
  table { width: 100%; border-collapse: collapse; font-size: 13px; }
  th { background: #f1f3f5; padding: 10px 14px; text-align: left; font-weight: 600; border-bottom: 2px solid #e0e0e0; }
  td { padding: 10px 14px; border-bottom: 1px solid #f0f0f0; vertical-align: top; }
  tr:hover { background: #f8f9ff; }
  
  /* Key row */
  .key-row { display: flex; align-items: center; gap: 6px; padding: 2px 0; font-size: 12px; }
  .key-row + .key-row { border-top: 1px solid #f0f0f0; margin-top: 2px; padding-top: 4px; }
  .key-type { font-weight: 500; min-width: 100px; }
  .key-value { font-family: monospace; color: #666; }
  .copy-btn { background: none; border: 1px solid #ddd; border-radius: 4px; padding: 1px 6px; font-size: 11px; cursor: pointer; color: #666; }
  .copy-btn:hover { background: #f0f0f0; }
  
  /* Form */
  .form-section { background: white; border-radius: 8px; padding: 20px; box-shadow: 0 1px 3px rgba(0,0,0,0.1); max-width: 640px; }
  .form-group { margin-bottom: 14px; }
  .form-group label { display: block; font-size: 13px; font-weight: 500; margin-bottom: 4px; color: #555; }
  .form-group input, .form-group select { width: 100%; padding: 8px 10px; border: 1px solid #ddd; border-radius: 6px; font-size: 13px; }
  
  /* Endpoint card */
  .endpoint-card { border: 1px solid #e0e0e0; border-radius: 8px; padding: 14px; margin-bottom: 10px; position: relative; }
  .endpoint-card-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px; }
  .endpoint-remove { background: none; border: none; color: #dc3545; cursor: pointer; font-size: 18px; }
  .endpoint-fields { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
  .endpoint-fields .full-width { grid-column: 1 / -1; }
  
  /* Add button */
  .add-endpoint-btn { display: inline-flex; align-items: center; gap: 6px; padding: 8px 16px; background: white; border: 1px dashed #999; border-radius: 6px; cursor: pointer; font-size: 13px; color: #666; }
  .add-endpoint-btn:hover { border-color: #333; color: #333; }
  
  /* Dropdown */
  .add-dropdown { position: relative; display: inline-block; }
  .add-dropdown-content { display: none; position: absolute; top: 100%; left: 0; background: white; border: 1px solid #ddd; border-radius: 6px; box-shadow: 0 4px 12px rgba(0,0,0,0.15); z-index: 10; min-width: 180px; }
  .add-dropdown-content.show { display: block; }
  .add-dropdown-item { padding: 8px 14px; cursor: pointer; font-size: 13px; }
  .add-dropdown-item:hover { background: #f0f0ff; }
  .add-dropdown-item.disabled { color: #ccc; cursor: not-allowed; }
  
  /* Actions */
  .actions { display: flex; gap: 8px; margin-top: 16px; }
  .btn-primary { padding: 8px 20px; background: #4f46e5; color: white; border: none; border-radius: 6px; cursor: pointer; font-size: 13px; }
  .btn-secondary { padding: 8px 20px; background: white; border: 1px solid #ddd; border-radius: 6px; cursor: pointer; font-size: 13px; }

  /* Log detail */
  .log-field { display: flex; gap: 8px; padding: 4px 0; font-size: 13px; }
  .log-label { font-weight: 500; min-width: 140px; color: #666; }
  .log-value { font-family: monospace; }
  .log-transform { background: #fff3e0; padding: 2px 8px; border-radius: 4px; font-size: 11px; color: #e65100; }
</style>
</head>
<body>

<h1>Provider Multi-API-Type 前端 UI Demo</h1>
<p style="font-size:13px;color:#666;">展示 Provider endpoints 多协议支持的前端变更 mockup</p>

<!-- ============================================================ -->
<h2>1. Provider 列表页 — 多 Endpoint 展示</h2>

<div class="table-wrap">
<table>
  <thead>
    <tr>
      <th>名称</th>
      <th>API 类型</th>
      <th>Base URL</th>
      <th>API Key</th>
      <th>模型</th>
      <th>状态</th>
      <th>操作</th>
    </tr>
  </thead>
  <tbody>
    <!-- 单 endpoint provider (迁移后不变) -->
    <tr>
      <td><strong>OpenAI Official</strong></td>
      <td><span class="badge badge-openai">OpenAI</span></td>
      <td style="font-size:12px;">https://api.openai.com</td>
      <td>
        <div class="key-row">
          <span class="key-value">sk-...a1b2</span>
          <button class="copy-btn">复制</button>
        </div>
      </td>
      <td>32 个</td>
      <td><span style="color:#2e7d32;">●</span> 活跃</td>
      <td><a href="#" style="color:#4f46e5;font-size:13px;">编辑</a></td>
    </tr>
    <!-- 多 endpoint provider -->
    <tr>
      <td><strong>智谱 GLM</strong></td>
      <td>
        <span class="badge badge-openai">OpenAI</span>
        <span class="badge badge-anthropic">Anthropic</span>
      </td>
      <td style="font-size:12px;">
        <div>https://open.bigmodel.cn/api/paas</div>
        <div style="color:#999;">https://open.bigmodel.cn/api/paas</div>
      </td>
      <td>
        <div class="key-row">
          <span class="key-type">OpenAI</span>
          <span class="key-value">sk-...x3y4</span>
          <button class="copy-btn">复制</button>
        </div>
        <div class="key-row">
          <span class="key-type">Anthropic</span>
          <span class="key-value">sk-...x3y4</span>
          <button class="copy-btn">复制</button>
        </div>
      </td>
      <td>18 个</td>
      <td><span style="color:#2e7d32;">●</span> 活跃</td>
      <td><a href="#" style="color:#4f46e5;font-size:13px;">编辑</a></td>
    </tr>
    <!-- 三 endpoint provider -->
    <tr>
      <td><strong>Azure Proxy</strong></td>
      <td>
        <span class="badge badge-openai">OpenAI</span>
        <span class="badge badge-responses">Responses</span>
        <span class="badge badge-anthropic">Anthropic</span>
      </td>
      <td style="font-size:12px;">
        <div>https://azure.example.com/openai</div>
        <div>https://azure.example.com/responses</div>
        <div style="color:#999;">https://azure.example.com/anthropic</div>
      </td>
      <td>
        <div class="key-row">
          <span class="key-type">OpenAI</span>
          <span class="key-value">azure-...m1</span>
          <button class="copy-btn">复制</button>
        </div>
        <div class="key-row">
          <span class="key-type">Responses</span>
          <span class="key-value">azure-...m1</span>
          <button class="copy-btn">复制</button>
        </div>
        <div class="key-row">
          <span class="key-type">Anthropic</span>
          <span class="key-value">(共享 Key)</span>
          <button class="copy-btn">复制</button>
        </div>
      </td>
      <td>45 个</td>
      <td><span style="color:#2e7d32;">●</span> 活跃</td>
      <td><a href="#" style="color:#4f46e5;font-size:13px;">编辑</a></td>
    </tr>
  </tbody>
</table>
</div>

<div class="note">
  <strong>变更说明：</strong>
  <ul style="margin-left:18px;margin-top:4px;">
    <li><strong>API 类型列</strong>：从单个 Badge 改为多个 Badge，每个 endpoint 一个</li>
    <li><strong>Base URL 列</strong>：多 endpoint 时按行展示，灰色表示与上一行相同</li>
    <li><strong>API Key 列</strong>：多 endpoint 时按行展示，每行有 api_type 标签 + 独立复制按钮。共享 key 显示"(共享 Key)"</li>
  </ul>
</div>

<!-- ============================================================ -->
<h2>2. Provider 编辑表单 — 多 Endpoint 编辑</h2>

<h3>2a. 单 Endpoint（默认，与当前 UI 一致）</h3>
<div class="form-section">
  <div class="endpoint-card">
    <div class="endpoint-fields">
      <div class="form-group">
        <label>API 类型</label>
        <select><option>OpenAI Chat Completions</option><option>OpenAI Responses</option><option>Anthropic Messages</option></select>
      </div>
      <div class="form-group">
        <label>API Key</label>
        <input type="password" value="sk-...a1b2" />
      </div>
      <div class="form-group full-width">
        <label>Base URL</label>
        <input value="https://api.openai.com" />
      </div>
      <div class="form-group full-width">
        <label>Upstream Path（可选）</label>
        <input placeholder="/v1/chat/completions" />
      </div>
    </div>
  </div>
  <div style="display:flex;align-items:center;gap:8px;margin-top:8px;">
    <span style="font-size:12px;color:#888;">共享 API Key（兜底）：</span>
    <input type="password" value="sk-...a1b2" style="width:200px;padding:4px 8px;font-size:12px;border:1px solid #ddd;border-radius:4px;" />
  </div>
</div>

<h3>2b. 多 Endpoint（新增场景）</h3>
<div class="form-section">
  <!-- Endpoint 1 -->
  <div class="endpoint-card">
    <div class="endpoint-card-header">
      <span class="badge badge-openai">OpenAI</span>
      <button class="endpoint-remove" title="删除此 endpoint">×</button>
    </div>
    <div class="endpoint-fields">
      <div class="form-group">
        <label>API Key（留空使用共享 Key）</label>
        <input type="password" value="sk-...x3y4" />
      </div>
      <div class="form-group">
        <label>&nbsp;</label>
        <span style="font-size:11px;color:#999;">为空时自动使用下方共享 Key</span>
      </div>
      <div class="form-group full-width">
        <label>Base URL</label>
        <input value="https://open.bigmodel.cn/api/paas" />
      </div>
      <div class="form-group full-width">
        <label>Upstream Path（可选）</label>
        <input value="/v1/chat/completions" />
      </div>
    </div>
  </div>
  
  <!-- Endpoint 2 -->
  <div class="endpoint-card">
    <div class="endpoint-card-header">
      <span class="badge badge-anthropic">Anthropic</span>
      <button class="endpoint-remove" title="删除此 endpoint">×</button>
    </div>
    <div class="endpoint-fields">
      <div class="form-group">
        <label>API Key（留空使用共享 Key）</label>
        <input type="password" placeholder="留空使用共享 Key" />
      </div>
      <div class="form-group">
        <label>&nbsp;</label>
        <span style="font-size:11px;color:#999;">✓ 将使用共享 Key</span>
      </div>
      <div class="form-group full-width">
        <label>Base URL</label>
        <input value="https://open.bigmodel.cn/api/paas" />
      </div>
      <div class="form-group full-width">
        <label>Upstream Path（可选）</label>
        <input value="/v1/messages" />
      </div>
    </div>
  </div>
  
  <!-- Add Endpoint -->
  <div class="add-dropdown">
    <button class="add-endpoint-btn" onclick="toggleDropdown()">+ 添加 Endpoint</button>
    <div class="add-dropdown-content" id="addDropdown">
      <div class="add-dropdown-item disabled">✓ OpenAI（已配置）</div>
      <div class="add-dropdown-item" onclick="alert('添加 OpenAI Responses endpoint')">+ OpenAI Responses</div>
      <div class="add-dropdown-item disabled">✓ Anthropic（已配置）</div>
    </div>
  </div>
  
  <div style="margin-top:14px;padding-top:14px;border-top:1px solid #eee;">
    <div style="display:flex;align-items:center;gap:8px;">
      <span style="font-size:12px;color:#888;">共享 API Key（兜底）：</span>
      <input type="password" value="sk-...x3y4" style="width:200px;padding:4px 8px;font-size:12px;border:1px solid #ddd;border-radius:4px;" />
      <span style="font-size:11px;color:#999;">Endpoint 未配 Key 时使用此值</span>
    </div>
  </div>
  
  <div class="actions">
    <button class="btn-primary">保存</button>
    <button class="btn-secondary">取消</button>
  </div>
</div>

<div class="note">
  <strong>交互说明：</strong>
  <ul style="margin-left:18px;margin-top:4px;">
    <li>"添加 Endpoint" 下拉只显示<strong>未配置的</strong> api_type（已配置的灰色禁用）</li>
    <li>每个 endpoint 卡片右上角有删除按钮（至少保留 1 个）</li>
    <li>API Key 输入框 placeholder 为"留空使用共享 Key"，为空时显示 ✓ 提示</li>
    <li>共享 API Key 在表单底部，所有 endpoint 共用</li>
  </ul>
</div>

<!-- ============================================================ -->
<h2>3. 快速配置页面</h2>

<div class="form-section">
  <p style="font-size:13px;color:#666;margin-bottom:12px;">快速配置页面 UI 不变，用户只配一个 endpoint。变更在后端 payload 格式。</p>
  
  <div class="endpoint-card">
    <div class="endpoint-fields">
      <div class="form-group">
        <label>API 类型</label>
        <select><option>OpenAI Chat Completions</option><option>OpenAI Responses</option><option>Anthropic Messages</option></select>
      </div>
      <div class="form-group">
        <label>API Key</label>
        <input type="password" value="sk-xxx" />
      </div>
      <div class="form-group full-width">
        <label>Base URL</label>
        <input value="https://api.example.com" />
      </div>
    </div>
  </div>
  
  <h3 style="margin-top:16px;">Payload 对比</h3>
  <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
    <div>
      <div style="font-size:12px;color:#999;margin-bottom:4px;">旧格式（Before）</div>
      <pre style="background:#f5f5f5;padding:10px;border-radius:6px;font-size:11px;overflow-x:auto;">{
  "api_type": "openai",
  "base_url": "https://api.example.com",
  "api_key": "sk-xxx",
  "upstream_path": null
}</pre>
    </div>
    <div>
      <div style="font-size:12px;color:#999;margin-bottom:4px;">新格式（After）</div>
      <pre style="background:#f5f5f5;padding:10px;border-radius:6px;font-size:11px;overflow-x:auto;">{
  "endpoints": [{
    "api_type": "openai",
    "base_url": "https://api.example.com",
    "api_key": "sk-xxx",
    "upstream_path": null
  }],
  "api_key": "sk-xxx"
}</pre>
    </div>
  </div>
</div>

<!-- ============================================================ -->
<h2>4. 请求日志展示 — 上下游 API Type</h2>

<div class="form-section">
  <h3>请求详情字段</h3>
  
  <div class="log-field">
    <span class="log-label">客户端 API 类型</span>
    <span class="log-value"><span class="badge badge-openai">OpenAI</span></span>
  </div>
  <div class="log-field">
    <span class="log-label">上游 API 类型</span>
    <span class="log-value"><span class="badge badge-anthropic">Anthropic</span></span>
    <span class="log-transform">格式转换</span>
  </div>
  <div class="log-field">
    <span class="log-label">上游 Base URL</span>
    <span class="log-value">https://open.bigmodel.cn/api/paas</span>
  </div>
  
  <h3 style="margin-top:16px;">无转换场景</h3>
  <div class="log-field">
    <span class="log-label">客户端 API 类型</span>
    <span class="log-value"><span class="badge badge-openai">OpenAI</span></span>
  </div>
  <div class="log-field">
    <span class="log-label">上游 API 类型</span>
    <span class="log-value"><span class="badge badge-openai">OpenAI</span></span>
    <span style="font-size:11px;color:#2e7d32;">✓ 精确匹配</span>
  </div>
  <div class="log-field">
    <span class="log-label">上游 Base URL</span>
    <span class="log-value">https://api.openai.com</span>
  </div>
</div>

<script>
function toggleDropdown() {
  document.getElementById('addDropdown').classList.toggle('show');
}
document.addEventListener('click', function(e) {
  if (!e.target.closest('.add-dropdown')) {
    document.getElementById('addDropdown').classList.remove('show');
  }
});
</script>

</body>
</html>
