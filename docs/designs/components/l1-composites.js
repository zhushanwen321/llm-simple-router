/**
 * Demo Components — L1 Composites Behavior
 * 依赖：l1-composites.css
 */

/* === Dialog === */
function openDialog(id) {
  document.getElementById(id)?.classList.add('open');
  document.body.style.overflow = 'hidden';
}

function closeDialog(id) {
  document.getElementById(id)?.classList.remove('open');
  document.body.style.overflow = '';
}

/* 点击 overlay 关闭 */
document.addEventListener('click', (e) => {
  if (e.target.classList.contains('dialog-overlay')) {
    e.target.classList.remove('open');
    document.body.style.overflow = '';
  }
});

/* === Collapsible === */
function toggleCollapsible(trigger) {
  const content = trigger.nextElementSibling;
  const isExpanded = trigger.classList.toggle('expanded');
  if (isExpanded) {
    content.classList.add('expanded');
    content.style.maxHeight = content.scrollHeight + 'px';
  } else {
    content.classList.remove('expanded');
    content.style.maxHeight = '0';
  }
}

/* === Tabs === */
function switchTab(trigger, group) {
  const tabList = trigger.closest('.tabs-list');
  tabList.querySelectorAll('.tabs-trigger').forEach(t => t.classList.remove('active'));
  trigger.classList.add('active');
  const container = tabList.parentElement;
  container.querySelectorAll('.tabs-content').forEach(c => c.style.display = 'none');
  const target = container.querySelector(`[data-tab="${trigger.dataset.target}"]`);
  if (target) target.style.display = '';
}

/* === Copy Button === */
function copyText(btn, text) {
  navigator.clipboard.writeText(text).then(() => {
    const original = btn.textContent;
    btn.classList.add('copied');
    btn.textContent = 'Copied!';
    setTimeout(() => {
      btn.classList.remove('copied');
      btn.textContent = original;
    }, 1500);
  });
}

/* === Inline Confirm === */
function showInlineConfirm(cell, onConfirm) {
  const original = cell.innerHTML;
  cell.innerHTML = `
    <span style="color:var(--danger);font-size:12px;margin-right:4px;">确认删除?</span>
    <button class="btn btn-sm btn-danger" onclick="(${onConfirm.toString()})(); this.closest('td').innerHTML = arguments[0]?.target?.closest('td')?.dataset?.original || '';">Y</button>
    <button class="btn btn-sm" onclick="this.closest('td').innerHTML=this.closest('td').dataset.original">N</button>
  `;
  cell.dataset.original = original;
}

/* === Table Sort (basic) === */
function sortTable(th) {
  const table = th.closest('table');
  const index = Array.from(th.parentElement.children).indexOf(th);
  const isAsc = th.dataset.sort !== 'asc';
  th.dataset.sort = isAsc ? 'asc' : 'desc';
  /* Reset other headers */
  th.parentElement.querySelectorAll('th').forEach(h => {
    if (h !== th) delete h.dataset.sort;
  });

  const rows = Array.from(table.querySelectorAll('tbody tr:not(.row-expand)'));
  rows.sort((a, b) => {
    const aVal = a.children[index]?.textContent.trim() || '';
    const bVal = b.children[index]?.textContent.trim() || '';
    const cmp = aVal.localeCompare(bVal, undefined, { numeric: true });
    return isAsc ? cmp : -cmp;
  });
  const tbody = table.querySelector('tbody');
  rows.forEach(r => tbody.appendChild(r));
}
