// 数据层：本地优先（localStorage 为主存储，断网照常使用）
// 联网同步 = 军机处模型：云端整份数据为「ledgers 表里一个保留行」的 JSON 大字段（last-write-wins）+ 脏标记 + 防抖 push-on-edit + 拉取守卫
// 复用现有 lifeisprg 项目的 ledgers 表，不新建表、不改表结构（避免 schema 不匹配丢字段）。
// 同步规则：本机编辑即推送云端；其它设备仅在本机「无未同步改动」时拉取云端（有改动则只推不拉，绝不反向覆盖）。
const Store = (() => {
  let sb = null;
  let cloudOn = false;
  let cfg = { url: '', key: '' };
  let onCloudChangeCb = null;

  const LS = {
    ledgers: 'yy_ledgers',
    categories: 'yy_categories',
    transactions: 'yy_transactions',
    budgets: 'yy_budgets',
    assets: 'yy_assets',
    recurring: 'yy_recurring',
    config: 'yy_supabase_config',
    curLedger: 'yy_current_ledger',
    curMonth: 'yy_current_month',
    syncOn: 'yy_sync_on',
    dirty: 'yy_dirty',
    lastSync: 'yy_last_sync',
    deleted: 'yy_deleted'
  };

  // 免登录：ledgers 表里的一个「保留行」充当同步载体，个人多端（Mac/iPhone）共享同一份数据
  // 用固定 UUID，写入 JSON 大字段，getLedgers() 会过滤掉它，永不显示为账本。
  const SYNC_ROW_ID = '00000000-0000-0000-0000-000000000001';
  const SYNC_TABLE = 'ledgers';
  const PROJECT = 'lifeisprg';
  // 默认账本用固定 id：各设备首次生成的"默认账本"必须是同一个 id，
  // 否则不同设备各建一个同名账本，交易按 ledger_id 过滤时会互相"看不见"。
  const DEFAULT_LEDGER_ID = 'ledger-default';

  function loadConfig() {
    let c = null;
    try { c = JSON.parse(localStorage.getItem(LS.config)); } catch (e) { }
    if (!c || !c.url || !c.key) {
      c = {
        url: (window.APP_CONFIG && window.APP_CONFIG.SUPABASE_URL) || '',
        key: (window.APP_CONFIG && window.APP_CONFIG.SUPABASE_ANON_KEY) || ''
      };
    }
    cfg = c;
  }

  function isLive() { return cloudOn; }
  function getMode() { return cloudOn ? 'synced' : 'local'; }
  function getConfig() { return cfg; }
  function getDocId() { return PROJECT; }

  async function applyConfig(url, key) {
    cfg = { url: url || '', key: key || '' };
    if (cfg.url && cfg.key) localStorage.setItem(LS.config, JSON.stringify(cfg));
    else localStorage.removeItem(LS.config);
    return await init();
  }

  function uid() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    return 'id-' + Date.now() + '-' + Math.random().toString(16).slice(2);
  }

  // ---------- 本地读写 ----------
  function readArr(key) { try { return JSON.parse(localStorage.getItem(key)) || []; } catch (e) { return []; } }
  function writeArr(key, arr) { localStorage.setItem(key, JSON.stringify(arr)); }
  function todayStr() {
    const d = new Date();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${d.getFullYear()}-${m}-${day}`;
  }
  function monthFirstLast(month) {
    const [y, m] = month.split('-').map(Number);
    const first = `${month}-01`;
    const last = new Date(y, m, 0); // 当月最后一天
    const ld = String(last.getDate()).padStart(2, '0');
    return { first, last: `${y}-${String(m).padStart(2, '0')}-${ld}` };
  }

  // ---------- 同步核心（军机处模型）----------
  function isDirty() { return localStorage.getItem(LS.dirty) === '1'; }
  function markDirty() {
    localStorage.setItem(LS.dirty, '1');
    schedulePush();
  }
  // ---------- 删除墓碑（tombstone）----------
  // 整份覆盖式同步（last-write-wins）的致命缺陷：只要有一台设备把自己那份「还带着
  // 已删除记录」的完整数据推上云，别处刚删掉的记录就会复活。故把「删除」本身也做成
  // 可同步的数据：{ id: 删除时间 }。规则——删过的 id 一律不再出现，任何设备都必须
  // 服从，从而实现「本地删除优先级高于云端」。
  function readDeleted() {
    try { const o = JSON.parse(localStorage.getItem(LS.deleted)); return (o && typeof o === 'object') ? o : {}; }
    catch (e) { return {}; }
  }
  function writeDeleted(o) { localStorage.setItem(LS.deleted, JSON.stringify(o || {})); }
  function addTombstone(id) {
    if (!id) return;
    const d = readDeleted();
    d[id] = new Date().toISOString();
    const keys = Object.keys(d);
    if (keys.length > 800) {           // 控制体积：只保留最近的 800 条
      keys.sort((a, b) => String(d[a]).localeCompare(String(d[b])));
      keys.slice(0, keys.length - 800).forEach(k => delete d[k]);
    }
    writeDeleted(d);
  }
  function mergeTombstones(a, b) {
    const out = { ...(a || {}) };
    for (const k in (b || {})) {
      if (!out[k] || String(b[k]) > String(out[k])) out[k] = b[k];  // 取更新的删除时间（新者为准）
    }
    return out;
  }
  function tsOf(r) {
    const t = Date.parse((r && r.updated_at) || '');
    return isNaN(t) ? 0 : t;
  }
  // 数据指纹：用于判断一次同步后本地内容是否真的变了（避免无谓整页重渲染）
  function blobSig(blob) {
    const parts = [];
    ['ledgers', 'categories', 'transactions', 'budgets', 'assets', 'recurring'].forEach(k => {
      const arr = (blob && blob[k]) || [];
      parts.push(k + '#' + arr.length + '#' + arr.map(r => ((r && r.id) || '') + '@' + ((r && r.updated_at) || '')).join(','));
    });
    parts.push('d#' + Object.keys((blob && blob.deleted) || {}).length);
    return parts.join('|');
  }
  // 逐条合并（本地 ⇄ 云端）：同 id 取 updated_at 较新的一条；
  // 删除按墓碑时间判定——记录若在该时间之后又被改动过，则以改动为准（复活）。
  // 返回 { blob, localNewer }：localNewer=true 表示本端有云端还没有的更新/删除，需要回传。
  function mergeStates(local, cloud) {
    const tombstones = mergeTombstones(local.deleted, cloud.deleted);
    let localNewer = false;
    const out = {};
    ['ledgers', 'categories', 'transactions', 'budgets', 'assets', 'recurring'].forEach(k => {
      const L = Array.isArray(local[k]) ? local[k] : [];
      const C = Array.isArray(cloud[k]) ? cloud[k] : [];
      const map = new Map();
      C.forEach(r => { if (r && r.id) map.set(r.id, r); });
      L.forEach(r => {
        if (!r || !r.id) return;
        const cur = map.get(r.id);
        if (!cur) { map.set(r.id, r); localNewer = true; }
        else if (tsOf(r) > tsOf(cur)) { map.set(r.id, r); localNewer = true; }
      });
      const arr = [];
      map.forEach(r => {
        const t = tombstones[r.id];
        if (t) {
          const tt = Date.parse(t);
          if (!(tsOf(r) > (isNaN(tt) ? 0 : tt))) return;   // 已删除且之后没再改过 → 排除
        }
        arr.push(r);
      });
      out[k] = arr;
    });
    const cd = cloud.deleted || {};
    for (const id in (local.deleted || {})) { if (!cd[id]) { localNewer = true; break; } }
    out.deleted = tombstones;
    return { blob: out, localNewer };
  }
  // 把「已删除」的记录从本地各表中真正清掉
  function purgeDeleted(idsMap) {
    const ids = new Set(Object.keys(idsMap || {}));
    if (!ids.size) return false;
    let changed = false;
    [LS.transactions, LS.budgets, LS.ledgers, LS.categories, LS.assets, LS.recurring].forEach(k => {
      const arr = readArr(k);
      const n = arr.filter(x => !x || !ids.has(x.id));
      if (n.length !== arr.length) { writeArr(k, n); changed = true; }
    });
    return changed;
  }
  let pushTimer = null;
  function schedulePush() {
    if (pushTimer) clearTimeout(pushTimer);
    pushTimer = setTimeout(() => { pushTimer = null; pushState(); }, 250); // 防抖 ~250ms
  }
  function buildBlob() {
    return {
      ledgers: readArr(LS.ledgers),
      categories: readArr(LS.categories),
      transactions: readArr(LS.transactions),
      budgets: readArr(LS.budgets),
      assets: readArr(LS.assets),
      recurring: readArr(LS.recurring),
      deleted: readDeleted()          // 删除墓碑：随数据一起同步，防止被其它设备"复活"
    };
  }
  function applyBlob(blob) {
    if (!blob) return;
    if (Array.isArray(blob.ledgers)) writeArr(LS.ledgers, blob.ledgers);
    if (Array.isArray(blob.categories)) writeArr(LS.categories, blob.categories);
    if (Array.isArray(blob.transactions)) writeArr(LS.transactions, blob.transactions);
    if (Array.isArray(blob.budgets)) writeArr(LS.budgets, blob.budgets);
    if (Array.isArray(blob.assets)) writeArr(LS.assets, blob.assets);
    if (Array.isArray(blob.recurring)) writeArr(LS.recurring, blob.recurring);
  }
  // 归一化：合并「同名且无交易的重复账本」。
  // 多端各自 seed 过默认账本时会累积出多个同名账本；保留有交易的那个，
  // 把空壳账本（及其引用）改指到保留账本，避免明细按不同 ledger_id 过滤而"看不到"。
  function normalizeBlob(blob) {
    if (!blob || !Array.isArray(blob.ledgers) || blob.ledgers.length <= 1) return blob;
    const txs = blob.transactions || [];
    const hasTx = id => txs.some(t => t && t.ledger_id === id);
    const keyOf = l => (l && l.name || '') + '|' + (l && l.icon || '');
    const keep = {}; const remap = {}; const out = [];
    // 第一轮：有交易的账本优先占位
    for (const l of blob.ledgers) {
      if (!l || !hasTx(l.id)) continue;
      const k = keyOf(l);
      if (!keep[k]) { keep[k] = l.id; out.push(l); } else remap[l.id] = keep[k];
    }
    // 第二轮：无交易的账本 → 同名并入保留账本，否则保留
    for (const l of blob.ledgers) {
      if (!l || hasTx(l.id)) continue;
      const k = keyOf(l);
      if (keep[k]) { remap[l.id] = keep[k]; continue; }
      keep[k] = l.id; out.push(l);
    }
    if (!Object.keys(remap).length && out.length >= blob.ledgers.length) return blob;
    const fix = arr => (arr || []).map(x => (x && remap[x.ledger_id]) ? { ...x, ledger_id: remap[x.ledger_id] } : x);
    let nb = { ...blob, ledgers: out, transactions: fix(blob.transactions), budgets: fix(blob.budgets), recurring: fix(blob.recurring) };
    // 只剩一个账本时，把所有「孤儿引用」（指向已不存在的账本的记录，例如某设备本地还留着
    // 自己临时生成的 ledger_id）一并归到唯一账本名下，否则这些明细会永远看不见。
    if (out.length === 1) {
      const only = out[0].id;
      const fixAll = arr => (arr || []).map(x => (x && x.ledger_id !== only) ? { ...x, ledger_id: only } : x);
      nb = { ...nb, transactions: fixAll(nb.transactions), budgets: fixAll(nb.budgets), recurring: fixAll(nb.recurring) };
    }
    return nb;
  }
  // 推送：先读云端 → 逐条合并（较新者为准）→ 写回云端，并把合并结果落到本地。
  // 这样任何设备都不会用旧数据盖掉别处的新数据（编辑和删除都适用）。
  // 注意：该库 PostgREST 对 .upsert() 的合并在「行已存在」时会 409，故改用
  // 「先 insert，若 409 重复键则降级为 update(PATCH)」的稳妥写法。
  async function readCloud() {
    try {
      const { data, error } = await sb.from(SYNC_TABLE).select('name').eq('id', SYNC_ROW_ID).maybeSingle();
      if (error || !data || !data.name) return null;
      const b = JSON.parse(data.name);
      return (b && Array.isArray(b.ledgers) && Array.isArray(b.transactions)) ? b : null;
    } catch (e) { return null; }
  }
  async function writeCloud(blob) {
    const payload = { id: SYNC_ROW_ID, name: JSON.stringify(blob), icon: '', color: '' };
    let res = await sb.from(SYNC_TABLE).insert(payload);
    if (res.error && /23505|duplicate/i.test(res.error.code || res.error.message || '')) {
      res = await sb.from(SYNC_TABLE).update({ name: payload.name, icon: '', color: '' }).eq('id', SYNC_ROW_ID);
    }
    return !res.error;
  }
  async function pushState() {
    if (!cloudOn || !sb) return;
    try {
      const local = buildBlob();
      const cloud = await readCloud();
      const merged = normalizeBlob(cloud ? mergeStates(local, cloud).blob : local);
      if (!(await writeCloud(merged))) return;
      writeDeleted(merged.deleted || {});
      applyBlob(merged);                                  // 合并结果落到本地（顺带带回别处的新记录）
      localStorage.setItem(LS.dirty, '0');
      localStorage.setItem(LS.lastSync, new Date().toISOString());
      if (onCloudChangeCb) onCloudChangeCb(false); // 仅刷新状态指示，不整页重载（避免闪烁）
    } catch (e) { }
  }
  // 本地是否已有任何数据（用于首次启用同步时保护既有数据不被空云端覆盖）
  function localHasData() {
    return readArr(LS.ledgers).length > 0 || readArr(LS.categories).length > 0 ||
           readArr(LS.transactions).length > 0 || readArr(LS.budgets).length > 0 ||
           readArr(LS.assets).length > 0 || readArr(LS.recurring).length > 0;
  }
  // 拉取：读云端 → 与本地逐条合并（同 id 取 updated_at 较新者；删除按墓碑时间裁决）
  // → 结果落回本地；若本端还有云端没有的更新/删除，则立刻回传。
  // 这里不再需要"有改动就只推不拉"的守卫：合并本身保证了「较新者为准」。
  async function pull() {
    if (!cloudOn || !sb) return;
    try {
      const { data, error } = await sb.from(SYNC_TABLE).select('*').eq('id', SYNC_ROW_ID).maybeSingle();
      if (error) return;                 // 网络/权限错误：保留本地，绝不覆盖
      if (!data) {                       // 云端无保留行：首次启用，把本地推上去
        await pushState();
        return;
      }
      let cloud = null;
      try { cloud = JSON.parse(data.name); } catch (e) { cloud = null; }
      const valid = cloud && Array.isArray(cloud.ledgers) && Array.isArray(cloud.transactions);
      if (!valid) {                      // 云端空/损坏，且本地有数据 → 推本地，绝不反向清空本地
        if (localHasData()) await pushState();
        return;
      }
      const before = blobSig(buildBlob());
      const { blob, localNewer } = mergeStates(buildBlob(), cloud);
      const merged = normalizeBlob(blob);
      writeDeleted(merged.deleted || {});
      applyBlob(merged);
      purgeDeleted(merged.deleted || {});
      localStorage.setItem(LS.lastSync, data.updated_at || new Date().toISOString());
      if (!localNewer) localStorage.setItem(LS.dirty, '0');
      const changed = blobSig(merged) !== before;
      if (onCloudChangeCb) onCloudChangeCb(changed);   // 内容确有变化才整页重载（避免每 30s 白重渲染）
      if (localNewer) await pushState();               // 本端更新/删除尚未上云 → 回传
    } catch (e) { }
  }
  function flush() { if (cloudOn && isDirty()) pushState(); } // 离开页面兜底（best-effort）
  function onCloudChange(cb) { onCloudChangeCb = cb; }

  async function syncNow() {
    if (!cloudOn) return { ok: false, msg: '未启用云端同步' };
    if (isDirty()) { await pushState(); return { ok: true, msg: '已推送本地改动' }; }
    await pull();
    return { ok: true, msg: '已同步' };
  }
  function getSyncStatus() {
    return { on: cloudOn, dirty: isDirty(), lastSync: localStorage.getItem(LS.lastSync) };
  }

  // ---------- 启动 / 开关 ----------
  async function init() {
    loadConfig();
    const want = localStorage.getItem(LS.syncOn) === '1' && /^https?:\/\//.test(cfg.url || '') && cfg.key;
    if (want && window.supabase) {
      try {
        sb = window.supabase.createClient(cfg.url, cfg.key, { auth: { persistSession: false, autoRefreshToken: false } });
        cloudOn = true;
        await ensureSeed();   // 先保证本地有种子/既有数据
        await pull();         // 首次连接：空则推本地；有改动则守卫；否则采纳云端
      } catch (e) { sb = null; cloudOn = false; await ensureSeed(); }
    } else {
      sb = null; cloudOn = false;
      await ensureSeed();
    }
    return getMode();
  }
  function setSyncOn(on) {
    localStorage.setItem(LS.syncOn, on ? '1' : '0');
    return init();
  }

  // ---------- 种子数据 ----------
  function resolveSeedCats(raw) {
    const withId = raw.map(c => ({ ...c, id: uid() }));
    const pkMap = {};
    withId.forEach(c => { if (c.pk) pkMap[c.pk] = c.id; });
    return withId.map(c => {
      const { pk, parentKey, ...rest } = c;
      const parent = parentKey ? (pkMap[parentKey] || null) : null;
      return { ...rest, parent };
    });
  }
  async function ensureSeed() {
    const seed = (window.SEED) || { ledgers: [], categories: [], assets: [] };
    if (readArr(LS.categories).length === 0) writeArr(LS.categories, resolveSeedCats(seed.categories));
    if (readArr(LS.ledgers).length === 0) writeArr(LS.ledgers, seed.ledgers.map(l => ({ ...l, id: DEFAULT_LEDGER_ID })));
    if (readArr(LS.assets).length === 0) writeArr(LS.assets, seed.assets.map(a => ({ ...a, id: uid() })));
  }

  // ---------- 账本 ----------
  function getLedgers() { return readArr(LS.ledgers).filter(x => x.id !== SYNC_ROW_ID); }
  async function saveLedger(obj) {
    const o = { ...obj };
    o.updated_at = new Date().toISOString();   // 逐条时间戳：多端合并「较新者为准」的依据
    if (!o.id) o.id = uid();
    const arr = readArr(LS.ledgers);
    const i = arr.findIndex(x => x.id === o.id);
    if (i >= 0) arr[i] = o; else arr.push(o);
    writeArr(LS.ledgers, arr);
    markDirty();
    return o;
  }
  async function deleteLedger(id) {
    writeArr(LS.ledgers, readArr(LS.ledgers).filter(x => x.id !== id));
    addTombstone(id);
    markDirty();
  }

  // ---------- 分类 ----------
  function getCategories() { return readArr(LS.categories); }
  async function saveCategory(obj) {
    const o = { ...obj };
    o.updated_at = new Date().toISOString();   // 逐条时间戳：多端合并「较新者为准」的依据
    if (!o.id) o.id = uid();
    const arr = readArr(LS.categories);
    const i = arr.findIndex(x => x.id === o.id);
    if (i >= 0) arr[i] = o; else arr.push(o);
    writeArr(LS.categories, arr);
    markDirty();
    return o;
  }
  async function deleteCategory(id) {
    writeArr(LS.categories, readArr(LS.categories).filter(x => x.id !== id));
    addTombstone(id);
    markDirty();
  }

  // ---------- 交易 ----------
  function getTransactions({ ledgerId, month } = {}) {
    let arr = readArr(LS.transactions);
    if (ledgerId) arr = arr.filter(t => t.ledger_id === ledgerId);
    if (month) arr = arr.filter(t => (t.occurred_at || '').startsWith(month));
    arr.sort((a, b) => (b.occurred_at + b.created_at).localeCompare(a.occurred_at + a.created_at));
    return arr;
  }
  async function saveTransaction(obj) {
    const o = { ...obj };
    o.updated_at = new Date().toISOString();   // 逐条时间戳：多端合并「较新者为准」的依据
    if (!o.id) o.id = uid();
    if (!o.created_at) o.created_at = new Date().toISOString();
    const arr = readArr(LS.transactions);
    const i = arr.findIndex(x => x.id === o.id);
    if (i >= 0) arr[i] = o; else arr.push(o);
    writeArr(LS.transactions, arr);
    markDirty();
    return o;
  }
  async function deleteTransaction(id) {
    writeArr(LS.transactions, readArr(LS.transactions).filter(x => x.id !== id));
    addTombstone(id);
    markDirty();
  }
  function getTransaction(id) { return readArr(LS.transactions).find(x => x.id === id) || null; }

  // ---------- 周期记账（规则模板，启动时空生成到期账）----------
  function getRecurring() { return readArr(LS.recurring); }
  async function saveRecurring(obj) {
    const o = { ...obj };
    o.updated_at = new Date().toISOString();   // 逐条时间戳：多端合并「较新者为准」的依据
    if (!o.id) o.id = uid();
    if (!o.created_at) o.created_at = new Date().toISOString();
    const arr = readArr(LS.recurring);
    const i = arr.findIndex(x => x.id === o.id);
    if (i >= 0) arr[i] = o; else arr.push(o);
    writeArr(LS.recurring, arr);
    markDirty();
    return o;
  }
  async function deleteRecurring(id) {
    writeArr(LS.recurring, readArr(LS.recurring).filter(x => x.id !== id));
    addTombstone(id);
    markDirty();
  }

  // ---------- 预算 ----------
  function getBudgets({ ledgerId, month } = {}) {
    let arr = readArr(LS.budgets);
    if (ledgerId) arr = arr.filter(b => b.ledger_id === ledgerId);
    if (month) arr = arr.filter(b => b.month === month);
    return arr;
  }
  async function saveBudget(obj) {
    const o = { ...obj };
    o.updated_at = new Date().toISOString();   // 逐条时间戳：多端合并「较新者为准」的依据
    if (!o.id) o.id = uid();
    const arr = readArr(LS.budgets);
    const i = arr.findIndex(x => x.id === o.id);
    if (i >= 0) arr[i] = o; else arr.push(o);
    writeArr(LS.budgets, arr);
    markDirty();
    return o;
  }
  async function deleteBudget(id) {
    writeArr(LS.budgets, readArr(LS.budgets).filter(x => x.id !== id));
    addTombstone(id);
    markDirty();
  }

  // ---------- 资产 ----------
  function getAssets() {
    return readArr(LS.assets).sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0) || (a.id < b.id ? -1 : 1));
  }
  async function saveAsset(obj) {
    const o = { ...obj };
    o.updated_at = new Date().toISOString();   // 逐条时间戳：多端合并「较新者为准」的依据
    if (!o.id) o.id = uid();
    const arr = readArr(LS.assets);
    const i = arr.findIndex(x => x.id === o.id);
    if (i >= 0) arr[i] = o; else arr.push(o);
    writeArr(LS.assets, arr);
    markDirty();
    return o;
  }
  async function deleteAsset(id) {
    writeArr(LS.assets, readArr(LS.assets).filter(x => x.id !== id));
    addTombstone(id);
    markDirty();
  }

  return {
    init, isLive, getMode, getConfig, getDocId, applyConfig, setSyncOn,
    getSyncStatus, syncNow, onCloudChange, pull, flush, todayStr,
    getLedgers, saveLedger, deleteLedger,
    getCategories, saveCategory, deleteCategory,
    getTransactions, saveTransaction, deleteTransaction, getTransaction,
    getRecurring, saveRecurring, deleteRecurring,
    getBudgets, saveBudget, deleteBudget,
    getAssets, saveAsset, deleteAsset
  };
})();
