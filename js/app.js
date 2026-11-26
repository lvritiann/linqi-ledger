/* 油站填报端主控制器 · 云端直写版
 * 原则：网页不存数据。所有提交经云函数写入金山在线表格；刷新页面即清空重填。 */
(function (global) {
  'use strict';
  const U = global.LQUtils;
  const Cloud = global.LQCloud;
  const $ = U.$, $$ = U.$$;

  const STATE = {
    current: null,
    images: {},
    cats: [],
    allIds: [],
    records: [],
    logs: [],
    activeGroup: 'detailImages',
    step: 0,
    dirty: false
  };
  const GROUP_KEYS = ['detailImages', 'applyImages', 'approveImages', 'repriceImages', 'saleImages', 'closeImages'];

  /* ---------- 枚举清单（js/catalog.js，来自非油驾驶舱，权威去重） ---------- */
  /* catalog.js 未加载时降级为空对象，避免整页脚本崩溃；填报页另给明确提示 */
  function catalog() {
    return global.LQ_CATALOG || { stations: [], stationShorts: {}, bigs: [], tree: {} };
  }

  /* 油站选项：withFull=true 显示「简称（全称）」，false 只显示简称；value 一律为全称 */
  function stationOptions(withFull) {
    const cat = catalog();
    const shorts = cat.stationShorts || {};
    return (cat.stations || []).map(s => {
      const short = shorts[s] || s;
      const label = withFull ? short + '（' + s + '）' : short;
      return `<option value="${U.escapeHtml(s)}" title="${U.escapeHtml(s)}">${U.escapeHtml(label)}</option>`;
    }).join('');
  }

  /* 填报表单与提交记录筛选共用同一份清单，避免两处选项漂移 */
  function fillStationSelects() {
    const cat = catalog();
    if (!cat.stations || !cat.stations.length) {
      U.toast('油站清单未加载，请检查 js/catalog.js', true);
      return;
    }
    const formSel = $('select[name="station"]');
    if (formSel) formSel.insertAdjacentHTML('beforeend', stationOptions(true));
    const filterSel = $('#filterRecordStation');
    if (filterSel) filterSel.insertAdjacentHTML('beforeend', stationOptions(false));
  }

  /* 单个 option；selected 时补属性，值一律转义 */
  function catOption(value, text, selected) {
    return `<option value="${U.escapeHtml(value)}"${selected ? ' selected' : ''}>${U.escapeHtml(text)}</option>`;
  }

  /* 中类选项：首项留空表示「只按大类填」；大类为空或自定义时不列中类 */
  function midOptions(big, current) {
    const tree = catalog().tree || {};
    const mids = (big && big !== '__custom__' && tree[big]) || [];
    return catOption('', '仅大类（可留空）', !current) + mids.map(m => catOption(m, m, m === current)).join('');
  }

  /* 由存量 c.name 反推两级位置：命中大类→只选大类；命中中类→两级；都不命中→自定义 */
  function resolveCat(name) {
    const cat = catalog();
    const n = String(name == null ? '' : name).trim();
    if (!n) return { big: '', mid: '', custom: '' };
    if ((cat.bigs || []).indexOf(n) >= 0) return { big: n, mid: '', custom: '' };
    const tree = cat.tree || {};
    for (const b of (cat.bigs || [])) {
      if ((tree[b] || []).indexOf(n) >= 0) return { big: b, mid: n, custom: '' };
    }
    return { big: '__custom__', mid: '', custom: n };
  }

  function newOrder() { return App.newOrder(); }
  function loadPlaceholder(id) { return App.loadPlaceholder(id); }

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
      fillStationSelects();
      bindUI();
      bindCats();
      global.LQImages.init();

      /* 先渲染空白单据与分类行：DOM ready 即可见三级联动，不等待云函数。
         云端读取只服务于记录页与单号去重，放到后台完成；不可达时静默，填报不受影响。 */
      await App.newOrder();
      renderRecords();

      Cloud.list().then(data => {
        if (data && data.ok !== false) {
          STATE.records = data.records || [];
          STATE.logs = data.logs || [];
          STATE.allIds = STATE.records.map(o => o.id);
        }
        renderRecords();
      }).catch(() => {
        /* 云函数未配置或不可达时静默：提交时会给出明确提示 */
      });
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
        closeDate: '', closeNote: '',
        detailImages: [], applyImages: [], approveImages: [], repriceImages: [], saleImages: [], closeImages: [],
        createdAt: new Date().toISOString()
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
      setSaveState('新单据（未提交）', false);
      STATE.dirty = false;
    },

    /* 提交记录页只读，不加载回表单；如需更正用同单号重新提交 */
    async loadPlaceholder(id) {
      U.toast('在线记录只读；如需更正，请用同一单号重新提交');
      $('#orderId').value = id;
      markDirty();
      switchTab('form');
    },

    collect() {
      const form = $('#orderForm');
      const o = STATE.current || App.blankOrder();
      $$('[name]', form).forEach(el => {
        if (!el.name) return;
        o[el.name] = el.value;
      });
      o.categories = STATE.cats.map(c => ({
        name: String(c.name || ''), qty: String(c.qty || ''), amount: String(c.amount || '')
      }));
      const sub = U.calcCategories(o.categories);
      o.categoryCount = sub.rows;
      o.batchTotal = o.batchTotal || String(sub.qty);
      o.nearExpireAmount = String(sub.amount);
      o.id = $('#orderId').value.trim() || o.id;
      if (o.station && o.id.includes('未填')) {
        o.id = U.makeId(o.station, o.month, STATE.allIds.filter(x => x !== STATE.current.id));
        $('#orderId').value = o.id;
      }
      GROUP_KEYS.forEach(g => { o[g] = App.getImages(g); });
      o.updatedAt = new Date().toISOString();
      return o;
    },

    validate(o) {
      if (!o.id) return '请填写单号';
      if (!o.station) return '请填写油站';
      if (!o.month) return '请选择统计月份';
      if (!o.categories.some(c => String(c.name || '').trim())) return '请至少填写一个品类';
      return '';
    },

    async submit(actionType) {
      const o = App.collect();
      const err = App.validate(o);
      if (err) { U.toast(err, true); return; }

      const btnSubmit = $('#btnSubmit');
      const btnClose = $('#btnCloseOrder');
      btnSubmit.disabled = true;
      btnClose.disabled = true;
      setSaveState('正在提交到在线台账…', false);

      o.submittedAt = formatNow();
      if (actionType === '销单') {
        o.status = '已销单';
        if (!o.closeDate) o.closeDate = U.today();
      }

      try {
        const ret = await Cloud.submit(o, actionType || '提交');
        if (ret && ret.ok === true) {
          STATE.current = o;
          STATE.dirty = false;
          if (STATE.allIds.indexOf(o.id) < 0) STATE.allIds.push(o.id);
          setSaveState('已提交 ' + formatHM(), true);
          U.toast('已提交并写入在线台账：' + o.id);
          await refreshRecords(true);
        } else if (ret && ret.pending === true) {
          setSaveState('已送达，结果未确认', false);
          U.toast('已送达金山，但结果未确认。请先到在线台账核对，不要重复提交。', true);
        } else {
          throw new Error((ret && ret.error) || '落表失败（无具体错误）');
        }
      } catch (e) {
        setSaveState('提交失败', false);
        U.toast('提交失败：' + (e && e.message ? e.message : e), true);
      } finally {
        btnSubmit.disabled = false;
        btnClose.disabled = false;
      }
    },

    async closeOrder() {
      const o = App.collect();
      const checks = runChecks(o);
      const bad = checks.filter(c => !c.ok);
      if (bad.length) {
        U.toast('销单前请先处理：' + bad[0].text, true);
        return;
      }
      await App.submit('销单');
    }
  };

  /* ---------- 视图辅助 ---------- */
  function formatNow() {
    const d = new Date();
    const p = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
  }
  function formatHM() {
    const d = new Date();
    return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
  }

  function fillForm(o) {
    $$('#orderForm [name]').forEach(el => {
      if (el.name in o) el.value = o[el.name] == null ? '' : o[el.name];
    });
    recalc();
  }

  /* 分类行：第 1 列改为「大类 + 中类 + 自定义」；整行状态都由 STATE.cats[i].name 反推，
     因此 renderCats() 重建后仍能正确还原，loadOrder 之类的回填路径只要写入 cats 即可 */
  function renderCats() {
    const body = $('#catBody');
    if (!body) return;
    const bigs = catalog().bigs || [];
    body.innerHTML = STATE.cats.map((c, i) => {
      const r = resolveCat(c.name);
      const isCustom = r.big === '__custom__';
      const bigOpts = catOption('', '选择大类', !r.big) +
        bigs.map(b => catOption(b, b, b === r.big)).join('') +
        catOption('__custom__', '自定义…', isCustom);
      return `<tr data-ci="${i}">
        <td>
          <div class="cat-pick">
            <select class="cat-big" data-ci="${i}" data-role="big" aria-label="分类大类">${bigOpts}</select>
            <select class="cat-mid" data-ci="${i}" data-role="mid" aria-label="分类中类"${isCustom || !r.big ? ' disabled' : ''}>${midOptions(r.big, r.mid)}</select>
            <input type="text" class="cat-custom" data-ci="${i}" data-role="custom" value="${U.escapeHtml(r.custom)}" placeholder="输入清单外品类"${isCustom ? '' : ' style="display:none"'}>
          </div>
        </td>
        <td><input type="number" min="0" step="1" value="${U.escapeHtml(c.qty)}" data-cf="qty" data-role="qty" data-ci="${i}" placeholder="0"></td>
        <td><input type="number" min="0" step="0.01" value="${U.escapeHtml(c.amount)}" data-cf="amount" data-role="amount" data-ci="${i}" placeholder="0.00"></td>
        <td><button type="button" class="cat-del" data-ci="${i}" title="删除此行">×</button></td>
      </tr>`;
    }).join('');
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

    /* 两级下拉用事件委托：renderCats() 重建行后无需重新绑定，联动持续生效 */
    body.addEventListener('change', e => {
      const el = e.target;
      if (!el.dataset || !el.dataset.role) return;
      const role = el.dataset.role;
      if (role !== 'big' && role !== 'mid') return;
      const i = parseInt(el.dataset.ci, 10);
      if (!STATE.cats[i]) return;
      const row = el.closest('tr');
      if (!row) return;
      const midSel = row.querySelector('.cat-mid');
      const custom = row.querySelector('.cat-custom');

      if (role === 'big') {
        const big = el.value;
        if (big === '__custom__') {
          midSel.innerHTML = midOptions('', '');
          midSel.disabled = true;
          custom.style.display = '';
          custom.value = '';
          custom.focus();
          STATE.cats[i].name = '';
        } else if (!big) {
          midSel.innerHTML = midOptions('', '');
          midSel.disabled = true;
          custom.style.display = 'none';
          custom.value = '';
          STATE.cats[i].name = '';
        } else {
          midSel.innerHTML = midOptions(big, '');
          midSel.disabled = false;
          custom.style.display = 'none';
          custom.value = '';
          /* 只选大类时 name 存大类名，保持数据结构仍是 {name,qty,amount} */
          STATE.cats[i].name = big;
        }
      } else {
        const big = row.querySelector('.cat-big').value;
        STATE.cats[i].name = el.value || big || '';
      }
      STATE.dirty = true; markDirty();
      updateCatTotal(); recalc();
    });

    /* 自定义品类与数量、金额仍走 input 事件，dirty / 合计 / 重算链路不变 */
    body.addEventListener('input', e => {
      const el = e.target;
      if (!el.dataset || !el.dataset.role) return;
      const role = el.dataset.role;
      if (role !== 'qty' && role !== 'amount' && role !== 'custom') return;
      const i = parseInt(el.dataset.ci, 10);
      if (!STATE.cats[i]) return;
      STATE.cats[i][role === 'custom' ? 'name' : role] = el.value;
      STATE.dirty = true; markDirty();
      updateCatTotal(); recalc();
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
      const firstSel = last && last.querySelector('.cat-big');
      if (firstSel) firstSel.focus();
    });
  }

  function markDirty() { setSaveState('有未提交修改', false); }

  function setSaveState(text, saved) {
    const el = $('#saveState');
    if (!el) return;
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
    if (tab === 'records') refreshRecords();
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

  /* ---------- 在线提交记录（只读） ---------- */
  async function refreshRecords(silent) {
    try {
      const data = await Cloud.list();
      if (data && data.ok === false) throw new Error(data.error || '查询失败');
      STATE.records = (data && data.records) || [];
      STATE.logs = (data && data.logs) || [];
      STATE.allIds = STATE.records.map(o => o.id);
    } catch (e) {
      if (!silent) U.toast('读取在线记录失败：' + (e && e.message ? e.message : e), true);
    }
    renderRecords();
  }

  function renderRecords() {
    const st = ($('#filterRecordStation') && $('#filterRecordStation').value.trim()) || '';
    const mo = ($('#filterRecordMonth') && $('#filterRecordMonth').value) || '';
    const rows = STATE.records.filter(o =>
      (!st || String(o.station || '').includes(st)) && (!mo || o.month === mo)
    );
    const body = $('#recordBody');
    if (body) {
      body.innerHTML = rows.map(o => {
        const imgs = o.imageList ? o.imageList.split('|').length : 0;
        const over = String(o.redline || '').indexOf('超') >= 0;
        const cat = String(o.categoryText || '').slice(0, 18);
        return `<tr>
          <td class="mono">${U.escapeHtml(o.id)}</td>
          <td>${U.escapeHtml(o.station)}</td>
          <td>${U.escapeHtml(o.month)}</td>
          <td>${U.escapeHtml(cat || '—')}<br><small style="color:#9aa1ad">${o.categoryCount || 0} 类</small></td>
          <td>${U.money(o.nearAmount)}</td>
          <td style="color:${over ? '#c83a3a' : 'inherit'}">${U.escapeHtml(o.ratioText || '0.00%')}</td>
          <td><span class="tag ${o.status === '已销单' ? 'done' : ''}">${U.escapeHtml(o.status || '')}</span></td>
          <td>${imgs} 张</td>
        </tr>`;
      }).join('');
    }
    if ($('#recordCount')) $('#recordCount').textContent = STATE.records.length;
    if ($('#recordEmpty')) $('#recordEmpty').style.display = rows.length ? 'none' : '';

    const logRows = STATE.logs.filter(o =>
      (!st || String(o.station || '').includes(st)) && (!mo || o.month === mo)
    );
    const logBody = $('#logBody');
    if (logBody) {
      logBody.innerHTML = logRows.map(o => `<tr>
        <td>${o.seq || ''}</td>
        <td class="mono">${U.escapeHtml(o.id)}</td>
        <td>${U.escapeHtml(o.station)}</td>
        <td>${U.escapeHtml(o.submittedAt)}</td>
        <td>${U.escapeHtml(o.handler)}</td>
        <td>${o.categoryCount || 0}</td>
        <td>${U.money(o.nearAmount)}</td>
        <td>${o.imageCount || 0}</td>
        <td>${U.escapeHtml(o.actionType || '提交')}</td>
      </tr>`).join('');
    }
    if ($('#logCount')) $('#logCount').textContent = STATE.logs.length;
    if ($('#logEmpty')) $('#logEmpty').style.display = logRows.length ? 'none' : '';
  }

  /* ---------- 事件绑定 ---------- */
  function bindUI() {
    $$('.tab').forEach(b => b.addEventListener('click', () => switchTab(b.dataset.tab)));
    $$('.step').forEach(b => b.addEventListener('click', () => setStep(parseInt(b.dataset.step.slice(1), 10) - 1)));
    $('#btnPrevStep').addEventListener('click', () => setStep(STATE.step - 1));
    $('#btnNextStep').addEventListener('click', () => { App.collect(); setStep(STATE.step + 1); });

    $('#orderForm').addEventListener('input', () => { STATE.dirty = true; markDirty(); recalc(); });
    $('#orderForm').addEventListener('change', () => { STATE.dirty = true; markDirty(); recalc(); });
    $$('.upload-block').forEach(b => b.addEventListener('click', () => { STATE.activeGroup = b.dataset.group; }));

    $('#btnSubmit').addEventListener('click', () => App.submit('提交'));
    $('#btnCloseOrder').addEventListener('click', () => App.closeOrder());
    $('#btnNew').addEventListener('click', async () => {
      if (STATE.dirty && !confirm('当前单据尚未提交，确定清空重填？')) return;
      await App.newOrder();
    });
    $('#btnNewId').addEventListener('click', () => {
      const o = App.collect();
      $('#orderId').value = U.makeId(o.station, o.month, STATE.allIds.filter(x => x !== STATE.current.id));
      markDirty();
    });

    $('#btnOpenKdocs').addEventListener('click', () => {
      const url = (global.LQ_CFG && global.LQ_CFG.kdocs && global.LQ_CFG.kdocs.url) || '';
      if (url) window.open(url, '_blank');
    });

    $('#btnRefreshRecords').addEventListener('click', () => refreshRecords());
    $('#filterRecordStation').addEventListener('change', renderRecords);
    $('#filterRecordMonth').addEventListener('change', renderRecords);

    window.addEventListener('beforeunload', e => {
      if (STATE.dirty) { e.preventDefault(); e.returnValue = ''; }
    });
  }

  global.LQApp = App;
  document.addEventListener('DOMContentLoaded', () => App.init());
})(window);
