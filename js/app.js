/* 主控制器 */
(function (global) {
  'use strict';
  const U = global.LQUtils;
  const DB = global.LQDB;
  const $ = U.$, $$ = U.$$;

  const STATE = {
    current: null,          // 当前单据对象
    images: {},             // 当前编辑中的图片分组
    cats: [],               // 当前分类汇总 [{name,qty,amount}]
    allIds: [],
    activeGroup: 'detailImages',
    step: 0,
    dirty: false
  };
  const GROUP_KEYS = ['detailImages', 'applyImages', 'approveImages', 'repriceImages', 'saleImages', 'closeImages', 'auditImages'];

  // 简写别名（供 App 内部方法调用，避免遗漏 App. 前缀）
  function newOrder() { return App.newOrder(); }
  function loadOrder(id) { return App.loadOrder(id); }

  const App = {
    getImages(g) { return STATE.images[g] || (STATE.images[g] = []); },
    setImages(g, list) { STATE.images[g] = list; STATE.dirty = true; markDirty(); },
    activeImageGroup() { return STATE.activeGroup; },

    renderImages(g) {
      const row = $(`.thumb-row[data-row="${g}"]`);
      const list = App.getImages(g);
      const cnt = $(`.cnt[data-cnt="${g}"]`);
      if (cnt) cnt.textContent = list.length + ' 张';
      if (!row) return;
      row.innerHTML = list.map((im, i) =>
        `<div class="thumb"><img src="${im.data}" alt="${U.escapeHtml(im.name)}"><span class="del" data-i="${i}" title="删除">×</span><span class="idx">${i + 1}</span></div>`
      ).join('');
    },

    async init() {
      const all = await DB.all();
      STATE.allIds = all.map(o => o.id);
      bindUI();
      bindCats();
      global.LQImages.init();
      if (all.length) await loadOrder(all[0].id); else await newOrder();
      await refreshLedger();
      updateExportMeta();
    },

    blankOrder() {
      return {
        id: '', station: '', month: U.today().slice(0, 7), handler: '', status: '草稿',
        batchNo: '', checkDate: U.today(), batchTotal: '',
        categories: [],
        monthSales: '', hasExpired: '否', expiredAmount: '', nearExpireProducts: '',
        applyDate: U.today(), applyType: '降价促销', applyReason: '',
        oaNo: '', approver: '计划经营科', approveDate: '', approveResult: '待审批',
        discountRate: '', repriceDate: U.today(), grossDamage: '',
        soldQty: '', soldAmount: '', saleEndDate: '',
        closeDate: '', closeNote: '', auditIssueNo: '', auditResolved: '未解决', auditRisk: '', auditFixed: '',
        detailImages: [], applyImages: [], approveImages: [], repriceImages: [], saleImages: [], closeImages: [], auditImages: [],
        createdAt: new Date().toISOString(), updatedAt: new Date().toISOString()
      };
    },

    async newOrder() {
      STATE.current = App.blankOrder();
      STATE.current.id = U.makeId('', STATE.current.month, STATE.allIds);
      STATE.images = {};
      STATE.cats = [{ name: '', qty: '', amount: '' }];
      GROUP_KEYS.forEach(g => { STATE.images[g] = []; App.renderImages(g); });
      renderCats();
      fillForm(STATE.current);
      $('#orderId').value = STATE.current.id;
      setStep(0);
      setSaveState('新单据（未保存）', false);
      updateExportMeta();
    },

    async loadOrder(id) {
      const o = await DB.get(id);
      if (!o) { U.toast('单据不存在', true); return; }
      STATE.current = o;
      STATE.images = {};
      GROUP_KEYS.forEach(g => {
        STATE.images[g] = Array.isArray(o[g]) ? o[g].map(x => Object.assign({}, x)) : [];
        App.renderImages(g);
      });
      STATE.cats = Array.isArray(o.categories) && o.categories.length
        ? o.categories.map(x => Object.assign({}, x)) : [{ name: '', qty: '', amount: '' }];
      renderCats();
      fillForm(o);
      $('#orderId').value = o.id;
      setStep(0);
      setSaveState('已加载', true);
      switchTab('form');
      updateExportMeta();
    },

    collect() {
      const form = $('#orderForm');
      const o = STATE.current || App.blankOrder();
      $$('[name]', form).forEach(el => {
        if (!el.name) return;
        o[el.name] = el.value;
      });
      o.categories = STATE.cats.map(c => ({ name: String(c.name || ''), qty: String(c.qty || ''), amount: String(c.amount || '') }));
      const sub = U.calcCategories(o.categories);
      o.categoryCount = sub.rows;
      o.batchTotal = o.batchTotal || String(sub.qty);
      o.nearExpireAmount = String(sub.amount);
      o.id = $('#orderId').value.trim() || o.id;
      // 若保存前才填了油站，自动把单号里的"未填"换成站名
      if (o.station && o.id.includes('未填') && !STATE.allIds.includes(U.makeId(o.station, o.month, STATE.allIds.filter(x => x !== STATE.current.id)))) {
        o.id = U.makeId(o.station, o.month, STATE.allIds.filter(x => x !== STATE.current.id));
        $('#orderId').value = o.id;
      }
      GROUP_KEYS.forEach(g => { o[g] = App.getImages(g); });
      o.updatedAt = new Date().toISOString();
      return o;
    },

    async save(silent) {
      const o = App.collect();
      if (!o.id) { U.toast('请填写单号', true); return; }
      if (!o.station) { U.toast('请填写油站', true); return; }
      if (!o.month) { U.toast('请选择统计月份', true); return; }
      if (!o.categories.some(c => String(c.name || '').trim())) { U.toast('请至少填写一个品类', true); return; }
      const isNew = !STATE.allIds.includes(o.id);
      await DB.put(o);
      if (isNew) STATE.allIds.push(o.id);
      STATE.current = o;
      STATE.dirty = false;
      setSaveState('已保存 ' + new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }), true);
      await refreshLedger();
      updateExportMeta();
      if (!silent) U.toast('单据已保存');
    },

    async removeOrder(id) {
      if (!confirm(`确定删除单据 ${id}？此操作不可撤销。`)) return;
      await DB.remove(id);
      STATE.allIds = STATE.allIds.filter(x => x !== id);
      if (STATE.current && STATE.current.id === id) {
        const all = await DB.all();
        if (all.length) await loadOrder(all[0].id); else await newOrder();
      }
      await refreshLedger();
      updateExportMeta();
      U.toast('已删除');
    },

    async closeOrder() {
      const o = App.collect();
      const checks = runChecks(o);
      const bad = checks.filter(c => !c.ok);
      if (bad.length) {
        U.toast('销单前请先处理：' + bad[0].text, true);
        return;
      }
      o.status = '已销单';
      if (!o.closeDate) o.closeDate = U.today();
      STATE.current = o;
      $('[name="status"]').value = '已销单';
      $('[name="closeDate"]').value = o.closeDate;
      await App.save(true);
      U.toast('已确认销单：' + o.id);
    },

    async backup() {
      const all = await DB.all();
      const blob = new Blob([JSON.stringify({ version: 1, exportedAt: new Date().toISOString(), orders: all }, null, 2)],
        { type: 'application/json' });
      U.download(blob, `临期台账备份_${U.today()}.json`);
      U.toast(`已备份 ${all.length} 张单据`);
    },

    async restore(file) {
      if (!file) return;
      try {
        const text = await file.text();
        const data = JSON.parse(text);
        const orders = Array.isArray(data) ? data : data.orders;
        if (!Array.isArray(orders)) throw new Error('备份格式不正确');
        if (!confirm(`将恢复 ${orders.length} 张单据。与现有单据同号的会被覆盖，是否继续？`)) return;
        for (const o of orders) await DB.put(o);
        STATE.allIds = (await DB.all()).map(o => o.id);
        await refreshLedger();
        if (orders.length) await loadOrder(orders[orders.length - 1].id);
        U.toast(`已恢复 ${orders.length} 张单据`);
      } catch (e) { U.toast('恢复失败：' + e.message, true); }
    }
  };

  /* ---------- 视图辅助 ---------- */
  function fillForm(o) {
    $$('#orderForm [name]').forEach(el => {
      if (el.name in o) el.value = o[el.name] == null ? '' : o[el.name];
    });
    recalc();
  }

  function renderCats() {
    const body = $('#catBody');
    if (!body) return;
    body.innerHTML = STATE.cats.map((c, i) =>
      `<tr data-ci="${i}">
        <td><input type="text" value="${U.escapeHtml(c.name)}" data-cf="name" data-ci="${i}" placeholder="如：饮料 / 方便面 / 汽车用品"></td>
        <td><input type="number" min="0" step="1" value="${U.escapeHtml(c.qty)}" data-cf="qty" data-ci="${i}" placeholder="0"></td>
        <td><input type="number" min="0" step="0.01" value="${U.escapeHtml(c.amount)}" data-cf="amount" data-ci="${i}" placeholder="0.00"></td>
        <td><button type="button" class="cat-del" data-ci="${i}" title="删除此行">×</button></td>
      </tr>`).join('');
    updateCatTotal();
  }

  function updateCatTotal() {
    const sub = U.calcCategories(STATE.cats);
    if ($('#catTotalQty')) $('#catTotalQty').textContent = sub.qty;
    if ($('#catTotalAmt')) $('#catTotalAmt').textContent = U.money(sub.amount);
    return sub;
  }

  function bindCats() {
    const body = $('#catBody');
    body.addEventListener('input', e => {
      const el = e.target;
      if (!el.dataset || el.dataset.cf === undefined) return;
      const i = parseInt(el.dataset.ci, 10);
      if (!STATE.cats[i]) return;
      STATE.cats[i][el.dataset.cf] = el.value;
      STATE.dirty = true; markDirty();
      updateCatTotal();
      recalc();
    });
    body.addEventListener('click', e => {
      const btn = e.target.closest('.cat-del');
      if (!btn) return;
      const i = parseInt(btn.dataset.ci, 10);
      STATE.cats.splice(i, 1);
      if (!STATE.cats.length) STATE.cats = [{ name: '', qty: '', amount: '' }];
      STATE.dirty = true; markDirty();
      renderCats(); recalc();
    });
    $('#btnAddCat').addEventListener('click', () => {
      STATE.cats.push({ name: '', qty: '', amount: '' });
      STATE.dirty = true; markDirty();
      renderCats();
      const rows = $$('#catBody tr');
      const last = rows[rows.length - 1];
      if (last) last.querySelector('input').focus();
    });
  }

  function markDirty() { setSaveState('有未保存修改', false); }

  function setSaveState(text, saved) {
    const el = $('#saveState');
    el.textContent = text;
    el.className = 'save-state' + (saved ? ' saved' : '');
  }

  function setStep(i) {
    STATE.step = Math.max(0, Math.min(3, i));
    const ids = ['s1', 's2', 's3', 's4'];
    $$('.step').forEach((b, k) => {
      b.classList.toggle('active', k === STATE.step);
      b.classList.toggle('done', k < STATE.step);
    });
    ids.forEach((id, k) => $('#' + id).classList.toggle('active', k === STATE.step));
    $('#btnPrevStep').disabled = STATE.step === 0;
    $('#btnNextStep').style.display = STATE.step === 3 ? 'none' : '';
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function switchTab(tab) {
    $$('.tab').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
    $$('.panel').forEach(p => p.classList.toggle('active', p.id === 'panel-' + tab));
    if (tab === 'ledger') refreshLedger();
    if (tab === 'export') updateExportMeta();
  }

  function recalc() {
    const form = $('#orderForm');
    const sub = U.calcCategories(STATE.cats);
    if ($('#calcNearAmt')) $('#calcNearAmt').textContent = U.money(sub.amount);
    if ($('#calcNearAmt2')) $('#calcNearAmt2').textContent = U.money(sub.amount);

    const r = U.calcRatios(form, sub.amount);
    if ($('#calcRatio')) $('#calcRatio').textContent = U.pct(r.ratio);
    const rl = $('#calcRedline');
    if (rl) {
      rl.textContent = r.over ? '超 1%（风险）' : '正常';
      rl.className = r.over ? 'redline-hit' : '';
    }

    const p = U.calcPrice(form, sub.amount);
    if ($('#calcDamage')) $('#calcDamage').textContent = U.money(p.estimated) + ' 元（估算）';

    if ($('#s4') && $('#s4').classList.contains('active')) renderChecks(App.collect());
  }

  function runChecks(o) {
    const imgs = g => (o[g] || []).length;
    return [
      { ok: imgs('detailImages') > 0, text: '已上传临期商品明细附表' },
      { ok: (o.categories || []).some(c => String(c.name || '').trim()), text: '已填写分类汇总' },
      { ok: imgs('approveImages') > 0, text: '已上传 OA 审批截图' },
      { ok: o.approveResult !== '不同意' && o.approveResult !== '待审批', text: '审批结果为同意/有条件同意' },
      { ok: imgs('repriceImages') > 0, text: '已上传调价截图' },
      { ok: imgs('saleImages') > 0, text: '已上传销售情况截图' },
      { ok: !!o.closeDate, text: '已填写销单日期' }
    ];
  }

  function renderChecks(o) {
    const items = runChecks(o);
    $('#checkList').innerHTML = items.map(i =>
      `<li class="${i.ok ? 'ok' : 'bad'}">${i.ok ? '✓' : '✗'} ${U.escapeHtml(i.text)}</li>`).join('');
  }

  let ledgerCache = [];
  async function refreshLedger() {
    ledgerCache = await DB.all();
    $('#ledgerCount').textContent = ledgerCache.length;
    const st = $('#filterStation').value.trim();
    const mo = $('#filterMonth').value;
    const status = $('#filterStatus').value;
    const rows = ledgerCache.filter(o =>
      (!st || String(o.station || '').includes(st)) &&
      (!mo || o.month === mo) &&
      (!status || o.status === status)
    );
    const body = $('#ledgerBody');
    body.innerHTML = rows.map(o => {
      const near = o.nearExpireAmount || String(U.calcCategories(o.categories).amount);
      const r = U.calcRatios({ monthSales: { value: o.monthSales }, expiredAmount: { value: o.expiredAmount } }, parseFloat(near) || 0);
      const imgCount = GROUP_KEYS.reduce((n, g) => n + ((o[g] || []).length), 0);
      const catCount = (o.categories || []).filter(c => String(c.name || '').trim()).length;
      const tagCls = o.status === '已销单' ? 'done' : (r.over ? 'warn' : '');
      const catNames = (o.categories || []).filter(c => String(c.name || '').trim()).map(c => c.name).join('、').slice(0, 18);
      return `<tr>
        <td class="mono">${U.escapeHtml(o.id)}</td>
        <td>${U.escapeHtml(o.station)}</td>
        <td>${U.escapeHtml(o.month)}</td>
        <td>${U.escapeHtml(catNames || '—')}<br><small style="color:#9aa1ad">${catCount} 类</small></td>
        <td>${U.escapeHtml(o.applyType || '')}</td>
        <td style="color:${r.over ? '#c83a3a' : 'inherit'}">${U.pct(r.ratio)}</td>
        <td><span class="tag ${tagCls}">${U.escapeHtml(o.status || '')}</span></td>
        <td>${imgCount} 张</td>
        <td>
          <button class="link-btn" data-act="edit" data-id="${U.escapeHtml(o.id)}">编辑</button>
          <button class="link-btn" data-act="del" data-id="${U.escapeHtml(o.id)}">删除</button>
        </td>
      </tr>`;
    }).join('');
    $('#ledgerEmpty').style.display = rows.length ? 'none' : '';
  }

  async function updateExportMeta() {
    const all = await DB.all();
    $('#excelMeta').textContent = `当前共 ${all.length} 张单据（含全部佐证图片）`;
    const cur = STATE.current ? STATE.current.id : '未选择';
    $('#wordMeta').textContent = `当前单据：${cur}`;
  }

  /* ---------- 事件绑定 ---------- */
  function bindUI() {
    $$('.tab').forEach(b => b.addEventListener('click', () => switchTab(b.dataset.tab)));
    $$('.step').forEach(b => b.addEventListener('click', () => setStep(parseInt(b.dataset.step.slice(1), 10) - 1)));
    $('#btnPrevStep').addEventListener('click', () => setStep(STATE.step - 1));
    $('#btnNextStep').addEventListener('click', () => { App.collect(); setStep(STATE.step + 1); });

    $('#orderForm').addEventListener('input', () => {
      STATE.dirty = true; markDirty();
      const g = STATE.activeGroup;
      // activeGroup 由 upload-block 点击更新
      recalc();
    });
    $('#orderForm').addEventListener('change', () => { STATE.dirty = true; markDirty(); recalc(); });
    $$('.upload-block').forEach(b => b.addEventListener('click', () => { STATE.activeGroup = b.dataset.group; }));

    $('#btnSave').addEventListener('click', () => App.save());
    $('#btnNew').addEventListener('click', async () => {
      if (STATE.dirty && !confirm('当前单据有未保存修改，确定新建？')) return;
      await App.newOrder();
    });
    $('#btnCloseOrder').addEventListener('click', () => App.closeOrder());
    $('#btnNewId').addEventListener('click', () => {
      const o = App.collect();
      $('#orderId').value = U.makeId(o.station, o.month, STATE.allIds.filter(x => x !== STATE.current.id));
      markDirty();
    });

    $('#filterStation').addEventListener('input', refreshLedger);
    $('#filterMonth').addEventListener('change', refreshLedger);
    $('#filterStatus').addEventListener('change', refreshLedger);

    $('#ledgerBody').addEventListener('click', e => {
      const b = e.target.closest('button[data-act]');
      if (!b) return;
      if (b.dataset.act === 'edit') App.loadOrder(b.dataset.id);
      if (b.dataset.act === 'del') App.removeOrder(b.dataset.id);
    });

    $('#btnClearAll').addEventListener('click', async () => {
      if (!confirm('⚠️ 将清空全部单据和图片，不可恢复！建议先备份 JSON。确定继续？')) return;
      if (!confirm('请再次确认：真的要清空全部数据吗？')) return;
      await DB.clear();
      STATE.allIds = [];
      await App.newOrder();
      await refreshLedger();
      updateExportMeta();
      U.toast('已清空');
    });

    $('#btnExportExcel').addEventListener('click', async () => {
      const all = await DB.all();
      await global.LQExportExcel.exportExcel(all);
    });
    $('#btnExportWord').addEventListener('click', async () => {
      const scope = $('input[name="wordScope"]:checked').value;
      if (scope === 'current') {
        await global.LQExportWord.exportWord([App.collect()], 'current');
      } else {
        const all = await DB.all();
        await global.LQExportWord.exportWord(all, 'all');
      }
    });

    $('#btnBackup').addEventListener('click', () => App.backup());
    $('#btnBackup2').addEventListener('click', () => App.backup());
    $('#btnRestore').addEventListener('click', () => $('#restoreFile').click());
    $('#btnRestore2').addEventListener('click', () => $('#restoreFile').click());
    $('#restoreFile').addEventListener('change', async e => {
      await App.restore(e.target.files[0]);
      e.target.value = '';
    });

    window.addEventListener('beforeunload', e => {
      if (STATE.dirty) { e.preventDefault(); e.returnValue = ''; }
    });

    // 定时自动保存（每 30 秒），防止忘记点保存
    setInterval(() => { if (STATE.dirty && STATE.current && STATE.current.id) App.save(true); }, 30000);
  }

  global.LQApp = App;
  document.addEventListener('DOMContentLoaded', () => App.init());
})(window);
