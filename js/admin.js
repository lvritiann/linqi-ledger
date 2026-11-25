/* 公司导出端：只读取云端数据，不在本机保存业务数据。 */
(function (global) {
  'use strict';
  const U = global.LQUtils;
  const Cloud = global.LQCloud;
  const CFG = global.LQ_CFG || {};
  const $ = U.$, $$ = U.$$;

  const STATE = { records: [], logs: [], ready: false };

  function filtered() {
    const st = ($('#adminFilterStation') && $('#adminFilterStation').value.trim()) || '';
    const mo = ($('#adminFilterMonth') && $('#adminFilterMonth').value) || '';
    const ok = o => (!st || String(o.station || '').includes(st)) && (!mo || String(o.month || '') === mo);
    return {
      records: STATE.records.filter(ok),
      logs: STATE.logs.filter(ok)
    };
  }

  async function load(silent) {
    setState('正在读取在线数据…');
    try {
      const data = await Cloud.list();
      if (data && data.ok === false) throw new Error(data.error || '查询失败');
      STATE.records = (data && data.records) || [];
      STATE.logs = (data && data.logs) || [];
      STATE.ready = true;
      render();
      setState('已读取 ' + STATE.records.length + ' 单 / ' + STATE.logs.length + ' 条日志');
      if (!silent) U.toast('在线数据已刷新');
    } catch (e) {
      setState('读取失败');
      U.toast('读取在线数据失败：' + (e && e.message ? e.message : e), true);
    }
  }

  function setState(t) { const el = $('#adminState'); if (el) el.textContent = t; }

  function render() {
    const f = filtered();
    renderSummary();
    renderRecords(f.records);
    renderLogs(f.logs);
    const head = $('#printHead');
    if (head) {
      head.textContent = '临期商品一单一销台账 · 公司打印版　生成时间：' + formatNow() +
        '　共 ' + f.records.length + ' 单 / ' + f.logs.length + ' 条提交记录';
    }
  }

  function renderSummary() {
    const imgs = STATE.logs.reduce((n, x) => n + (Number(x.imageCount) || 0), 0);
    let latest = '';
    STATE.logs.forEach(x => { if (String(x.submittedAt || '') > latest) latest = String(x.submittedAt); });
    $('#sumRecords').textContent = STATE.records.length;
    $('#sumLogs').textContent = STATE.logs.length;
    $('#sumImages').textContent = imgs;
    $('#sumLatest').textContent = latest || '—';
  }

  function renderRecords(rows) {
    const body = $('#adminRecordBody');
    body.innerHTML = rows.map(o => `<tr>
      <td class="mono">${U.escapeHtml(o.id)}</td>
      <td>${U.escapeHtml(o.station)}</td>
      <td>${U.escapeHtml(o.month)}</td>
      <td>${U.escapeHtml(o.handler)}</td>
      <td><span class="tag ${o.status === '已销单' ? 'done' : ''}">${U.escapeHtml(o.status)}</span></td>
      <td>${U.escapeHtml(o.categoryText || '—')}<br><small style="color:#9aa1ad">${o.categoryCount || 0} 类</small></td>
      <td>${U.money(o.nearAmount)}</td>
      <td>${U.escapeHtml(o.ratioText || '0.00%')}</td>
      <td style="color:${String(o.redline || '').indexOf('超') >= 0 ? '#c83a3a' : 'inherit'}">${U.escapeHtml(o.redline)}</td>
      <td>${U.escapeHtml(o.oaNo)}</td>
      <td>${U.escapeHtml(o.imageList || '—')}</td>
    </tr>`).join('');
    $('#adminRecordEmpty').style.display = rows.length ? 'none' : '';
  }

  function renderLogs(rows) {
    const body = $('#adminLogBody');
    body.innerHTML = rows.map(o => `<tr>
      <td>${o.seq || ''}</td>
      <td class="mono">${U.escapeHtml(o.id)}</td>
      <td>${U.escapeHtml(o.station)}</td>
      <td>${U.escapeHtml(o.month)}</td>
      <td>${U.escapeHtml(o.submittedAt)}</td>
      <td>${U.escapeHtml(o.handler)}</td>
      <td>${o.categoryCount || 0}</td>
      <td>${U.money(o.nearAmount)}</td>
      <td>${o.imageCount || 0}</td>
      <td>${U.escapeHtml(o.actionType || '提交')}</td>
      <td>${U.escapeHtml(o.note)}</td>
    </tr>`).join('');
    $('#adminLogEmpty').style.display = rows.length ? 'none' : '';
  }

  function formatNow() {
    const d = new Date();
    const p = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
  }

  async function exportExcel() {
    if (!STATE.ready) { U.toast('请先进入公司端并读取在线数据', true); return; }
    if (!global.ExcelJS) { U.toast('Excel 组件未加载：vendor/exceljs.min.js', true); return; }
    const f = filtered();
    const wb = new ExcelJS.Workbook();
    wb.creator = '临期台账公司导出端';
    wb.created = new Date();

    const ws = wb.addWorksheet('台账打印版');
    ws.columns = [
      { header: '单号', key: 'id', width: 24 },
      { header: '油站', key: 'station', width: 12 },
      { header: '统计月份', key: 'month', width: 12 },
      { header: '填报人', key: 'handler', width: 12 },
      { header: '状态', key: 'status', width: 12 },
      { header: '批次号', key: 'batchNo', width: 18 },
      { header: '分类汇总', key: 'categoryText', width: 60 },
      { header: '当月销售额', key: 'monthSales', width: 14 },
      { header: '临期商品金额', key: 'nearAmount', width: 14 },
      { header: '临期占比', key: 'ratioText', width: 12 },
      { header: '1%红线', key: 'redline', width: 16 },
      { header: 'OA单号', key: 'oaNo', width: 20 },
      { header: '审批结果', key: 'approveResult', width: 14 },
      { header: '销单日期', key: 'closeDate', width: 14 },
      { header: '图片清单', key: 'imageList', width: 60 }
    ];
    f.records.forEach(o => ws.addRow(o));
    ws.getRow(1).font = { bold: true };
    ws.views = [{ state: 'frozen', ySplit: 1 }];

    const wl = wb.addWorksheet('提交日志');
    wl.columns = [
      { header: '序号', key: 'seq', width: 8 },
      { header: '单号', key: 'id', width: 24 },
      { header: '油站', key: 'station', width: 12 },
      { header: '月份', key: 'month', width: 12 },
      { header: '提交时间', key: 'submittedAt', width: 20 },
      { header: '提交人', key: 'handler', width: 12 },
      { header: '品类数', key: 'categoryCount', width: 10 },
      { header: '临期金额', key: 'nearAmount', width: 14 },
      { header: '图片数', key: 'imageCount', width: 10 },
      { header: '操作类型', key: 'actionType', width: 12 },
      { header: '备注', key: 'note', width: 40 }
    ];
    f.logs.forEach(o => wl.addRow(o));
    wl.getRow(1).font = { bold: true };
    wl.views = [{ state: 'frozen', ySplit: 1 }];

    const wi = wb.addWorksheet('打印说明');
    wi.columns = [
      { header: '项目', key: 'k', width: 22 },
      { header: '内容', key: 'v', width: 90 }
    ];
    wi.addRow({ k: '生成时间', v: formatNow() });
    wi.addRow({ k: '单据数量', v: f.records.length });
    wi.addRow({ k: '提交日志', v: f.logs.length });
    wi.addRow({ k: '图片原件', v: '佐证图片已在金山在线表格「一单一销台账」单元格内，打印含图版本请直接在金山表格打印，或打开在线台账后再打印。' });
    wi.addRow({ k: '留痕说明', v: '每次提交均在「提交日志」追加一行，重复提交不删除旧日志。' });

    try {
      const buf = await wb.xlsx.writeBuffer();
      U.download(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }),
        `临期台账_公司打印版_${U.today()}.xlsx`);
      U.toast('已导出公司打印版 Excel');
    } catch (e) {
      U.toast('导出失败：' + e.message, true);
    }
  }

  function login() {
    const code = ($('#adminCode').value || '').trim();
    const want = String(CFG.companyCode || '888888');
    if (code !== want) { U.toast('口令不正确', true); return; }
    $('#adminGate').style.display = 'none';
    $('#adminMain').style.display = 'block';
    load();
  }

  function bind() {
    $('#btnAdminLogin').addEventListener('click', login);
    $('#adminCode').addEventListener('keydown', e => { if (e.key === 'Enter') login(); });
    $('#btnAdminRefresh').addEventListener('click', () => load());
    $('#btnAdminExport').addEventListener('click', exportExcel);
    $('#btnAdminPrint').addEventListener('click', () => { render(); window.print(); });
    $('#adminFilterStation').addEventListener('input', render);
    $('#adminFilterMonth').addEventListener('change', render);
    $('#btnAdminOpenKdocs').addEventListener('click', () => {
      const url = (CFG.kdocs && CFG.kdocs.url) || '';
      if (url) window.open(url, '_blank');
    });
  }

  document.addEventListener('DOMContentLoaded', bind);
})(window);
