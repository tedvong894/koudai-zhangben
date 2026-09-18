// 主程序：页面渲染 + 交互
(() => {
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));

  const state = {
    view: 'record',
    ledgerId: null,
    month: null,
    ledgers: [],
    categories: [],
    assets: [],
    txs: [],            // 当前月的交易缓存，避免每次点按都查库
    unsubs: []
  };

  // ---------- 工具 ----------
  function fmt(n) {
    const v = Number(n) || 0;
    return '¥' + v.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
  // 颜色变亮/变暗（amount: 负=变亮，正=变暗），返回 hex
  function lightenColor(hex, amount) {
    const c = hex.replace('#', '');
    const r = Math.min(255, Math.max(0, parseInt(c.slice(0, 2), 16) + amount));
    const g = Math.min(255, Math.max(0, parseInt(c.slice(2, 4), 16) + amount));
    const b = Math.min(255, Math.max(0, parseInt(c.slice(4, 6), 16) + amount));
    return '#' + [r, g, b].map(v => v.toString(16).padStart(2, '0')).join('');
  }
  function monthKeyOf(d) {
    const y = d.getFullYear(); const m = String(d.getMonth() + 1).padStart(2, '0');
    return `${y}-${m}`;
  }
  function todayStr() { return Store.todayStr(); }
  function catMap() { const m = {}; state.categories.forEach(c => m[c.id] = c); return m; }
  function assetMap() { const m = {}; (state.assets || []).forEach(a => m[a.id] = a); return m; }

  function toast(msg) {
    const root = $('#toast-root');
    const el = document.createElement('div');
    el.className = 'toast'; el.textContent = msg;
    root.appendChild(el);
    setTimeout(() => { el.style.opacity = '0'; setTimeout(() => el.remove(), 250); }, 1800);
  }

  // ---------- 数据加载 ----------
  // 仅在启动 / 切换 Supabase 时全量重载（含账本 / 分类 / 资产）
  async function reloadCaches() {
    state.ledgers = await Store.getLedgers();
    state.categories = await Store.getCategories();
    state.assets = await Store.getAssets();
    if (!state.ledgerId && state.ledgers[0]) state.ledgerId = state.ledgers[0].id;
    const savedMonth = localStorage.getItem('yy_current_month');
    if (!state.month) state.month = savedMonth || monthKeyOf(new Date());
  }
  // 只重载当前月交易（热路径只调它一次，各视图读 state.txs）
  async function loadTxs() {
    if (!state.ledgerId) { state.txs = []; return; }
    state.txs = await Store.getTransactions({ ledgerId: state.ledgerId, month: state.month });
  }
  // 只重载资产（实时订阅 / 转账后轻量刷新，不触发分类、账本查询）
  async function loadAssets() {
    state.assets = await Store.getAssets();
  }
  async function loadCategories() {
    state.categories = await Store.getCategories();
  }

  // ---------- 弹窗基础 ----------
  function openModal(panelHTML) {
    const root = $('#modal-root');
    root.innerHTML = `<div class="modal-mask"></div><div class="modal-panel">${panelHTML}</div>`;
    root.classList.add('show');
    $('.modal-mask', root).addEventListener('click', closeModal);
  }
  function closeModal() {
    const root = $('#modal-root');
    root.classList.remove('show');
    root.innerHTML = '';
  }

  // ---------- 顶部栏 ----------
  async function renderHeader() {
    $('#header-month').textContent = state.month;

    const txs = state.txs;
    let exp = 0, inc = 0;
    txs.forEach(t => { if (t.type === 'expense') exp += Number(t.amount); else if (t.type === 'income') inc += Number(t.amount); });
    $('#header-expense').textContent = fmt(exp);
    $('#header-income').textContent = fmt(inc);
    $('#header-balance').textContent = fmt(inc - exp);
  }

  // ---------- 记账页 ----------
  async function renderRecord() {
    const view = $('#view-record');
    // 快捷记一笔只列小类（叶子类），点一下即记到最细层级
    const expCats = state.categories.filter(c => c.type === 'expense' && c.parent);
    const txs = state.txs;
    const cm = catMap();
    const recent = txs.slice(0, 5);

    view.innerHTML = `
      <div class="card">
        <div class="card-title">快捷记一笔 <span class="more" id="go-detail">查看明细 ›</span></div>
        <div class="quick-grid">
          ${expCats.map(c => `
            <div class="quick-item" data-cat="${c.id}">
              <div class="quick-icon" style="background:${c.color}22">${c.icon}</div>
              <div class="quick-name">${esc(c.name)}</div>
            </div>`).join('')}
        </div>
      </div>
      <button class="record-add" id="record-add-btn" type="button">
        <span class="plus">＋</span><span>记一笔</span>
      </button>
      <div class="card">
        <div class="card-title">最近记录</div>
        ${recent.length ? recent.map(t => txRow(t, cm)).join('') : '<div class="empty">本月还没有记录，点上方 ＋ 记一笔吧</div>'}
      </div>`;

    $$('#view-record .quick-item').forEach(el => {
      el.addEventListener('click', () => {
        const cat = state.categories.find(c => c.id === el.dataset.cat);
        openAddModal(cat);
      });
    });
    const rab = $('#record-add-btn'); if (rab) rab.addEventListener('click', () => openAddModal(null));
    const gd = $('#go-detail'); if (gd) gd.addEventListener('click', () => switchView('detail'));
    // 首页"最近记录"也绑定长按删除 + 单击详情
    bindTxDelete($('#view-record'));
  }

  function txRow(t, cm) {
    // 转账：独立展示，不计入收支；显示 转出账户 → 转入账户
    if (t.type === 'transfer') {
      const am = assetMap();
      const fa = t.from_asset_id ? am[t.from_asset_id] : null;
      const ta = t.to_asset_id ? am[t.to_asset_id] : null;
      return `<div class="tx-item" data-id="${t.id}">
        <div class="tx-icon" style="background:#0A84FF22">🔁</div>
        <div class="tx-main">
          <div class="tx-cat">转账</div>
          <div class="tx-note">${fa ? esc(fa.name) : '?'} → ${ta ? esc(ta.name) : '?'}${t.note ? '　' + esc(t.note) : ''}</div>
        </div>
        <div class="tx-amount transfer">${fmt(t.amount).slice(1)}</div>
      </div>`;
    }
    const c = t.category_id ? cm[t.category_id] : null;
    const p = (c && c.parent) ? cm[c.parent] : null;
    const catLabel = c ? (p ? p.name + '/' + c.name : c.name) : '未分类';
    const am = assetMap();
    const a = t.asset_id ? am[t.asset_id] : null;
    const sign = t.type === 'expense' ? '-' : '+';
    const sub = `${a ? a.icon + ' ' + esc(a.name) + '　' : ''}${esc(t.note || t.occurred_at)}`;
    return `<div class="tx-item" data-id="${t.id}">
      <div class="tx-icon" style="background:${(c ? c.color : '#999')}22">${c ? c.icon : '📦'}</div>
      <div class="tx-main">
        <div class="tx-cat">${esc(catLabel)}</div>
        <div class="tx-note">${sub}</div>
      </div>
      <div class="tx-amount ${t.type}">${sign}${fmt(t.amount).slice(1)}</div>
    </div>`;
  }

  // ---------- 明细页 ----------
  async function renderDetail() {
    const view = $('#view-detail');
    const cm = catMap();
    let txs = state.txs;

    // 按日期分组
    const groups = {};
    txs.forEach(t => { (groups[t.occurred_at] = groups[t.occurred_at] || []).push(t); });
    const dates = Object.keys(groups).sort().reverse();

    view.innerHTML = `
      <div class="card" style="padding:10px 14px">
        <input id="search-box" placeholder="🔍 搜索备注 / 分类" style="width:100%;border:none;outline:none;font-size:14px;background:none" />
        <div style="display:flex;gap:8px;margin-top:10px" id="type-filter">
          ${['all', 'expense', 'income'].map(t => `<button data-t="${t}" class="type-chip${t === 'all' ? ' active' : ''}" style="flex:1;padding:6px;border:1px solid var(--line);border-radius:10px;background:${t === 'all' ? 'var(--primary)' : '#fff'};color:${t === 'all' ? '#fff' : 'var(--text-sub)'};font-weight:600;cursor:pointer">${t === 'all' ? '全部' : (t === 'expense' ? '支出' : '收入')}</button>`).join('')}
        </div>
      </div>
      <div id="detail-list">
        ${dates.length ? dates.map(d => {
          const items = groups[d];
          const sumE = items.filter(x => x.type === 'expense').reduce((s, x) => s + Number(x.amount), 0);
          const sumI = items.filter(x => x.type === 'income').reduce((s, x) => s + Number(x.amount), 0);
          return `<div class="tx-group-title"><span>${d}</span><span>收 ${fmt(sumI)} · 支 ${fmt(sumE)}</span></div>` +
            items.map(t => txRow(t, cm)).join('');
        }).join('') : '<div class="empty">本月暂无记录</div>'}
      </div>`;

    // 搜索
    const sb = $('#search-box');
    sb.addEventListener('input', () => filterDetail(groups, cm, sb.value.trim(), currentType));
    // 类型筛选
    let currentType = 'all';
    $$('#type-filter button').forEach(b => b.addEventListener('click', () => {
      currentType = b.dataset.t;
      $$('#type-filter button').forEach(x => {
        const on = x === b;
        x.style.background = on ? 'var(--primary)' : '#fff';
        x.style.color = on ? '#fff' : 'var(--text-sub)';
      });
      filterDetail(groups, cm, sb.value.trim(), currentType);
    }));
    // 点击删除
    bindTxDelete(view);
  }

  function filterDetail(groups, cm, kw, type) {
    const dates = Object.keys(groups).sort().reverse();
    const list = $('#detail-list');
    const filtered = {};
    dates.forEach(d => {
      filtered[d] = groups[d].filter(t => {
        const c = t.category_id ? cm[t.category_id] : null;
        const okT = type === 'all' || t.type === type;
        const okK = !kw || (c && c.name.includes(kw)) || (t.note && t.note.includes(kw));
        return okT && okK;
      });
    });
    const out = dates.filter(d => filtered[d].length).map(d => {
      const items = filtered[d];
      const sumE = items.filter(x => x.type === 'expense').reduce((s, x) => s + Number(x.amount), 0);
      const sumI = items.filter(x => x.type === 'income').reduce((s, x) => s + Number(x.amount), 0);
      return `<div class="tx-group-title"><span>${d}</span><span>收 ${fmt(sumI)} · 支 ${fmt(sumE)}</span></div>` + items.map(t => txRow(t, cm)).join('');
    }).join('');
    list.innerHTML = out || '<div class="empty">没有匹配的记录</div>';
    bindTxDelete(list);
  }

  async function bindTxDelete(scope) {
    $$('.tx-item', scope).forEach(el => {
      const id = el.dataset.id;

      // 单击 → 查看详情
      el.addEventListener('click', () => openTxDetailModal(id));

      // 长按 → 弹出操作菜单（删除）
      let pressTimer, sx = 0, sy = 0;
      el.addEventListener('touchstart', e => {
        sx = e.touches[0].clientX; sy = e.touches[0].clientY;
        pressTimer = setTimeout(() => {
          if (navigator.vibrate) navigator.vibrate(15);   // 震动反馈（iOS / Android）
          showTxActionMenu(id, e);
        }, 450);
        // 注意：此处不能 e.preventDefault()，否则会连带阻止父级 .detail-tx-list 的滚动。
        // iOS 长按原生菜单已由 .tx-item 的 -webkit-touch-callout:none / user-select:none 屏蔽。
      });
      const cancelPress = () => clearTimeout(pressTimer);
      el.addEventListener('touchend', cancelPress);
      // 仅当明显滑动（>10px）才视为滚动并取消长按；轻微手抖不再误杀
      el.addEventListener('touchmove', e => {
        const t = e.touches[0];
        if (Math.abs(t.clientX - sx) > 10 || Math.abs(t.clientY - sy) > 10) cancelPress();
      }, { passive: true });
      el.addEventListener('contextmenu', e => { e.preventDefault(); showTxActionMenu(id, e); });
    });
  }

  // 长按交易行弹出的操作菜单
  function showTxActionMenu(id, e) {
    const t = state.txs.find(x => x.id === id);
    if (!t) return;
    const catLabel = (() => {
      const cm = catMap();
      const c = t.category_id ? cm[t.category_id] : null;
      return c ? (c.parent ? cm[c.parent].name + '/' + c.name : c.name) : '未分类';
    })();
    const amt = (t.type === 'expense' ? '-' : '+') + fmt(t.amount).slice(1);

    const sheet = document.createElement('div');
    sheet.className = 'action-sheet-overlay';
    sheet.innerHTML = `
      <div class="action-sheet-backdrop"></div>
      <div class="action-sheet">
        <div class="as-header">
          <div class="as-title">${esc(catLabel)} · ${amt}</div>
          <div class="as-sub">${esc(t.note || '')} · ${t.occurred_at || ''}</div>
        </div>
        <div class="as-actions">
          ${t.type === 'transfer' ? '' : '<button class="as-btn as-btn-edit" id="as-edit">✏️ 编辑此条记录</button>'}
          <button class="as-btn as-btn-danger" id="as-delete">🗑️ 删除此条记录</button>
          <button class="as-btn as-btn-cancel" id="as-cancel">取消</button>
        </div>
      </div>`;
    document.body.appendChild(sheet);

    // 动画入场
    requestAnimationFrame(() => sheet.classList.add('show'));

    const close = () => { sheet.classList.remove('show'); setTimeout(() => sheet.remove(), 200); };
    sheet.querySelector('.action-sheet-backdrop').addEventListener('click', close);
    sheet.querySelector('#as-cancel').addEventListener('click', close);
    const editBtn = sheet.querySelector('#as-edit');
    if (editBtn) editBtn.addEventListener('click', () => {
      close();
      openAddModal(null, t);
    });
    sheet.querySelector('#as-delete').addEventListener('click', async () => {
      close();
      if (!confirm('确定删除这条「' + esc(catLabel) + ' · ' + amt + '」？' + (t.type === 'transfer' ? '\n将同时恢复两个账户余额。' : ''))) return;
      if (t.type === 'transfer') {
        // 回滚两个账户余额：转账时 from 减、to 加，删除时反向恢复
        if (t.from_asset_id) await adjustAssetBalance(t.from_asset_id, 'expense', t.amount, -1);
        if (t.to_asset_id) await adjustAssetBalance(t.to_asset_id, 'income', t.amount, -1);
      } else if (t.asset_id) {
        const a = (state.assets || []).find(x => x.id === t.asset_id);
        if (a) {
          const delta = t.type === 'income' ? -Number(t.amount) : Number(t.amount);
          await Store.saveAsset({ ...a, balance: Number(a.balance) + delta });
        }
      }
      await Store.deleteTransaction(id);
      await loadAssets();
      await loadCategories();
      await loadTxs();
      refreshAll();
      closeModal();
      toast('已删除');
    });
  }

  // 交易详情弹窗（单击查看）
  function openTxDetailModal(id) {
    const t = state.txs.find(x => x.id === id);
    if (!t) return;
    const cm = catMap();
    const c = t.category_id ? cm[t.category_id] : null;
    const isTransfer = t.type === 'transfer';
    const am = assetMap();
    const fa = isTransfer && t.from_asset_id ? am[t.from_asset_id] : null;
    const ta = isTransfer && t.to_asset_id ? am[t.to_asset_id] : null;
    const catLabel = isTransfer ? '转账' : (c ? (c.parent ? cm[c.parent].name + '/' + c.name : c.name) : '未分类');
    const a = (!isTransfer && t.asset_id) ? (state.assets || []).find(x => x.id === t.asset_id) : null;
    const sign = t.type === 'expense' ? '-' : '+';
    const iconHtml = isTransfer
      ? '🔁'
      : (c ? c.icon : '📦');
    const iconBg = isTransfer ? '#0A84FF22' : ((c ? c.color : '#999') + '22');
    const amtColor = isTransfer ? 'var(--text)' : (t.type === 'expense' ? 'var(--expense)' : 'var(--income)');
    const amtText = isTransfer ? fmt(t.amount).slice(1) : (sign + fmt(t.amount).slice(1));
    openModal(`
      <div class="modal-header"><div class="modal-title">${isTransfer ? '转账详情' : '交易详情'}</div><div class="modal-header-right">${isTransfer ? '' : '<button class="modal-edit-btn" id="tx-detail-edit">编辑</button>'}<button class="modal-close" id="m-close">×</button></div></div>
      <div style="padding:4px 0">
        <div style="display:flex;align-items:center;gap:12px;margin-bottom:14px">
          <div class="tx-icon" style="background:${iconBg};font-size:24px;width:44px;height:44px;border-radius:13px;display:flex;align-items:center;justify-content:center">${iconHtml}</div>
          <div>
            <div style="font-weight:700;font-size:16px">${esc(catLabel)}</div>
            <div style="font-size:12px;color:var(--text-sub)">${t.occurred_at || ''}</div>
          </div>
          <div style="margin-left:auto;font-weight:800;font-size:20px;font-variant-numeric:tabular-nums;color:${amtColor}">${amtText}</div>
        </div>
        ${isTransfer
          ? `<div style="font-size:14px;color:var(--text);margin-bottom:10px">${fa ? esc(fa.name) : '?'} → ${ta ? esc(ta.name) : '?'}</div>`
          : (t.note ? `<div style="font-size:14px;color:var(--text);margin-bottom:10px">备注：${esc(t.note)}</div>` : '')}
        ${a ? `<div style="font-size:13px;color:var(--text-sub)">账户：${a.icon} ${esc(a.name)}</div>` : ''}
      </div>
      <button class="btn-ghost" id="tx-detail-delete" style="color:var(--danger,#FF3B30);margin-top:8px">🗑️ 删除此条记录</button>
    `);
    $('#m-close').addEventListener('click', closeModal);
    const editBtn = $('#tx-detail-edit');
    if (editBtn) editBtn.addEventListener('click', () => { closeModal(); openAddModal(null, t); });
    $('#tx-detail-delete').addEventListener('click', async () => {
      closeModal();
      if (!confirm('确定删除这条记录？' + (isTransfer ? '\n将同时恢复两个账户余额。' : ''))) return;
      if (isTransfer) {
        if (t.from_asset_id) await adjustAssetBalance(t.from_asset_id, 'expense', t.amount, -1);
        if (t.to_asset_id) await adjustAssetBalance(t.to_asset_id, 'income', t.amount, -1);
      } else if (t.asset_id && a) {
        const delta = t.type === 'income' ? -Number(t.amount) : Number(t.amount);
        await Store.saveAsset({ ...a, balance: Number(a.balance) + delta });
      }
      await Store.deleteTransaction(id);
      await loadAssets();
      await loadCategories();
      await loadTxs();
      refreshAll();
      toast('已删除');
    });
  }

  // ---------- 统计页 ----------
  let statGroupMode = 'small'; // 'small' = 小类, 'big' = 大类
  let statPeriod = 'month';    // 'month' = 本月, 'year' = 本年
  let statTrendMode = 'total'; // 'total' = 总额月度趋势, 'cat' = 按大类分项趋势, 'income' = 收入分项趋势
  let statTrendHidden = new Set(); // 大类趋势里被点掉（隐藏）的分类 id
  let statAnalysisType = 'expense'; // 'expense' = 支出分析, 'income' = 收入分析
  async function renderStats() {
    const view = $('#view-stats');
    const cm = catMap();
    const yearStr = state.month.split('-')[0];
    // 本年模式：拉取该年份全部交易（occurred_at 以 YYYY 开头）；本月模式：沿用当前月 state.txs
    const scopeTxs = statPeriod === 'year'
      ? await Store.getTransactions({ ledgerId: state.ledgerId, month: yearStr })
      : state.txs;
    const txs = scopeTxs;
    let exp = 0, inc = 0;
    const byCat = {};      // 支出按分类累计
    const byCatInc = {};   // 收入按分类累计
    // 按层级归组：大类模式把小类金额并入其所属大类
    const groupKey = t => {
      if (statGroupMode === 'big') {
        const c = cm[t.category_id];
        if (c && c.parent) return c.parent;
        return t.category_id;
      }
      return t.category_id;
    };
    txs.forEach(t => {
      if (t.type === 'expense') {
        exp += Number(t.amount);
        const k = groupKey(t);
        byCat[k] = (byCat[k] || 0) + Number(t.amount);
      } else if (t.type === 'income') {
        inc += Number(t.amount);
        const k = groupKey(t);
        byCatInc[k] = (byCatInc[k] || 0) + Number(t.amount);
      }
      // type==='transfer' 不计入收支汇总（转账是账户间资金移动，已在资产余额中体现）
    });

    // 支出 / 收入 分别按分类归组成 segs
    const buildSegs = obj => Object.keys(obj).map(cid => {
      const c = cm[cid] || { name: '未分类', color: '#999', icon: '📦' };
      return { key: cid, name: c.name, value: obj[cid], color: c.color };
    }).sort((a, b) => b.value - a.value);

    const expSegs = buildSegs(byCat);
    const incSegs = buildSegs(byCatInc);

    // 当前分析类型对应的数据（支出 / 收入）
    const isExp = statAnalysisType === 'expense';
    const curSegs = isExp ? expSegs : incSegs;
    const curTotal = isExp ? exp : inc;

    const donut = curSegs.length
      ? buildDonut(curSegs, 150, 20)
      : `<div class="empty">${statPeriod === 'year' ? '本年' : '本月'}暂无${isExp ? '支出' : '收入'}</div>`;
    const legend = curSegs.length
      ? curSegs.map(s => `<div class="legend-row" data-cat="${s.key}"><span class="legend-dot" style="background:${s.color}"></span><span class="legend-name">${esc(s.name)}</span><span class="legend-val">${fmt(s.value)} · ${(s.value / (curTotal || 1) * 100).toFixed(0)}%</span></div>`).join('')
      : '';

    const bars = curSegs.length ? curSegs.slice(0, 6).map(s => {
      const pct = (s.value / (curSegs[0].value || 1)) * 100;
      return `<div class="bar-row" data-cat="${s.key}"><div class="bar-head"><span>${esc(s.name)}</span><span>${fmt(s.value)}</span></div><div class="bar-track"><div class="bar-fill" style="width:${pct}%"></div></div></div>`;
    }).join('') : '';

    // 预算（仅本月模式有意义；按年为月度预算汇总无意义，故隐藏）
    const budgets = await Store.getBudgets({ ledgerId: state.ledgerId, month: state.month });
    const budget = budgets.find(b => !b.category_id);
    let budgetCard = '';
    if (budget && statPeriod === 'month') {
      const denom = Number(budget.amount) || 1;
      const pct = Math.min(100, (exp / denom) * 100);
      const over = exp > Number(budget.amount);
      budgetCard = `<div class="card">
        <div class="card-title">本月预算</div>
        <div class="bar-head"><span>已用 ${fmt(exp)} / ${fmt(budget.amount)}</span><span style="color:${over ? 'var(--expense)' : 'var(--income)'}">${pct.toFixed(0)}%</span></div>
        <div class="bar-track"><div class="bar-fill" style="width:${pct}%;background:${over ? 'var(--expense)' : 'linear-gradient(90deg,var(--primary),#6E5BEF)'}"></div></div>
        ${over ? '<div style="color:var(--expense);font-size:12px;margin-top:6px">已超出预算 ' + fmt(exp - Number(budget.amount)) + '</div>' : ''}
      </div>`;
    }

    const trendCard = statPeriod === 'year' ? buildTrendCard(txs, cm, yearStr) : '';

    view.innerHTML = `
      <div class="card" style="padding:14px 16px">
        <div class="seg seg-full">
          <button class="seg-btn${statPeriod === 'month' ? ' active' : ''}" data-p="month">本月</button>
          <button class="seg-btn${statPeriod === 'year' ? ' active' : ''}" data-p="year">本年</button>
        </div>
        ${statPeriod === 'year'
          ? `<div style="display:flex;align-items:center;justify-content:center;gap:14px;margin-top:12px">
               <button class="yr-nav" id="yr-prev" type="button">‹</button>
               <span style="font-weight:700;font-size:15px">${yearStr} 年</span>
               <button class="yr-nav" id="yr-next" type="button">›</button>
             </div>`
          : ''}
      </div>
      <div class="stat-summary">
        <div class="stat-box"><div class="v" style="color:var(--expense)">${fmt(exp)}</div><div class="l">支出</div></div>
        <div class="stat-box"><div class="v" style="color:var(--income)">${fmt(inc)}</div><div class="l">收入</div></div>
        <div class="stat-box"><div class="v">${fmt(inc - exp)}</div><div class="l">结余</div></div>
      </div>
      ${budgetCard}
      <div class="card">
        <div class="ana-head">
          <div class="card-title">${isExp ? '支出构成' : '收入构成'}${statPeriod === 'year' ? '（本年）' : ''}</div>
          <div class="seg seg-mini">
            <button class="seg-btn${isExp ? ' active' : ''}" data-ana="expense">支出</button>
            <button class="seg-btn${!isExp ? ' active' : ''}" data-ana="income">收入</button>
          </div>
        </div>
        <div class="seg" style="margin:8px 0 12px">
          <button class="seg-btn${statGroupMode === 'small' ? ' active' : ''}" data-g="small">按小类</button>
          <button class="seg-btn${statGroupMode === 'big' ? ' active' : ''}" data-g="big">按大类</button>
        </div>
        <div class="donut-wrap">
          <div class="donut-center">${donut}</div>
          <div class="donut-legend">${legend}</div>
        </div>
      </div>
      <div class="card">
        <div class="card-title">${isExp ? '支出' : '收入'}分类排行${statPeriod === 'year' ? '（本年）' : ''}</div>
        ${bars || '<div class="empty">暂无数据</div>'}
      </div>
      ${trendCard}`;
    $$('#view-stats .seg-btn').forEach(b => b.addEventListener('click', () => {
      if (b.dataset.g) statGroupMode = b.dataset.g;
      else if (b.dataset.p) statPeriod = b.dataset.p;
      else if (b.dataset.t) statTrendMode = b.dataset.t;
      else if (b.dataset.ana) statAnalysisType = b.dataset.ana;
      renderStats();
    }));
    $$('#view-stats .trend-legend-item[data-cat]').forEach(el => {
      el.addEventListener('click', () => {
        const cid = el.dataset.cat;
        if (statTrendHidden.has(cid)) statTrendHidden.delete(cid);
        else statTrendHidden.add(cid);
        renderStats();
      });
    });
    $$('#view-stats .trend-month-hit').forEach(el => {
      el.addEventListener('click', () => {
        const mi = Number(el.dataset.month);
        openMonthStatsModal(yearStr, mi, txs, cm);
      });
    });
    if (statPeriod === 'year') {
      const yp = $('#yr-prev'), yn = $('#yr-next');
      if (yp) yp.addEventListener('click', () => changeYear(-1));
      if (yn) yn.addEventListener('click', () => changeYear(1));
    }
    $$('#view-stats .legend-row, #view-stats .bar-row').forEach(el => {
      el.addEventListener('click', () => openCategoryStatsModal(el.dataset.cat, scopeTxs, statPeriod === 'year' ? yearStr + ' 年' : state.month, statAnalysisType));
    });
  }

  function buildDonut(segs, size, stroke) {
    const total = segs.reduce((s, x) => s + x.value, 0) || 1;
    const r = (size - stroke) / 2;
    const c = 2 * Math.PI * r;
    const cx = size / 2, cy = size / 2;
    let offset = 0;
    let circles = '';
    segs.forEach(s => {
      const len = (s.value / total) * c;
      circles += `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${s.color}" stroke-width="${stroke}" stroke-dasharray="${len} ${c - len}" stroke-dashoffset="${-offset}" transform="rotate(-90 ${cx} ${cy})"/>`;
      offset += len;
    });
    return `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
      <circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="#eef0f6" stroke-width="${stroke}"/>
      ${circles}
      <text x="${cx}" y="${cy - 4}" text-anchor="middle" font-size="13" fill="#8a90a2">总支出</text>
      <text x="${cx}" y="${cy + 14}" text-anchor="middle" font-size="15" font-weight="800" fill="#1f2533">${fmt(total).slice(1)}</text>
    </svg>`;
  }

  // ---------- 月度趋势（本年） ----------
  function niceMax(v) {
    if (v <= 0) return 1;
    const pow = Math.pow(10, Math.floor(Math.log10(v)));
    const n = v / pow;
    let nice;
    if (n <= 1) nice = 1; else if (n <= 2) nice = 2; else if (n <= 2.5) nice = 2.5; else if (n <= 5) nice = 5; else nice = 10;
    return nice * pow;
  }
  function fmtAxis(v) {
    if (v >= 10000) return '¥' + (v / 10000).toFixed(v >= 100000 ? 0 : 1) + '万';
    if (v >= 1000) return '¥' + (v / 1000).toFixed(1) + 'k';
    return '¥' + Math.round(v);
  }
  // 汇总全年逐月数据：支出/收入/各大类逐月金额
  function buildTrend(txs, cm, yearStr) {
    const exp = new Array(12).fill(0);
    const inc = new Array(12).fill(0);
    const catMonth = {};     // 支出大类 cid -> [12]
    const catMonthInc = {};  // 收入大类 cid -> [12]
    txs.forEach(t => {
      if (!t.occurred_at || t.occurred_at.slice(0, 4) !== yearStr) return;
      const mi = Math.max(0, Math.min(11, (parseInt(t.occurred_at.slice(5, 7), 10) || 1) - 1));
      const amt = Number(t.amount) || 0;
      if (t.type === 'expense') {
        exp[mi] += amt;
        let cid = t.category_id;
        const c = cm[cid];
        cid = (c && c.parent) ? c.parent : cid; // 始终按大类归组
        if (cid) {
          if (!catMonth[cid]) catMonth[cid] = new Array(12).fill(0);
          catMonth[cid][mi] += amt;
        }
      } else if (t.type === 'income') {
        inc[mi] += amt;
        let cid = t.category_id;
        const c = cm[cid];
        cid = (c && c.parent) ? c.parent : cid;
        if (cid) {
          if (!catMonthInc[cid]) catMonthInc[cid] = new Array(12).fill(0);
          catMonthInc[cid][mi] += amt;
        }
      }
      // type==='transfer' 不计入收支趋势（账户间资金移动）
    });
    return { exp, inc, catMonth, catMonthInc };
  }
  // 总额模式：逐月「支出 + 收入」分组柱状图
  function renderTrendTotal(agg) {
    const W = 340, H = 212, padL = 38, padR = 6, padT = 14, padB = 24;
    const plotW = W - padL - padR, plotH = H - padT - padB, baseY = padT + plotH;
    const maxRaw = Math.max(1, ...agg.exp, ...agg.inc);
    const maxNice = niceMax(maxRaw);
    const groupW = plotW / 12;
    const barW = Math.min(9, groupW / 3);
    const off = barW / 2 + 1.2;
    let s = `<svg viewBox="0 0 ${W} ${H}" width="100%" style="display:block">`;
    const lines = 3;
    for (let i = 0; i <= lines; i++) {
      const v = maxNice * i / lines, y = baseY - (v / maxNice) * plotH;
      s += `<line x1="${padL}" y1="${y.toFixed(1)}" x2="${W - padR}" y2="${y.toFixed(1)}" stroke="#E5E5EA" stroke-width="1"/>`;
      s += `<text x="4" y="${(y - 3).toFixed(1)}" font-size="8" fill="#8E8E93" text-anchor="start">${fmtAxis(v)}</text>`;
    }
    for (let m = 0; m < 12; m++) {
      const cx = padL + groupW * m + groupW / 2;
      const he = (agg.exp[m] / maxNice) * plotH;
      const hi = (agg.inc[m] / maxNice) * plotH;
      s += `<rect x="${(cx - off - barW / 2).toFixed(1)}" y="${(baseY - he).toFixed(1)}" width="${barW}" height="${he.toFixed(1)}" rx="2" fill="#FF3B30"/>`;
      s += `<rect x="${(cx + off - barW / 2).toFixed(1)}" y="${(baseY - hi).toFixed(1)}" width="${barW}" height="${hi.toFixed(1)}" rx="2" fill="#34C759"/>`;
      s += `<text x="${cx.toFixed(1)}" y="${baseY + 13}" font-size="8" fill="#8E8E93" text-anchor="middle">${m + 1}</text>`;
    }
    // 每月整列透明热区：点击下钻当月明细
    for (let m = 0; m < 12; m++) {
      s += `<rect class="trend-month-hit" data-month="${m}" x="${(padL + groupW * m).toFixed(1)}" y="${padT}" width="${groupW.toFixed(1)}" height="${(baseY - padT + 16).toFixed(1)}" fill="transparent"/>`;
    }
    s += `</svg>`;
    return s;
  }
  // 大类模式：Top5 大类逐月折线图（可点图例隐藏）
  function renderTrendCat(agg, cm) {
    const W = 340, H = 212, padL = 38, padR = 6, padT = 14, padB = 24;
    const plotW = W - padL - padR, plotH = H - padT - padB, baseY = padT + plotH;
    const sums = {};
    Object.keys(agg.catMonth).forEach(cid => { sums[cid] = agg.catMonth[cid].reduce((a, b) => a + b, 0); });
    const topCats = Object.keys(sums).sort((a, b) => sums[b] - sums[a]).slice(0, 5);
    let maxRaw = 1;
    topCats.forEach(cid => agg.catMonth[cid].forEach(v => { if (v > maxRaw) maxRaw = v; }));
    const maxNice = niceMax(maxRaw);
    const stepX = plotW / 11;
    const xOf = m => padL + stepX * m;
    const yOf = v => baseY - (v / maxNice) * plotH;
    let s = `<svg viewBox="0 0 ${W} ${H}" width="100%" style="display:block">`;
    const lines = 3;
    for (let i = 0; i <= lines; i++) {
      const v = maxNice * i / lines, y = yOf(v);
      s += `<line x1="${padL}" y1="${y.toFixed(1)}" x2="${W - padR}" y2="${y.toFixed(1)}" stroke="#E5E5EA" stroke-width="1"/>`;
      s += `<text x="4" y="${(y - 3).toFixed(1)}" font-size="8" fill="#8E8E93" text-anchor="start">${fmtAxis(v)}</text>`;
    }
    for (let m = 0; m < 12; m++) s += `<text x="${xOf(m).toFixed(1)}" y="${baseY + 13}" font-size="8" fill="#8E8E93" text-anchor="middle">${m + 1}</text>`;
    topCats.forEach(cid => {
      if (statTrendHidden.has(cid)) return;
      const c = cm[cid] || { name: '未分类', color: '#999' };
      let pts = '';
      for (let m = 0; m < 12; m++) pts += `${xOf(m).toFixed(1)},${yOf(agg.catMonth[cid][m]).toFixed(1)} `;
      s += `<polyline points="${pts.trim()}" fill="none" stroke="${c.color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>`;
      for (let m = 0; m < 12; m++) s += `<circle cx="${xOf(m).toFixed(1)}" cy="${yOf(agg.catMonth[cid][m]).toFixed(1)}" r="2" fill="${c.color}"/>`;
    });
    s += `</svg>`;
    const legend = topCats.map(cid => {
      const c = cm[cid] || { name: '未分类', color: '#999' };
      const off2 = statTrendHidden.has(cid);
      return `<div class="trend-legend-item${off2 ? ' off' : ''}" data-cat="${cid}"><span class="trend-dot" style="background:${c.color}"></span>${esc(c.name)}</div>`;
    }).join('');
    return { svg: s, legend };
  }
  // 收入模式：Top5 收入大类逐月折线图（可点图例隐藏）
  function renderTrendInc(agg, cm) {
    const W = 340, H = 212, padL = 38, padR = 6, padT = 14, padB = 24;
    const plotW = W - padL - padR, plotH = H - padT - padB, baseY = padT + plotH;
    const sums = {};
    Object.keys(agg.catMonthInc).forEach(cid => { sums[cid] = agg.catMonthInc[cid].reduce((a, b) => a + b, 0); });
    const topCats = Object.keys(sums).sort((a, b) => sums[b] - sums[a]).slice(0, 5);
    const palette = ['#34C759', '#007AFF', '#FF9500', '#AF52DE', '#FF2D55', '#5AC8FA'];
    let maxRaw = 1;
    topCats.forEach(cid => agg.catMonthInc[cid].forEach(v => { if (v > maxRaw) maxRaw = v; }));
    const maxNice = niceMax(maxRaw);
    const stepX = plotW / 11;
    const xOf = m => padL + stepX * m;
    const yOf = v => baseY - (v / maxNice) * plotH;
    let s = `<svg viewBox="0 0 ${W} ${H}" width="100%" style="display:block">`;
    const lines = 3;
    for (let i = 0; i <= lines; i++) {
      const v = maxNice * i / lines, y = yOf(v);
      s += `<line x1="${padL}" y1="${y.toFixed(1)}" x2="${W - padR}" y2="${y.toFixed(1)}" stroke="#E5E5EA" stroke-width="1"/>`;
      s += `<text x="4" y="${(y - 3).toFixed(1)}" font-size="8" fill="#8E8E93" text-anchor="start">${fmtAxis(v)}</text>`;
    }
    for (let m = 0; m < 12; m++) s += `<text x="${xOf(m).toFixed(1)}" y="${baseY + 13}" font-size="8" fill="#8E8E93" text-anchor="middle">${m + 1}</text>`;
    topCats.forEach((cid, idx) => {
      if (statTrendHidden.has(cid)) return;
      const c = cm[cid] || { name: '未分类' };
      const color = palette[idx % palette.length];
      let pts = '';
      for (let m = 0; m < 12; m++) pts += `${xOf(m).toFixed(1)},${yOf(agg.catMonthInc[cid][m]).toFixed(1)} `;
      s += `<polyline points="${pts.trim()}" fill="none" stroke="${color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>`;
      for (let m = 0; m < 12; m++) s += `<circle cx="${xOf(m).toFixed(1)}" cy="${yOf(agg.catMonthInc[cid][m]).toFixed(1)}" r="2" fill="${color}"/>`;
    });
    s += `</svg>`;
    const legend = topCats.map((cid, idx) => {
      const c = cm[cid] || { name: '未分类' };
      const off2 = statTrendHidden.has(cid);
      const color = palette[idx % palette.length];
      return `<div class="trend-legend-item${off2 ? ' off' : ''}" data-cat="${cid}"><span class="trend-dot" style="background:${color}"></span>${esc(c.name)}</div>`;
    }).join('');
    return { svg: s, legend };
  }
  // 组装月度趋势卡片
  function buildTrendCard(txs, cm, yearStr) {
    const agg = buildTrend(txs, cm, yearStr);
    let svg, legendHtml;
    if (statTrendMode === 'income') {
      const r = renderTrendInc(agg, cm);
      svg = r.svg; legendHtml = `<div class="trend-legend">${r.legend}</div>`;
    } else if (statTrendMode === 'cat') {
      const r = renderTrendCat(agg, cm);
      svg = r.svg; legendHtml = `<div class="trend-legend">${r.legend}</div>`;
    } else {
      svg = renderTrendTotal(agg);
      legendHtml = `<div class="trend-legend">
        <div class="trend-legend-item"><span class="trend-dot" style="background:#FF3B30"></span>支出</div>
        <div class="trend-legend-item"><span class="trend-dot" style="background:#34C759"></span>收入</div>
      </div>`;
    }
    const anyData = agg.exp.some(v => v > 0) || agg.inc.some(v => v > 0) || Object.keys(agg.catMonth).length > 0 || Object.keys(agg.catMonthInc).length > 0;
    return `<div class="card">
      <div class="card-title">月度趋势（${yearStr} 年）</div>
      <div class="seg" style="margin:2px 0 10px">
        <button class="seg-btn${statTrendMode === 'total' ? ' active' : ''}" data-t="total">总额</button>
        <button class="seg-btn${statTrendMode === 'cat' ? ' active' : ''}" data-t="cat">按大类</button>
        <button class="seg-btn${statTrendMode === 'income' ? ' active' : ''}" data-t="income">收入</button>
      </div>
      ${anyData ? svg + legendHtml : '<div class="empty">本年暂无数据</div>'}
    </div>`;
  }

  // 统计下钻：点击某分类查看该周期（本月/本年）该分类的交易明细
  function openCategoryStatsModal(cid, scopeTxs, periodLabel, analysisType) {
    if (!cid) return;
    const isExp = (analysisType || 'expense') === 'expense';
    const typeFilter = isExp ? 'expense' : 'income';
    const cm = catMap();
    const base = (scopeTxs && scopeTxs.length) ? scopeTxs : (state.txs || []);
    const label = periodLabel || state.month;
    let txs = base.filter(t => {
      if (t.type !== typeFilter) return false;   // 只保留当前分析类型的交易
      const c = t.category_id ? cm[t.category_id] : null;
      if (statGroupMode === 'big') {
        const key = (c && c.parent) ? c.parent : t.category_id;
        return key === cid;
      }
      return t.category_id === cid;
    });
    txs.sort((a, b) => (b.occurred_at + b.id).localeCompare(a.occurred_at + a.id));
    const c = cm[cid];
    const name = c ? (c.parent ? cm[c.parent].name + '/' + c.name : c.name) : '未分类';
    const total = txs.reduce((s, t) => s + Number(t.amount), 0);
    const list = txs.length ? txs.map(t => txRow(t, cm)).join('') : '<div class="empty">该周期暂无此分类记录</div>';
    openModal(`
      <div class="modal-header"><div class="modal-title">${esc(name)}</div><button class="modal-close" id="m-close">×</button></div>
      <div style="text-align:center;padding:6px 0 14px">
        <div style="font-size:12px;color:var(--text-sub)">${label} · ${isExp ? '支出' : '收入'}合计</div>
        <div style="font-size:26px;font-weight:800;color:${isExp ? 'var(--expense)' : 'var(--income)'};font-variant-numeric:tabular-nums">${fmt(total)}</div>
        <div style="font-size:12px;color:var(--text-sub)">共 ${txs.length} 笔（点击查看 / 长按可编辑删除）</div>
      </div>
      <div class="detail-tx-list">${list}</div>
    `);
    $('#m-close').addEventListener('click', closeModal);
    bindTxDelete($('#modal-root'));
  }

  // 月度趋势·总额柱状图：点击某月下钻当月明细
  function openMonthStatsModal(yearStr, mi, txs, cm) {
    const mm = String(mi + 1).padStart(2, '0');
    const ym = `${yearStr}-${mm}`;
    let list = (txs || []).filter(t => (t.occurred_at || '').slice(0, 7) === ym);
    list.sort((a, b) => (b.occurred_at + b.id).localeCompare(a.occurred_at + a.id));
    const exp = list.filter(t => t.type === 'expense').reduce((s, t) => s + Number(t.amount), 0);
    const inc = list.filter(t => t.type === 'income').reduce((s, t) => s + Number(t.amount), 0);
    const html = list.length ? list.map(t => txRow(t, cm)).join('') : '<div class="empty">该月暂无记录</div>';
    openModal(`
      <div class="modal-header"><div class="modal-title">${yearStr} 年 ${mi + 1} 月</div><button class="modal-close" id="m-close">×</button></div>
      <div style="display:flex;justify-content:space-around;text-align:center;padding:10px 0 14px">
        <div><div style="font-size:12px;color:var(--text-sub)">支出</div><div style="font-size:20px;font-weight:800;color:var(--expense)">${fmt(exp)}</div></div>
        <div><div style="font-size:12px;color:var(--text-sub)">收入</div><div style="font-size:20px;font-weight:800;color:var(--income)">${fmt(inc)}</div></div>
        <div><div style="font-size:12px;color:var(--text-sub)">笔数</div><div style="font-size:20px;font-weight:800">${list.length}</div></div>
      </div>
      <div class="detail-tx-list">${html}</div>
    `);
    $('#m-close').addEventListener('click', closeModal);
    bindTxDelete($('#modal-root'));
  }

  // ---------- 我的页 ----------
  async function renderMine() {
    const view = $('#view-mine');
    const s = Store.getSyncStatus();
    const statusPill = s.on
      ? '<span class="status-pill synced">● 已开启云端同步（多端自动同步）</span>'
      : '<span class="status-pill local">● 本地存储（数据仅在本机，离线可用）</span>';

    view.innerHTML = `
      <div class="card" style="text-align:center" id="sync-pill">${statusPill}</div>
      <div class="menu-list">
        <div class="menu-item" data-act="categories"><span class="mi-icon">🏷️</span><span class="mi-text">分类管理</span><span class="mi-arrow">›</span></div>
        <div class="menu-item" data-act="budget"><span class="mi-icon">🎯</span><span class="mi-text">月度预算</span><span class="mi-arrow">›</span></div>
        <div class="menu-item" data-act="recurring"><span class="mi-icon">🔁</span><span class="mi-text">周期记账</span><span class="mi-arrow">›</span></div>
      </div>
      <div class="menu-list">
        <div class="menu-item" data-act="sync"><span class="mi-icon">☁️</span><span class="mi-text">联网同步</span><span class="mi-arrow">›</span></div>
        <div class="menu-item" data-act="settings"><span class="mi-icon">💾</span><span class="mi-text">数据备份</span><span class="mi-arrow">›</span></div>
        <div class="menu-item" data-act="about"><span class="mi-icon">ℹ️</span><span class="mi-text">关于</span><span class="mi-arrow">›</span></div>
      </div>
      <div class="menu-list">
        <div class="menu-item" id="install-app" data-act="install" style="display:none"><span class="mi-icon">📲</span><span class="mi-text">安装到本地</span><span class="mi-arrow">›</span></div>
        <div id="install-tip" style="display:none;font-size:12px;color:var(--text-sub);padding:6px 14px 10px">可安装到主屏，像 App 一样离线打开。</div>
      </div>`;

    $$('#view-mine .menu-item').forEach(el => {
      el.addEventListener('click', () => {
        const act = el.dataset.act;
        if (act === 'categories') openCategoryModal();
        else if (act === 'budget') openBudgetModal();
        else if (act === 'recurring') openRecurringModal();
        else if (act === 'sync') openSyncModal();
        else if (act === 'settings') openBackupModal();
        else if (act === 'about') openAboutModal();
        else if (act === 'install') { if (window.installApp) window.installApp(); };
      });
    });
  }

  // ---------- 记一笔弹窗（支持新增与编辑：传入 editTx 即进入编辑模式）----------
  async function openAddModal(prefillCat, editTx) {
    const cats = state.categories;
    const assets = (await Store.getAssets()) || [];
    const bigOf = t => cats.filter(c => c.type === t && !c.parent);
    const smallOf = (t, pid) => cats.filter(c => c.type === t && c.parent === pid);
    // 记账统一按小类：叶子小类 = 有 parent 的分类
    const leavesOf = t => cats.filter(c => c.type === t && c.parent);
    let type = editTx ? editTx.type : (prefillCat ? prefillCat.type : 'expense');
    let selCat = null;
    if (editTx) {
      selCat = editTx.category_id;                              // 编辑：直接用原分类
    } else if (prefillCat) {
      if (prefillCat.parent) selCat = prefillCat.id;              // 传入的是小类，直接用
      else { const fs = smallOf(type, prefillCat.id); selCat = fs[0] ? fs[0].id : prefillCat.id; } // 传入大类则回退到其首个小类
    } else {
      const fl = leavesOf(type); selCat = fl[0] ? fl[0].id : null;
    }
    let selAsset = editTx ? editTx.asset_id : (assets[0] ? assets[0].id : null);
    const editId = editTx ? editTx.id : null;

    // 分组平铺：大类作为分组小标题，小类为可直接点选项（一步选中，无需下钻）
    function catGrid() {
      const bigs = bigOf(type);
      const cell = c => `
        <div class="cat-item${c.id === selCat ? ' selected' : ''}" data-cat="${c.id}">
          <div class="cat-icon">${c.icon}</div>
          <div class="cat-name">${esc(c.name)}</div>
        </div>`;
      let html = '';
      bigs.forEach(big => {
        const smalls = smallOf(type, big.id);
        if (!smalls.length) return;
        html += `<div class="cat-group-title">${big.icon} ${esc(big.name)}</div>`;
        html += `<div class="cat-grid">${smalls.map(cell).join('')}</div>`;
      });
      // 兼容旧数据：没归入大类的孤立小类，或本身无子类的顶级分类
      const orphan = cats.filter(c => c.type === type && c.parent && !bigs.some(b => b.id === c.parent));
      const flat = cats.filter(c => c.type === type && !c.parent && smallOf(type, c.id).length === 0);
      const extra = orphan.concat(flat);
      if (extra.length) {
        html += `<div class="cat-group-title">其他</div>`;
        html += `<div class="cat-grid">${extra.map(cell).join('')}</div>`;
      }
      return html || '<div class="empty">暂无分类，请先到「分类管理」添加</div>';
    }

    openModal(`
      <div class="modal-header"><div class="modal-title">${editId ? '编辑记录' : '记一笔'}</div><button class="modal-close" id="m-close">×</button></div>
      <div class="type-toggle">
        <button class="type-btn expense${type === 'expense' ? ' active expense' : ''}" data-t="expense">支出</button>
        <button class="type-btn income${type === 'income' ? ' active income' : ''}" data-t="income">收入</button>
      </div>
      <div class="tx-form-top">
        <div class="amount-input"><span class="cur">¥</span><input id="amt" type="text" inputmode="decimal" placeholder="0.00" value="${editTx ? editTx.amount : ''}" autofocus /></div>
        <div id="acct-grid" class="tx-acct-row">
          ${assets.map(a => `<button type="button" class="acct-btn${a.id === selAsset ? ' active' : ''}" data-a="${a.id}" style="border:1px solid ${a.id === selAsset ? a.color : 'var(--line)'};background:${a.id === selAsset ? a.color + '1A' : '#fff'};color:${a.id === selAsset ? a.color : 'var(--text)'}">${a.icon} ${esc(a.name)}</button>`).join('')}
        </div>
      </div>
      <div class="cat-pick" id="cat-grid">${catGrid()}</div>
      <div class="tx-form-bottom">
        <div class="field"><input id="f-date" type="date" value="${editTx ? editTx.occurred_at : todayStr()}" /></div>
        <div class="field"><input id="f-note" type="text" placeholder="备注（选填）" value="${editTx ? esc(editTx.note || '') : ''}" /></div>
        <button class="btn-primary" id="save-tx">${editId ? '保存修改' : '保存'}</button>
      </div>
    `);

    $('#m-close').addEventListener('click', closeModal);
    $$('#modal-root .type-btn').forEach(b => b.addEventListener('click', () => {
      type = b.dataset.t;
      const fl = leavesOf(type);
      selCat = fl[0] ? fl[0].id : null;
      $$('#modal-root .type-btn').forEach(x => x.classList.remove('active', 'expense', 'income'));
      b.classList.add('active', type);
      $('#cat-grid').innerHTML = catGrid();
      bindCat();
    }));
    function bindCat() {
      const grid = $('#cat-grid');
      grid.querySelectorAll('.cat-item').forEach(el => el.addEventListener('click', () => {
        selCat = el.dataset.cat;
        grid.querySelectorAll('.cat-item').forEach(x => x.classList.remove('selected'));
        el.classList.add('selected');
      }));
    }
    bindCat();
    $$('#acct-grid .acct-btn').forEach(b => b.addEventListener('click', () => {
      selAsset = b.dataset.a;
      $$('#acct-grid .acct-btn').forEach(x => {
        const on = x === b;
        const ca = assets.find(z => z.id === x.dataset.a);
        x.style.borderColor = on ? (ca ? ca.color : 'var(--primary)') : 'var(--line)';
        x.style.background = on ? ((ca ? ca.color : 'var(--primary)') + '1A') : '#fff';
        x.style.color = on ? (ca ? ca.color : 'var(--primary)') : 'var(--text)';
        x.classList.toggle('active', on);
      });
    }));
    // 账户行拖拽排序（长按 0.2s 进入拖动，短按仍为选中；顺序持久化到各账户 sort 字段）
    const acctWrap = $('#acct-grid');
    if (acctWrap && window.Sortable) {
      Sortable.create(acctWrap, {
        animation: 160,
        delay: 200,
        delayOnTouchOnly: true,
        ghostClass: 'sortable-ghost',
        chosenClass: 'sortable-chosen',
        onEnd: async () => {
          const order = Array.from(acctWrap.querySelectorAll('.acct-btn')).map(el => el.dataset.a);
          for (let i = 0; i < order.length; i++) {
            const a = assets.find(x => x.id === order[i]);
            if (a && Number(a.sort) !== i) { a.sort = i; await Store.saveAsset(a); }
          }
          await loadAssets();
        }
      });
    }

    $('#save-tx').addEventListener('click', async () => {
      const amount = parseFloat($('#amt').value);
      if (!amount || amount <= 0) { toast('请输入金额'); return; }
      if (!selCat) { toast('请选择分类'); return; }
      const occurred_at = $('#f-date').value || todayStr();
      const note = $('#f-note').value.trim();
      const assetId = selAsset;
      // 编辑时先回退原交易对余额的影响，再应用新交易
      if (editId && editTx) {
        if (editTx.asset_id) await adjustAssetBalance(editTx.asset_id, editTx.type, editTx.amount, -1);
        if (assetId) await adjustAssetBalance(assetId, type, amount, +1);
      } else if (assetId) {
        await adjustAssetBalance(assetId, type, amount, +1);
      }
      const obj = { ledger_id: state.ledgerId, category_id: selCat, asset_id: assetId, type, amount, note, occurred_at };
      if (editId) obj.id = editId;
      await Store.saveTransaction(obj);
      closeModal();
      await loadTxs();
      refreshAll();
      toast(editId ? '已保存' : '已保存');
    });
  }

  // 备用图标库（记账常用 emoji，供分类编辑/新增点选）
  const PRESET_ICONS = [
    '🍜','🍚','🍔','🍟','🍕','🍱','☕','🍺','🍰','🍎',
    '🛒','🛍️','👕','👟','💄','📱','💻','🏠','💡','🔧',
    '🧹','🚇','🚌','🚕','✈️','🎮','🎬','🎵','📺','💊',
    '🏥','📚','✏️','💰','💵','💴','📈','🎁','🧧','📦',
    '⚽','🐱','🐶','🔔','🚲','🛻','🪑','🧾','💡','🎯'
  ];

  // 账户专用图标库（银行 / 支付 / 投资 / 资产类）
  const ASSET_ICONS = [
    // 银行 & 现金
    '🏦','🏛️','🏧','💰','💵','💴','💸','💳',
    // 支付 & 电子钱包
    '📱','💬','🔵','🟢','⚪','📲',
    // 投资 & 理财
    '📊','📈','📉','💹','🏅','💎','🌱','🔐',
    // 实物资产
    '🏠','🚗','🛵','⌚','💻','🎒',
    // 其他常用
    '🎁','🧧','✈️','🏖️','🎮','🍺','📚','⏰','🌐','❤️'
  ];
  // 预设账户颜色
  const PRESET_COLORS = ['#4C8DFF','#FF6B5E','#2BBF7A','#FF8A5B','#9B6BFF','#36C5C5','#FF5E9A','#5B8DEF','#07C160','#9AA0B5'];

  // ---------- 分类管理（大类卡片 + 内嵌小类，参考有鱼记账）----------
  async function openCategoryModal() {
    const cats = state.categories;
    const bigOptions = (type, exclude) =>
      cats.filter(c => c.type === type && !c.parent && (!exclude || c.id !== exclude))
        .map(c => `<option value="${c.id}">${esc(c.name)}</option>`).join('');
    // 单个大类卡片（含其小类清单 + 直接加小类按钮）
    function bigCard(big) {
      const smalls = cats.filter(c => c.parent === big.id);
      const smallRows = smalls.length ? smalls.map(s => `
        <div class="cat-small-row">
          <span class="cs-ico">${s.icon}</span>
          <span class="cs-name">${esc(s.name)}</span>
          <button class="lr-edit" data-edit="${s.id}">编辑</button>
          <button class="lr-del" data-del="${s.id}">删除</button>
        </div>`).join('')
        : '<div class="cat-small-empty">还没有小类，点右侧「＋小类」添加</div>';
      return `
        <div class="cat-big-card">
          <div class="cat-big-head">
            <span class="cb-ico">${big.icon}</span>
            <span class="cb-name">${esc(big.name)}</span>
            <span class="cb-count">${smalls.length} 个小类</span>
            <button class="cb-add" data-add-small="${big.id}">＋ 小类</button>
            <button class="lr-edit" data-edit="${big.id}">编辑</button>
            <button class="lr-del" data-del="${big.id}">删除</button>
          </div>
          <div class="cat-small-list">${smallRows}</div>
        </div>`;
    }
    function section(type) {
      const bigs = cats.filter(c => c.type === type && !c.parent);
      if (!bigs.length) return '<div class="empty">还没有大类，到下方「新增大类」添加</div>';
      return bigs.map(bigCard).join('');
    }
    openModal(`
      <div class="modal-header"><div class="modal-title">分类管理</div><button class="modal-close" id="m-close">×</button></div>
      <div class="cat-type-tab">
        <button class="ctt-btn active" data-t="expense">支出</button>
        <button class="ctt-btn" data-t="income">收入</button>
      </div>
      <div id="cat-sec-exp">${section('expense')}</div>
      <div id="cat-sec-inc" style="display:none">${section('income')}</div>

      <div class="card-title" style="margin-top:16px">新增大类</div>
      <div class="field"><span class="f-label">类型</span>
        <select id="nb-type"><option value="expense">支出</option><option value="income">收入</option></select></div>
      <div class="field"><span class="f-label">名称</span><input id="nb-name" placeholder="如：餐饮 / 交通 / 工资"/></div>
      <div class="icon-pick-title">选择图标</div>
      <div class="cat-grid" id="nb-icon-grid">${PRESET_ICONS.map(ic => `<div class="cat-item" data-ic="${ic}"><div class="cat-icon">${ic}</div></div>`).join('')}</div>
      <button class="btn-primary" id="add-big">添加大类</button>

      <div class="card-title" style="margin-top:16px">新增小类</div>
      <div class="field"><span class="f-label">所属大类</span>
        <select id="nc-parent"><option value="">请选择大类</option>${bigOptions('expense')}</select></div>
      <div class="field"><span class="f-label">名称</span><input id="nc-name" placeholder="如：早餐 / 午餐 / 打车"/></div>
      <div class="icon-pick-title">选择图标</div>
      <div class="cat-grid" id="nc-icon-grid">${PRESET_ICONS.map(ic => `<div class="cat-item" data-ic="${ic}"><div class="cat-icon">${ic}</div></div>`).join('')}</div>
      <button class="btn-primary" id="add-small">添加小类</button>
      <div style="font-size:12px;color:var(--text-sub);margin:10px 2px 0">提示：小类可随时改到其它大类——编辑该小类即可。</div>
    `);
    $('#m-close').addEventListener('click', closeModal);

    // 支出/收入 切换
    $$('#modal-root .ctt-btn').forEach(b => b.addEventListener('click', () => {
      const t = b.dataset.t;
      $$('#modal-root .ctt-btn').forEach(x => x.classList.toggle('active', x === b));
      $('#cat-sec-exp').style.display = t === 'expense' ? '' : 'none';
      $('#cat-sec-inc').style.display = t === 'income' ? '' : 'none';
      $('#nb-type').value = t;
      $('#nc-parent').innerHTML = '<option value="">请选择大类</option>' + bigOptions(t);
    }));

    // 图标点选（两个网格）
    const bindIcon = (gridId, mut) => {
      const grid = document.getElementById(gridId);
      grid.querySelectorAll('.cat-item').forEach(el => {
        if (el.dataset.ic === mut.v) el.classList.add('selected');
        el.addEventListener('click', () => {
          mut.v = el.dataset.ic;
          grid.querySelectorAll('.cat-item').forEach(x => x.classList.toggle('selected', x === el));
        });
      });
    };
    const nbMut = { v: PRESET_ICONS[0] }, ncMut = { v: PRESET_ICONS[0] };
    bindIcon('nb-icon-grid', nbMut);
    bindIcon('nc-icon-grid', ncMut);

    // 编辑 / 删除
    $$('#modal-root [data-edit]').forEach(b => b.addEventListener('click', () => {
      const c = cats.find(x => x.id === b.dataset.edit);
      if (c) openCategoryEditModal(c);
    }));
    $$('#modal-root [data-del]').forEach(b => b.addEventListener('click', async () => {
      const id = b.dataset.del;
      const c = cats.find(x => x.id === id);
      if (!c) return;
      const isBig = !c.parent;
      let msg = `删除分类「${c.name}」？\n已有的相关记录会显示为「未分类」，不会丢失金额。`;
      if (isBig) {
        const n = cats.filter(x => x.parent === id).length;
        if (n) msg = `删除大类「${c.name}」及其下 ${n} 个小类？\n相关记录会显示为「未分类」。`;
      }
      if (!confirm(msg)) return;
      if (isBig) {
        for (const s of cats.filter(x => x.parent === id)) await Store.deleteCategory(s.id);
      }
      await Store.deleteCategory(id);
      await loadCategories(); openCategoryModal();
    }));

    // 大类卡片上的「＋ 小类」：直接在该大类下加小类
    $$('#modal-root [data-add-small]').forEach(b => b.addEventListener('click', () => {
      openSmallAddModal(b.dataset.addSmall);
    }));

    // 新增大类
    $('#add-big').addEventListener('click', async () => {
      const name = $('#nb-name').value.trim();
      if (!name) { toast('请输入大类名称'); return; }
      const type = $('#nb-type').value;
      await Store.saveCategory({ name, type, icon: nbMut.v, color: type === 'expense' ? '#FF6B5E' : '#2BBF7A', builtin: false, parent: null });
      await loadCategories(); openCategoryModal();
    });
    // 新增小类
    $('#add-small').addEventListener('click', async () => {
      const name = $('#nc-name').value.trim();
      if (!name) { toast('请输入小类名称'); return; }
      const parent = $('#nc-parent').value;
      if (!parent) { toast('请先选择所属大类'); return; }
      const big = cats.find(x => x.id === parent);
      const type = big ? big.type : 'expense';
      await Store.saveCategory({ name, type, icon: ncMut.v, color: type === 'expense' ? '#FF6B5E' : '#2BBF7A', builtin: false, parent });
      await loadCategories(); openCategoryModal();
    });
  }

  // 在某个大类下直接加小类
  function openSmallAddModal(bigId) {
    const cats = state.categories;
    const big = cats.find(x => x.id === bigId);
    if (!big) return;
    const mut = { v: PRESET_ICONS[0] };
    openModal(`
      <div class="modal-header"><div class="modal-title">在「${esc(big.name)}」下加小类</div><button class="modal-close" id="m-close">×</button></div>
      <div style="text-align:center;margin:4px 0 12px;color:var(--text-sub);font-size:13px">该小类将归类到「${big.icon} ${esc(big.name)}」</div>
      <div class="field"><span class="f-label">小类名称</span><input id="sa-name" placeholder="如：早餐 / 打车 / 电影"/></div>
      <div class="icon-pick-title">选择图标</div>
      <div class="cat-grid" id="sa-icon-grid">${PRESET_ICONS.map(ic => `<div class="cat-item" data-ic="${ic}"><div class="cat-icon">${ic}</div></div>`).join('')}</div>
      <button class="btn-primary" id="sa-save">保存小类</button>
      <button class="btn-ghost" id="sa-back">返回</button>
    `);
    $('#m-close').addEventListener('click', closeModal);
    const grid = $('#sa-icon-grid');
    grid.querySelectorAll('.cat-item').forEach(el => {
      if (el.dataset.ic === mut.v) el.classList.add('selected');
      el.addEventListener('click', () => {
        mut.v = el.dataset.ic;
        grid.querySelectorAll('.cat-item').forEach(x => x.classList.toggle('selected', x === el));
      });
    });
    $('#sa-back').addEventListener('click', () => openCategoryModal());
    $('#sa-save').addEventListener('click', async () => {
      const name = $('#sa-name').value.trim();
      if (!name) { toast('请输入名称'); return; }
      await Store.saveCategory({ name, type: big.type, icon: mut.v, color: big.type === 'expense' ? '#FF6B5E' : '#2BBF7A', builtin: false, parent: bigId });
      await loadCategories(); openCategoryModal();
    });
  }

  // 分类编辑（改图标 / 名称 / 所属大类，不动 id，历史记录不受影响）
  function openCategoryEditModal(c) {
    const safeIcon = PRESET_ICONS.includes(c.icon) ? c.icon : null;
    const isBig = !c.parent;
    // 小类：可改到其它大类；大类：若已有小类则不可再挂到大类下
    const bigList = state.categories.filter(x => x.type === c.type && !x.parent && x.id !== c.id);
    const curParent = isBig ? null : c.parent;
    const moveSel = isBig
      ? (state.categories.some(x => x.parent === c.id)
          ? `<div class="field-note">该大类下还有小类，需先移走或删除它们，才能变更归属。</div>`
          : `<div class="field-note">大类可降级为独立小类（选择下方大类即可）。</div>
             <div class="field"><span class="f-label">所属大类</span><select id="ec-parent"><option value="">（无，作为独立分类）</option>${bigList.map(x => `<option value="${x.id}">${esc(x.name)}</option>`).join('')}</select></div>`)
      : `<div class="field"><span class="f-label">当前大类</span><span class="f-val">${esc((state.categories.find(x => x.id === curParent) || {}).name || '未归类')}</span></div>
         <div class="field"><span class="f-label">改到其它大类</span>
           <select id="ec-parent"><option value="${curParent || ''}">— 保持当前 —</option>${bigList.filter(x => x.id !== curParent).map(x => `<option value="${x.id}">${esc(x.name)}</option>`).join('')}<option value="">（无，作为独立分类）</option></select></div>`;
    openModal(`
      <div class="modal-header"><div class="modal-title">编辑分类</div><button class="modal-close" id="m-close">×</button></div>
      <div style="text-align:center;margin:6px 0 14px"><span style="font-size:44px" id="ec-preview">${c.icon}</span>
        <div style="font-size:12px;color:var(--text-sub);margin-top:4px">${c.type === 'expense' ? '支出分类' : '收入分类'} · ${isBig ? '大类' : '小类'}</div></div>
      <div class="field"><span class="f-label">名称</span><input id="ec-name" value="${esc(c.name)}" placeholder="分类名称"/></div>
      ${moveSel}
      <div class="icon-pick-title">选择图标</div>
      <div class="cat-grid" id="ec-icon-grid">${PRESET_ICONS.map(ic => `<div class="cat-item" data-ic="${ic}"><div class="cat-icon">${ic}</div></div>`).join('')}</div>
      <button class="btn-primary" id="save-cat">保存修改</button>
      <button class="btn-ghost" id="back-cat">返回</button>
    `);
    $('#m-close').addEventListener('click', closeModal);
    let ecSel = safeIcon || PRESET_ICONS[0];
    $$('#ec-icon-grid .cat-item').forEach(el => {
      if (el.dataset.ic === ecSel) el.classList.add('selected');
      el.addEventListener('click', () => {
        ecSel = el.dataset.ic;
        $('#ec-preview').textContent = ecSel;
        $$('#ec-icon-grid .cat-item').forEach(x => x.classList.toggle('selected', x === el));
      });
    });
    $('#back-cat').addEventListener('click', () => openCategoryModal());
    $('#save-cat').addEventListener('click', async () => {
      const name = $('#ec-name').value.trim();
      if (!name) { toast('请输入名称'); return; }
      let parent = null;
      const ps = document.getElementById('ec-parent');
      if (ps) parent = ps.value || null;
      if (parent && state.categories.some(x => x.parent === c.id)) {
        toast('该分类下还有小类，请先处理其小类'); return;
      }
      await Store.saveCategory({ ...c, name, icon: ecSel, parent });
      await loadCategories();
      refreshAll();
      openCategoryModal();
      toast('已保存');
    });
  }

  // ---------- 预算 ----------
  async function openBudgetModal() {
    const budgets = await Store.getBudgets({ ledgerId: state.ledgerId, month: state.month });
    const cur = budgets.find(b => !b.category_id);
    openModal(`
      <div class="modal-header"><div class="modal-title">${state.month} 预算</div><button class="modal-close" id="m-close">×</button></div>
      <div class="field"><span class="f-label">月度总预算</span><input id="b-amount" type="number" inputmode="decimal" placeholder="0" value="${cur ? cur.amount : ''}" style="text-align:right"/></div>
      <button class="btn-primary" id="save-budget">保存预算</button>
      ${cur ? '<button class="btn-ghost" id="del-budget">清除预算</button>' : ''}
    `);
    $('#m-close').addEventListener('click', closeModal);
    $('#save-budget').addEventListener('click', async () => {
      const amount = parseFloat($('#b-amount').value);
      if (!amount || amount <= 0) { toast('请输入金额'); return; }
      const obj = { ledger_id: state.ledgerId, category_id: null, month: state.month, amount };
      if (cur) obj.id = cur.id;
      await Store.saveBudget(obj);
      closeModal(); refreshAll(); toast('预算已保存');
    });
    const db = $('#del-budget');
    if (db) db.addEventListener('click', async () => {
      await Store.deleteBudget(cur.id);
      closeModal(); refreshAll(); toast('预算已清除');
    });
  }

  // ---------- 联网同步（军机处模型：本地编辑即推送，多端自动同步）----------
  function openSyncModal() {
    const s = Store.getSyncStatus();
    const cfg = Store.getConfig();
    openModal(`
      <div class="modal-header"><div class="modal-title">联网同步</div><button class="modal-close" id="m-close">×</button></div>
      <p style="font-size:13px;color:var(--text-sub);margin:0 0 14px">按「军机处」规则：本机编辑即自动推送云端；其它设备仅在本机<b>无未同步改动</b>时自动拉取。免登录，多端共享同一份数据。</p>
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:4px">
        <span style="font-size:14px;font-weight:600">启用云端同步</span>
        <label class="switch"><input type="checkbox" id="sync-on" ${s.on ? 'checked' : ''}/><span class="slider"></span></label>
      </div>
      <div id="sync-status-text" style="font-size:13px;color:var(--text-sub);margin:6px 0 10px">${syncStatusText(s)}</div>
      <button class="btn-primary" id="sync-now" style="margin-bottom:12px">立即同步</button>
      <div class="field"><span class="f-label">同步项目（多端须一致）</span><input id="sync-doc" type="text" value="${Store.getDocId()}" readonly /></div>
      <details style="margin-top:12px">
        <summary style="font-size:13px;color:var(--text-sub);cursor:pointer">高级：覆盖 Supabase 地址 / Key</summary>
        <div class="field" style="margin-top:8px"><span class="f-label">URL</span><input id="sync-url" type="text" value="${esc(cfg.url || '')}" placeholder="https://xxxx.supabase.co" /></div>
        <div class="field"><span class="f-label">Anon Key</span><input id="sync-key" type="text" value="${esc(cfg.key || '')}" placeholder="anon key" /></div>
        <button class="btn-ghost" id="sync-apply">保存并应用</button>
      </details>
    `);
    $('#m-close').addEventListener('click', closeModal);
    $('#sync-on').addEventListener('change', async (e) => {
      await Store.setSyncOn(e.target.checked);
      const ns = Store.getSyncStatus();
      const st = $('#sync-status-text'); if (st) st.textContent = syncStatusText(ns);
      if (state.view === 'mine') renderMine();
    });
    $('#sync-now').addEventListener('click', async () => {
      const r = await Store.syncNow();
      const st = $('#sync-status-text'); if (st) st.textContent = (r.msg || '') + ' · ' + syncStatusText(Store.getSyncStatus());
      if (state.view === 'mine') renderMine();
      toast(r.msg || '已同步');
    });
    const applyBtn = $('#sync-apply');
    if (applyBtn) applyBtn.addEventListener('click', async () => {
      await Store.applyConfig($('#sync-url').value.trim(), $('#sync-key').value.trim());
      toast('已应用，重新连接');
      const st = $('#sync-status-text'); if (st) st.textContent = syncStatusText(Store.getSyncStatus());
      if (state.view === 'mine') renderMine();
    });
  }

  // ---------- 数据备份（本地导出 / 导入）----------
  function openBackupModal() {
    openModal(`
      <div class="modal-header"><div class="modal-title">数据备份</div><button class="modal-close" id="m-close">×</button></div>
      <p style="font-size:13px;color:var(--text-sub);margin:0 0 14px">除下方本地导出备份（建议定期存到 iCloud / 文件 App）外，你也可以在「联网同步」里开启云端多端同步。两者互补，不冲突。</p>
      <button class="btn-primary" id="export-data">⬇️ 导出备份（JSON 文件）</button>
      <button class="btn-ghost" id="import-data">⬆️ 导入备份（从文件恢复）</button>
      <input type="file" id="import-file" accept="application/json" style="display:none" />
    `);
    $('#m-close').addEventListener('click', closeModal);
    $('#export-data').addEventListener('click', exportData);
    $('#import-data').addEventListener('click', () => $('#import-file').click());
    $('#import-file').addEventListener('change', e => { const f = e.target.files[0]; if (f) importData(f); });
  }

  // 导出：打包所有 yy_ 开头的本地数据为 JSON 文件下载
  function exportData() {
    const data = {};
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith('yy_') && k !== 'yy_supabase_config' && k !== 'yy_cloud_off') {
        data[k] = localStorage.getItem(k);
      }
    }
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = '口袋账本备份_' + new Date().toISOString().slice(0, 10) + '.json';
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
    toast('已导出备份文件 ✓');
  }

  // 导入：从 JSON 文件恢复（先覆盖写回 localStorage）
  async function importData(file) {
    let data;
    try {
      const text = await file.text();
      data = JSON.parse(text);
    } catch (e) {
      toast('导入失败：文件格式不正确');
      return;
    }
    // 覆盖前先统计数量，让用户看清风险，避免误导入旧备份丢失最新记录
    const curTx = Store.getTransactions({ ledgerId: state.ledgerId }).length;
    let bakTx = 0;
    try { bakTx = JSON.parse(data['yy_transactions'] || '[]').length; } catch (e) { }
    let warn = '';
    if (bakTx > 0 && bakTx < curTx) warn = '\n\n⚠️ 备份里的交易比当前少 ' + (curTx - bakTx) + ' 条，导入后将丢失这部分记录！';
    if (!confirm('导入将覆盖当前本机数据。\n当前交易：' + curTx + ' 条；备份交易：' + bakTx + ' 条。' + warn + '\n\n确定继续？')) return;
    try {
      let n = 0;
      for (const k in data) {
        // 不覆盖"当前查看月份"键，避免导入旧月份导致本月记录被过滤隐藏
        if (k.startsWith('yy_') && k !== 'yy_current_month') { localStorage.setItem(k, data[k]); n++; }
      }
      // 导入会换掉账本：强制按导入后的数据重设当前账本与月份，否则仍按旧 ledgerId 过滤会"看不见"记录
      state.ledgerId = Store.getLedgers()[0]?.id || null;
      state.month = monthKeyOf(new Date());
      await loadAssets(); await loadCategories(); await loadTxs();
      refreshAll();
      closeModal();
      toast('已从备份恢复 ' + n + ' 项 ✓');
    } catch (e) {
      toast('导入失败：写入出错');
    }
  }

  function openAboutModal() {
    const mode = Store.getMode();
    openModal(`
      <div class="modal-header"><div class="modal-title">关于</div><button class="modal-close" id="m-close">×</button></div>
      <div style="text-align:center;padding:10px 0">
        <div style="font-size:40px">🐟</div>
        <div style="font-weight:800;font-size:18px;margin-top:6px">口袋账本</div>
        <div style="color:var(--text-sub);font-size:12px;margin-top:4px">参考有鱼记账 · 纯前端 · 本机存储</div>
        <div style="margin-top:10px">${mode === 'synced' ? '<span class="status-pill live">实时同步中</span>' : '<span class="status-pill local">本地模式</span>'}</div>
      </div>`);
    $('#m-close').addEventListener('click', closeModal);
  }

  // ---------- 资产页 ----------
  // 折叠状态存 localStorage（个人 UI 偏好，不同步云端）
  const COLLAPSE_KEY = 'asset_collapse_v1';
  function getCollapse() { try { return JSON.parse(localStorage.getItem(COLLAPSE_KEY) || '{}'); } catch { return {}; } }
  function setCollapse(c) { try { localStorage.setItem(COLLAPSE_KEY, JSON.stringify(c)); } catch {} }
  function toggleCollapse(kind) {
    const c = getCollapse(); c[kind] = !c[kind]; setCollapse(c);
    const el = document.querySelector(`.asset-group[data-gkey="${kind}"]`);
    if (el) el.classList.toggle('collapsed', !!c[kind]);
    const chev = el && el.querySelector('.agh-chevron');
    if (chev) chev.textContent = c[kind] ? '▶' : '▼';
    const body = el && el.querySelector('.asset-group-body');
    if (body) body.style.display = c[kind] ? 'none' : '';
  }
  function sortByOrder(x, y) {
    return (Number(x.sort) || 0) - (Number(y.sort) || 0) || (x.id < y.id ? -1 : 1);
  }
  async function moveAsset(id, dir) {
    const a = (state.assets || []).find(x => x.id === id);
    if (!a) return;
    const aKind = a.kind || 'asset';
    const group = (state.assets || [])
      .filter(x => (x.kind || 'asset') === aKind)
      .sort(sortByOrder);
    const i = group.findIndex(x => x.id === id);
    const j = dir === 'up' ? i - 1 : i + 1;
    if (j < 0 || j >= group.length) return;
    [group[i], group[j]] = [group[j], group[i]];
    // 重新归一化 sort 并保存（幂等且保证后续顺序确定）
    for (let k = 0; k < group.length; k++) {
      const item = group[k];
      if (Number(item.sort) !== k) {
        item.sort = k;
        await Store.saveAsset(item);
      }
    }
    await loadAssets(); refreshAll();
  }

  async function renderAssets() {
    const view = $('#view-assets');
    const assets = state.assets || [];
    const total = assets.reduce((s, a) => s + Number(a.balance), 0);
    const isCredit = a => (a.kind || 'asset') === 'credit';
    const collapse = getCollapse();
    const groups = [
      { key: 'asset',  title: '资产账户', items: assets.filter(a => !isCredit(a)).sort(sortByOrder) },
      { key: 'credit', title: '信用卡',   items: assets.filter(isCredit).sort(sortByOrder) }
    ].filter(g => g.items.length > 0);
    function groupHTML(g) {
      const isCollapsed = !!collapse[g.key];
      const gTotal = g.items.reduce((s, a) => s + Number(a.balance), 0);
      const rows = g.items.map((a, i) => {
        const bal = Number(a.balance);
        return `
        <div class="asset-bar" data-key="${a.id}" style="background:linear-gradient(135deg,${lightenColor(a.color,24)},${lightenColor(a.color,8)})">
          <div class="asset-bar-icon">${a.icon}</div>
          <div class="asset-bar-name">${esc(a.name)}</div>
          <div class="asset-bar-bal">${fmt(a.balance)}</div>
          ${isCredit(a) && a.credit_limit ? `<div class="asset-bar-sub">额度 ${fmt(a.credit_limit)} · 负债</div>` : ''}
        </div>`}).join('');
      return `
        <div class="asset-group ${isCollapsed ? 'collapsed' : ''}" data-gkey="${g.key}">
          <div class="asset-group-header" data-toggle="${g.key}">
            <span class="agh-chevron">${isCollapsed ? '▶' : '▼'}</span>
            <span class="agh-title">${g.title}</span>
            <span class="agh-count">${g.items.length}</span>
            <span class="agh-total">${fmt(gTotal)}</span>
          </div>
          <div class="asset-group-body" style="${isCollapsed ? 'display:none' : ''}">${rows}</div>
        </div>`;
    }
    const assetTotal = assets.filter(a => !isCredit(a)).reduce((s, a) => s + Number(a.balance), 0);
    const debtTotal = assets.filter(isCredit).reduce((s, a) => s + Math.abs(Number(a.balance)), 0);
    view.innerHTML = `
      <div class="net-worth-card">
        <div class="nwc-head">净资产（元）</div>
        <div class="nwc-amount" id="nwc-amount">${fmt(total)}</div>
        ${assets.length > 0 ? `<div class="nwc-split"><span>总资产 <b>${fmt(assetTotal)}</b></span><span>总负债 <b>${fmt(debtTotal)}</b></span></div>` : ''}
        <button class="btn-transfer" id="transfer-btn-top">转账</button>
      </div>
      ${groups.length ? groups.map(groupHTML).join('') : '<div class="empty">还没有账户，点下方「新增账户」</div>'}
      <button class="btn-primary" id="add-asset-btn" style="margin-top:4px">＋ 新增账户</button>
      <div style="font-size:12px;color:var(--text-sub);text-align:center;padding:8px 14px 2px">点击任意账户可改名 / 改性质 / 改余额</div>`;
    $$('#view-assets .asset-bar').forEach(el => {
      el.addEventListener('click', () => openAssetDetailModal(assets.find(a => a.id === el.dataset.key)));
    });
    $$('#view-assets .asset-group-header').forEach(el => {
      el.addEventListener('click', () => toggleCollapse(el.dataset.toggle));
    });
    // 拖拽排序：按住账户行 ~0.2 秒后即可自由上下拖（手机端防误触；电脑端无延迟）
    // 推到浏览器空闲帧再初始化，避免阻塞首次渲染（首屏快 200-500ms）
    const initSortables = () => groups.forEach(g => {
      const body = view.querySelector('.asset-group[data-gkey="'+g.key+'"] .asset-group-body');
      if (!body || !window.Sortable) return;
      Sortable.create(body, {
        animation: 160,
        delay: 200,
        delayOnTouchOnly: true,
        ghostClass: 'sortable-ghost',
        chosenClass: 'sortable-chosen',
        onEnd: async () => {
          const order = Array.from(body.querySelectorAll('.list-row')).map(el => el.dataset.key);
          let changed = false;
          for (let i = 0; i < order.length; i++) {
            const a = state.assets.find(x => x.id === order[i]);
            if (a && Number(a.sort) !== i) { a.sort = i; await Store.saveAsset(a); changed = true; }
          }
          if (changed) { await loadAssets(); refreshAll(); }
        }
      });
    });
    const ric = window.requestIdleCallback || ((fn) => setTimeout(fn, 30));
    ric(initSortables);
    const ab = $('#add-asset-btn'); if (ab) ab.addEventListener('click', () => openAssetAddModal());
    const tb = $('#transfer-btn-top') || $('#transfer-btn'); if (tb) tb.addEventListener('click', () => openTransferModal());
  }

  // 账户详情（只读），顶部右上角放「编辑」按钮
  function openAssetDetailModal(a) {
    if (!a) return;
    const isC = (a.kind || 'asset') === 'credit';
    const txs = (state.txs || []).filter(t => t.asset_id === a.id)
      .sort((x, y) => (y.date || '').localeCompare(x.date || '') || (y.id > x.id ? 1 : -1));
    const income  = txs.filter(t => t.type === 'income').reduce((s, t) => s + Number(t.amount), 0);
    const expense = txs.filter(t => t.type === 'expense').reduce((s, t) => s + Number(t.amount), 0);
    const balColor = Number(a.balance) < 0 ? 'var(--expense)' : 'var(--text)';
    const txHTML = txs.length ? txs.slice(0, 60).map(t => {
      const cat = (state.categories || []).find(c => c.id === t.category_id);
      const cIcon = (cat && cat.icon) || '\u{1F4E6}';
      const cColor = (cat && cat.color) || '#999';
      const cName = (cat && cat.name) || '\u672A\u5206\u7C7B';
      const note = t.note ? ' \u00B7 ' + esc(t.note) : '';
      const sign = t.type === 'expense' ? '-' : '+';
      const col = t.type === 'expense' ? 'var(--expense)' : 'var(--income)';
      return `<div class="list-row" style="cursor:default;-webkit-user-select:none;user-select:none">
        <span class="lr-icon" style="background:${cColor}22">${cIcon}</span>
        <span class="lr-main">
          <div class="lr-title">${esc(cName)}</div>
          <div class="lr-sub">${t.date || ''}${note}</div>
        </span>
        <span style="font-weight:700;font-variant-numeric:tabular-nums;color:${col}">${sign}${fmt(t.amount)}</span>
      </div>`;
    }).join('') : '<div class="empty">\u8FD8\u6CA1\u6709\u4EA4\u6613\u8BB0\u5F55</div>';
    openModal(`
      <div class="modal-header">
        <div class="modal-title">\u8D26\u6237\u8BE6\u60C5</div>
        <div class="modal-header-right">
          <button class="modal-edit-btn" id="m-edit">\u7F16\u8F91</button>
          <button class="modal-close" id="m-close">\u00D7</button>
        </div>
      </div>
      <div class="detail-hero">
        <span class="d-icon" style="background:${a.color}22">${a.icon}</span>
        <div class="d-name">${esc(a.name)}</div>
        <div class="asset-kind ${isC ? 'credit' : ''}" style="margin-top:4px">${isC ? '\u4FE1\u7528\u5361 \u00B7 \u8D1F\u503A' : '\u8D44\u4EA7\u8D26\u6237'}</div>
        <div class="d-balance" style="color:${balColor}">${fmt(a.balance)}</div>
      </div>
      <div class="detail-stats">
        <div class="stat">\u6536\u5165<b style="color:var(--income)">${fmt(income)}</b></div>
        <div class="stat">\u652F\u51FA<b style="color:var(--expense)">${fmt(expense)}</b></div>
      </div>
      <div class="detail-section-title">\u4EA4\u6613\u8BB0\u5F55\uFF08${txs.length}\uFF09</div>
      <div class="detail-tx-list">${txHTML}</div>
    `);
    $('#m-close').addEventListener('click', closeModal);
    $('#m-edit').addEventListener('click', () => { closeModal(); openAssetEditModal(a); });
  }

  function openAssetEditModal(a) {
    if (!a) return;
    const isC = (a.kind || 'asset') === 'credit';
    let icSel = a.icon || '💰';
    let kSel = isC ? 'credit' : 'asset';

    openModal(`
      <div class="modal-header"><div class="modal-title">编辑账户</div><button class="modal-close" id="m-close">×</button></div>
      <div style="text-align:center;margin:4px 0 12px"><span style="font-size:40px" id="ae-prev">${a.icon}</span></div>
      <div class="field"><span class="f-label">名称</span><input id="ae-name" value="${esc(a.name)}" placeholder="账户名称"/></div>
      <div class="field"><span class="f-label">性质</span>
        <div class="seg" style="flex:1;justify-content:flex-end">
          <button class="seg-btn${kSel==='asset'?' active':''}" data-k="asset">资产账户</button>
          <button class="seg-btn${kSel==='credit'?' active':''}" data-k="credit">信用卡</button>
        </div></div>
      <div class="field"><span class="f-label">余额</span><input id="ae-bal" type="text" inputmode="decimal" value="${a.balance}" placeholder="可为负"/></div>
      <div class="icon-pick-title">选择图标</div>
      <div class="cat-grid" id="ae-icon-grid">${ASSET_ICONS.map(ic => `<div class="cat-item" data-ic="${ic}"><div class="cat-icon">${ic}</div></div>`).join('')}</div>
      <button class="btn-primary" id="ae-save">保存</button>
      <button class="btn-danger" id="ae-del">删除账户</button>
    `);
    $('#m-close').addEventListener('click', closeModal);
    const grid = $('#ae-icon-grid');
    grid.querySelectorAll('.cat-item').forEach(el => {
      if (el.dataset.ic === icSel) el.classList.add('selected');
      el.addEventListener('click', () => {
        icSel = el.dataset.ic; $('#ae-prev').textContent = icSel;
        grid.querySelectorAll('.cat-item').forEach(x => x.classList.toggle('selected', x === el));
      });
    });
    $$('#modal-root .seg-btn').forEach(b => b.addEventListener('click', () => {
      kSel = b.dataset.k;
      $$('#modal-root .seg-btn').forEach(x => x.classList.toggle('active', x === b));
    }));
    $('#ae-save').addEventListener('click', async () => {
      const name = $('#ae-name').value.trim();
      if (!name) { toast('请输入名称'); return; }
      const bal = parseFloat($('#ae-bal').value);
      if (isNaN(bal)) { toast('余额需为数字'); return; }
      await Store.saveAsset({ id: a.id, name, icon: icSel, color: a.color || '#4C8DFF', kind: kSel, balance: bal });
      closeModal(); await loadAssets(); refreshAll(); toast('已保存');
    });
    $('#ae-del').addEventListener('click', async () => {
      if (!confirm(`删除账户「${a.name}」？\n该账户下的历史记录会保留（显示为「未分类账户」），不会丢失金额。`)) return;
      await Store.deleteAsset(a.id);
      closeModal(); await loadAssets(); refreshAll(); toast('已删除');
    });
  }

  // 新增账户（名称 / 图标 / 性质 / 初始余额，余额可为负）
  function openAssetAddModal() {
    let icSel = '💰';
    let kSel = 'asset';

    openModal(`
      <div class="modal-header"><div class="modal-title">新增账户</div><button class="modal-close" id="m-close">×</button></div>
      <div style="text-align:center;margin:4px 0 12px"><span style="font-size:40px" id="aa-prev">💰</span></div>
      <div class="field"><span class="f-label">名称</span><input id="aa-name" placeholder="如：招行信用卡 / 余额宝"/></div>
      <div class="field"><span class="f-label">性质</span>
        <div class="seg" style="flex:1;justify-content:flex-end">
          <button class="seg-btn${kSel==='asset'?' active':''}" data-k="asset">资产账户</button>
          <button class="seg-btn${kSel==='credit'?' active':''}" data-k="credit">信用卡</button>
        </div></div>
      <div class="field"><span class="f-label">初始余额</span><input id="aa-bal" type="text" inputmode="decimal" value="0" placeholder="可为负"/></div>
      <div class="icon-pick-title">选择图标</div>
      <div class="cat-grid" id="aa-icon-grid">${ASSET_ICONS.map(ic => `<div class="cat-item" data-ic="${ic}"><div class="cat-icon">${ic}</div></div>`).join('')}</div>
      <button class="btn-primary" id="aa-save">创建账户</button>
    `);
    $('#m-close').addEventListener('click', closeModal);
    const grid = $('#aa-icon-grid');
    grid.querySelectorAll('.cat-item').forEach(el => {
      if (el.dataset.ic === icSel) el.classList.add('selected');
      el.addEventListener('click', () => {
        icSel = el.dataset.ic; $('#aa-prev').textContent = icSel;
        grid.querySelectorAll('.cat-item').forEach(x => x.classList.toggle('selected', x === el));
      });
    });
    $$('#modal-root .seg-btn').forEach(b => b.addEventListener('click', () => {
      kSel = b.dataset.k;
      $$('#modal-root .seg-btn').forEach(x => x.classList.toggle('active', x === b));
    }));
    $('#aa-save').addEventListener('click', async () => {
      const name = $('#aa-name').value.trim();
      if (!name) { toast('请输入名称'); return; }
      const bal = parseFloat($('#aa-bal').value) || 0;
      const id = (window.crypto && crypto.randomUUID) ? crypto.randomUUID() : 'a' + Date.now();
      // 新账户放当前分组的最后
      const peers = (state.assets || []).filter(x => (x.kind || 'asset') === kSel);
      const maxSort = peers.reduce((m, x) => Math.max(m, Number(x.sort) || 0), 0);
      const sort = maxSort + 1;
      try {
        await Store.saveAsset({ id, name, icon: icSel, color: kSel === 'credit' ? '#FF6B5E' : '#4C8DFF', kind: kSel, balance: bal, sort });
        closeModal(); await loadAssets(); refreshAll(); toast('已创建');
      } catch (e) {
        console.error('saveAsset failed', e);
        toast('创建失败：' + (e.message || e.code || JSON.stringify(e)));
      }
    });
  }

  // 资产余额变动：统一「资金流入该账户→余额加、流出→减」。
  // 信用卡(kind='credit')余额代表「欠款(负债)」，方向相反：消费(支出)→欠款增→余额加；还款(收入)→欠款减→余额减。
  function assetDelta(kind, type, amount) {
    const k = (typeof kind === 'string' && kind) ? kind : 'asset';
    let sign = (type === 'expense') ? -1 : 1;   // 资产视角：支出减、收入加
    if (k === 'credit') sign = -sign;              // 信用卡(负债)反向
    return sign * Number(amount);
  }
  // 调整某账户余额：factor=+1 应用、factor=-1 回退（用于编辑/删除时重算）
  async function adjustAssetBalance(assetId, type, amount, factor) {
    if (!assetId) return;
    const a = (state.assets || []).find(x => x.id === assetId);
    if (!a) return;
    const d = assetDelta(a.kind, type, amount) * factor;
    const saved = await Store.saveAsset({ ...a, balance: Number(a.balance) + d });
    const i = state.assets.findIndex(x => x.id === assetId);
    if (i >= 0) state.assets[i] = saved || { ...a, balance: Number(a.balance) + d };
  }

  // ---------- 账户互转 ----------
  function openTransferModal() {
    const assets = state.assets || [];
    if (assets.length < 2) { toast('至少需要两个账户'); return; }
    let from = assets[0].id;
    let to = assets[1].id;
    function grid(side) {
      return assets.map(a => `<button type="button" class="acct-btn${a.id === (side === 'from' ? from : to) ? ' active' : ''}" data-a="${a.id}" data-side="${side}" style="flex:1;min-width:0;padding:11px 6px;border:1px solid ${a.id === (side === 'from' ? from : to) ? a.color : 'var(--line)'};border-radius:13px;background:${a.id === (side === 'from' ? from : to) ? a.color + '1A' : '#fff'};color:${a.id === (side === 'from' ? from : to) ? a.color : 'var(--text)'};font-weight:700;cursor:pointer;font-size:13px">${a.icon} ${esc(a.name)}</button>`).join('');
    }
    openModal(`
      <div class="modal-header"><div class="modal-title">账户转账</div><button class="modal-close" id="m-close">×</button></div>
      <div class="field" style="display:block"><span class="f-label" style="display:block;margin-bottom:8px">从（扣款）</span>
        <div id="tf-from" style="display:flex;gap:8px;flex-wrap:wrap">${grid('from')}</div></div>
      <div class="field" style="display:block"><span class="f-label" style="display:block;margin-bottom:8px">到（入账）</span>
        <div id="tf-to" style="display:flex;gap:8px;flex-wrap:wrap">${grid('to')}</div></div>
      <div class="amount-input"><span class="cur">¥</span><input id="tf-amt" type="text" inputmode="decimal" placeholder="0.00" /></div>
      <button class="btn-primary" id="save-tf">确认转账</button>
    `);
    $('#m-close').addEventListener('click', closeModal);
    function bindSide(side) {
      $$(`#tf-${side} .acct-btn`).forEach(b => b.addEventListener('click', () => {
        if (side === 'from') from = b.dataset.a; else to = b.dataset.a;
        $$(`#tf-${side} .acct-btn`).forEach(x => {
          const on = x === b;
          const ca = assets.find(z => z.id === x.dataset.a);
          x.style.borderColor = on ? (ca ? ca.color : 'var(--primary)') : 'var(--line)';
          x.style.background = on ? ((ca ? ca.color : 'var(--primary)') + '1A') : '#fff';
          x.style.color = on ? (ca ? ca.color : 'var(--primary)') : 'var(--text)';
          x.classList.toggle('active', on);
        });
        if (from === to) toast('转出与转入不能是同一账户');
      }));
    }
    bindSide('from'); bindSide('to');
    $('#save-tf').addEventListener('click', async () => {
      const amt = parseFloat($('#tf-amt').value);
      if (!amt || amt <= 0) { toast('请输入金额'); return; }
      if (from === to) { toast('转出与转入不能是同一账户'); return; }
      const a = assets.find(x => x.id === from);
      const b = assets.find(x => x.id === to);
      if (!a || !b) return;
      // 信用卡(负债)允许透支，不拦截；普通资产才校验余额不足
      if (a.kind !== 'credit' && Number(a.balance) < amt) { toast('转出账户余额不足'); return; }
      const dFrom = assetDelta(a.kind, 'expense', amt);   // 转出 = 资金流出
      const dTo   = assetDelta(b.kind, 'income', amt);     // 转入 = 资金流入
      const na = await Store.saveAsset({ ...a, balance: Number(a.balance) + dFrom });
      const nb = await Store.saveAsset({ ...b, balance: Number(b.balance) + dTo });
      const ia = state.assets.findIndex(x => x.id === from);
      const ib = state.assets.findIndex(x => x.id === to);
      if (ia >= 0) state.assets[ia] = na || { ...a, balance: Number(a.balance) + dFrom };
      if (ib >= 0) state.assets[ib] = nb || { ...b, balance: Number(b.balance) + dTo };
      // 生成一条转账流水记录：便于交易列表查看、统计对账，以及导出/导入时完整包含转账
      await Store.saveTransaction({
        ledger_id: state.ledgerId,
        type: 'transfer',
        amount: amt,
        occurred_at: todayStr(),
        from_asset_id: from,
        to_asset_id: to,
        from_kind: a.kind,
        to_kind: b.kind,
        note: '',
        category_id: null,
        asset_id: null
      });
      await loadTxs();
      closeModal(); refreshAll(); toast('转账成功');
    });
  }

  // ---------- 周期记账 ----------
  function fmtDate(d) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }
  function stepDate(d, freq) {
    const n = new Date(d);
    if (freq === 'daily') n.setDate(n.getDate() + 1);
    else if (freq === 'weekly') n.setDate(n.getDate() + 7);
    else if (freq === 'monthly') n.setMonth(n.getMonth() + 1);
    else if (freq === 'yearly') n.setFullYear(n.getFullYear() + 1);
    return n;
  }
  // 枚举从 anchor_date 到 today 之间的所有发生日
  function occurrencesUpTo(rule, today) {
    const out = [];
    let cur = new Date(rule.anchor_date + 'T00:00:00');
    const end = new Date(today + 'T00:00:00');
    let g = 0;
    while (cur <= end && g < 6000) { out.push(fmtDate(cur)); cur = stepDate(cur, rule.freq); g++; }
    return out;
  }
  function freqLabel(r) {
    const d = new Date(r.anchor_date + 'T00:00:00');
    const w = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][d.getDay()];
    if (r.freq === 'daily') return '每天';
    if (r.freq === 'weekly') return '每周' + w;
    if (r.freq === 'monthly') return '每月 ' + d.getDate() + ' 日';
    if (r.freq === 'yearly') return '每年 ' + (d.getMonth() + 1) + '月' + d.getDate() + '日';
    return r.freq;
  }
  // 启动生成到期未记的周期账（避免重复：用 lastGen 记录已生成到的日期）
  async function generateDueRecurring() {
    const rules = await Store.getRecurring();
    if (!rules.length) return;
    const today = todayStr();
    let count = 0;
    for (const r of rules) {
      if (!r.enabled) continue;
      const occ = occurrencesUpTo(r, today);
      const due = occ.filter(d => d >= r.start_date && (!r.end_date || d <= r.end_date) && (!r.lastGen || d > r.lastGen));
      for (const d of due) {
        const note = (r.note ? r.note + ' · ' : '') + '周期';
        await Store.saveTransaction({ ledger_id: state.ledgerId, category_id: r.category_id, asset_id: r.asset_id, type: r.type, amount: r.amount, note, occurred_at: d });
        if (r.asset_id) await adjustAssetBalance(r.asset_id, r.type, r.amount, +1);
        count++;
      }
      if (due.length) { r.lastGen = today; await Store.saveRecurring(r); }
    }
    if (count) { await loadAssets(); await loadTxs(); toast('已自动生成 ' + count + ' 笔周期记账'); }
  }

  async function openRecurringModal() {
    const rules = await Store.getRecurring();
    const cm = catMap();
    const am = assetMap();
    function ruleRow(r) {
      const c = r.category_id ? cm[r.category_id] : null;
      const a = r.asset_id ? am[r.asset_id] : null;
      const catLabel = c ? (c.parent ? cm[c.parent].name + '/' + c.name : c.name) : '未分类';
      const sign = r.type === 'expense' ? '-' : '+';
      return `
        <div class="rc-item">
          <div class="rc-main">
            <div class="rc-title">${sign}${fmt(r.amount)} · ${esc(catLabel)}</div>
            <div class="rc-sub">${freqLabel(r)} · ${a ? a.icon + ' ' + esc(a.name) : '无账户'}${r.enabled ? '' : ' · 已暂停'}</div>
          </div>
          <button class="rc-toggle${r.enabled ? ' on' : ''}" data-toggle-r="${r.id}">${r.enabled ? '启用' : '暂停'}</button>
          <button class="lr-edit" data-edit-r="${r.id}">编辑</button>
          <button class="lr-del" data-del-r="${r.id}">删除</button>
        </div>`;
    }
    openModal(`
      <div class="modal-header"><div class="modal-title">周期记账</div><button class="modal-close" id="m-close">×</button></div>
      <p style="font-size:13px;color:var(--text-sub);margin:0 0 12px">设置后，每次打开 App 会自动生成「到期未记」的周期账（如每月房租、每周订阅），已生成的不会重复。</p>
      ${rules.length ? rules.map(ruleRow).join('') : '<div class="empty">还没有周期记账规则</div>'}
      <button class="btn-primary" id="add-recurring">＋ 新增周期记账</button>
    `);
    $('#m-close').addEventListener('click', closeModal);
    $$('[data-edit-r]').forEach(b => b.addEventListener('click', () => {
      const r = rules.find(x => x.id === b.dataset.editR);
      if (r) openRecurringEditModal(r);
    }));
    $$('[data-del-r]').forEach(b => b.addEventListener('click', async () => {
      const r = rules.find(x => x.id === b.dataset.delR);
      if (!r) return;
      if (!confirm('删除周期规则「' + freqLabel(r) + '」？\n已生成的记录不会删除。')) return;
      await Store.deleteRecurring(r.id); openRecurringModal();
    }));
    $$('[data-toggle-r]').forEach(b => b.addEventListener('click', async () => {
      const r = rules.find(x => x.id === b.dataset.toggleR);
      if (!r) return;
      r.enabled = !r.enabled; await Store.saveRecurring(r); openRecurringModal();
    }));
    $('#add-recurring').addEventListener('click', () => openRecurringEditModal(null));
  }

  function openRecurringEditModal(rule) {
    const cats = state.categories;
    const assets = state.assets || [];
    let type = rule ? rule.type : 'expense';
    let selCat = rule ? rule.category_id : null;
    let selAsset = rule ? rule.asset_id : (assets[0] ? assets[0].id : null);
    let freq = rule ? rule.freq : 'monthly';
    const anchor = rule ? rule.anchor_date : todayStr();
    const endDate = rule ? (rule.end_date || '') : '';
    const amount = rule ? rule.amount : '';
    const note = rule ? (rule.note || '') : '';
    const isEdit = !!rule;

    // 与普通记账(openAddModal)一致：大类分组 + 其他组(孤儿小类/扁平顶级)，确保全部类目可选
    const rcCatOptions = (tp) => {
      const bigs = cats.filter(c => c.type === tp && !c.parent);
      const smallOf = pid => cats.filter(c => c.type === tp && c.parent === pid);
      let html = '';
      bigs.forEach(big => {
        const smalls = smallOf(big.id);
        if (!smalls.length) return;
        html += `<optgroup label="${esc(big.name)}">` + smalls.map(c => `<option value="${c.id}" ${c.id === selCat ? 'selected' : ''}>${esc(c.name)}</option>`).join('') + `</optgroup>`;
      });
      const orphan = cats.filter(c => c.type === tp && c.parent && !bigs.some(b => b.id === c.parent));
      const flat = cats.filter(c => c.type === tp && !c.parent && smallOf(c.id).length === 0);
      const extra = orphan.concat(flat);
      if (extra.length) html += `<optgroup label="其他">` + extra.map(c => `<option value="${c.id}" ${c.id === selCat ? 'selected' : ''}>${esc(c.name)}</option>`).join('') + `</optgroup>`;
      return html || '<option value="">（无分类）</option>';
    };
    const catOptions = rcCatOptions(type);
    const assetOptions = assets.map(a => `<option value="${a.id}" ${a.id === selAsset ? 'selected' : ''}>${a.icon} ${esc(a.name)}</option>`).join('');
    const freqOptions = [['daily', '每天'], ['weekly', '每周'], ['monthly', '每月'], ['yearly', '每年']]
      .map(([v, l]) => `<option value="${v}" ${v === freq ? 'selected' : ''}>${l}</option>`).join('');

    openModal(`
      <div class="modal-header"><div class="modal-title">${isEdit ? '编辑周期记账' : '新增周期记账'}</div><button class="modal-close" id="m-close">×</button></div>
      <div class="type-toggle">
        <button class="type-btn expense${type === 'expense' ? ' active expense' : ''}" data-t="expense">支出</button>
        <button class="type-btn income${type === 'income' ? ' active income' : ''}" data-t="income">收入</button>
      </div>
      <div class="field"><span class="f-label">金额</span><input id="rc-amt" type="text" inputmode="decimal" value="${amount}" placeholder="0.00" /></div>
      <div class="field"><span class="f-label">分类</span><select id="rc-cat">${catOptions || '<option value="">（无分类）</option>'}</select></div>
      <div class="field"><span class="f-label">账户</span><select id="rc-asset">${assetOptions}</select></div>
      <div class="field"><span class="f-label">周期</span><select id="rc-freq">${freqOptions}</select></div>
      <div class="field"><span class="f-label">起始日</span><input id="rc-anchor" type="date" value="${anchor}" /></div>
      <div class="field"><span class="f-label">结束日</span><input id="rc-end" type="date" value="${endDate}" placeholder="留空=永不结束" /></div>
      <div class="field"><span class="f-label">备注</span><input id="rc-note" type="text" value="${esc(note)}" placeholder="选填，如：房租" /></div>
      <button class="btn-primary" id="rc-save">${isEdit ? '保存修改' : '添加规则'}</button>
      <button class="btn-ghost" id="rc-back">返回</button>
    `);
    $('#m-close').addEventListener('click', closeModal);
    $$('#modal-root .type-btn').forEach(b => b.addEventListener('click', () => {
      type = b.dataset.t;
      $$('#modal-root .type-btn').forEach(x => x.classList.remove('active', 'expense', 'income'));
      b.classList.add('active', type);
      $('#rc-cat').innerHTML = rcCatOptions(type);
    }));
    $('#rc-back').addEventListener('click', () => openRecurringModal());
    $('#rc-save').addEventListener('click', async () => {
      const amt = parseFloat($('#rc-amt').value);
      if (!amt || amt <= 0) { toast('请输入金额'); return; }
      const category_id = $('#rc-cat').value || null;
      if (!category_id) { toast('请选择分类'); return; }
      const obj = {
        type, amount: amt, category_id,
        asset_id: $('#rc-asset').value || null,
        freq: $('#rc-freq').value,
        anchor_date: $('#rc-anchor').value || todayStr(),
        start_date: $('#rc-anchor').value || todayStr(),
        end_date: $('#rc-end').value || null,
        note: $('#rc-note').value.trim(),
        enabled: true
      };
      if (isEdit) { obj.id = rule.id; obj.lastGen = rule.lastGen || null; obj.created_at = rule.created_at; }
      await Store.saveRecurring(obj);
      closeModal();
      if (isEdit) openRecurringModal();
      else { await generateDueRecurring(); openRecurringModal(); }
      toast(isEdit ? '已保存' : '规则已添加');
    });
  }

  // ---------- 视图切换 ----------
  function switchView(v) {
    state.view = v;
    $$('.nav-item').forEach(b => b.classList.toggle('active', b.dataset.view === v));
    $$('.view').forEach(s => s.classList.remove('active'));
    $('#view-' + v).classList.add('active');
    renderCurrent();
  }
  async function renderCurrent() {
    if (state.view === 'record') await renderRecord();
    else if (state.view === 'detail') await renderDetail();
    else if (state.view === 'assets') await renderAssets();
    else if (state.view === 'stats') await renderStats();
    else if (state.view === 'mine') await renderMine();
  }
  async function refreshAll() {
    await renderHeader();
    await renderCurrent();
  }

  // ---------- 事件绑定 ----------
  function bindGlobal() {
    $$('.nav-item').forEach(b => b.addEventListener('click', () => switchView(b.dataset.view)));
    $('#btn-settings').addEventListener('click', () => openBackupModal());
    $('#month-prev').addEventListener('click', () => changeMonth(-1));
    $('#month-next').addEventListener('click', () => changeMonth(1));
  }
  function changeMonth(delta) {
    const [y, m] = state.month.split('-').map(Number);
    const d = new Date(y, m - 1 + delta, 1);
    state.month = monthKeyOf(d);
    localStorage.setItem('yy_current_month', state.month);
    loadTxs().then(refreshAll);
  }
  // 统计·本年模式：按年前后切换（保留月份，仅改年份）
  function changeYear(delta) {
    const [y, m] = state.month.split('-').map(Number);
    const ny = y + delta;
    state.month = `${ny}-${String(m).padStart(2, '0')}`;
    localStorage.setItem('yy_current_month', state.month);
    loadTxs().then(refreshAll);
  }

  // ---------- 启动 ----------
  async function boot() {
    bindGlobal();
    await Store.init();
    await afterAuthReady();
  }
  async function afterAuthReady() {
    await reloadCaches();
    await loadTxs();
    await generateDueRecurring();   // 启动生成到期未记的周期账（会重载 txs/assets）
    await renderHeader();
    await renderCurrent();
    wireCloudSync();
  }
  // 云端同步接线（军机处模型）：本地编辑即推送；切回前台/定时拉取（有改动则只推不拉）；离开页面兜底 flush
  function wireCloudSync() {
    Store.onCloudChange(handleCloudChange);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') Store.pull();
      else Store.flush();
    });
    window.addEventListener('beforeunload', () => Store.flush());
    setInterval(() => { if (document.visibilityState === 'visible') Store.pull(); }, 30000);
  }
  function handleCloudChange(reload) {
    if (reload) reloadCaches().then(loadTxs).then(refreshAll).then(updateSyncStatus);
    else updateSyncStatus();
  }
  function syncStatusText(s) {
    if (!s.on) return '当前：本地模式（未连接云端）';
    if (s.dirty) return '本地有未同步改动，将在下次操作时推送';
    if (s.lastSync) {
      const d = new Date(s.lastSync);
      const txt = isNaN(d) ? s.lastSync : d.toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
      return '已同步 · 最近 ' + txt;
    }
    return '已连接云端';
  }
  function updateSyncStatus() {
    if (state.view === 'mine') renderMine();
    const st = $('#sync-status-text');
    if (st) st.textContent = syncStatusText(Store.getSyncStatus());
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
