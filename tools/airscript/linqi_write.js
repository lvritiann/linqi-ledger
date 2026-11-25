/* ==========================================================================
 * 临期商品一单一销台账 · 直落表   linqi_write.js   v1.0
 *
 * 运行位置：金山在线表格「临期商品一单一销台账（在线）.xlsx」
 *           → 效率 → 高级开发 → AirScript 脚本编辑器（JS 脚本）
 *
 * 触发方式：腾讯云函数中转 POST 本脚本 webhook
 *   地址形如 https://www.kdocs.cn/api/v3/ide/file/{fileId}/script/{scriptId}/sync_task
 *   请求头必须带 AirScript-Token
 *
 * 请求体（网页 → 云函数 → 本脚本）：
 *   { "action": "submit", "actionType": "提交|销单",
 *     "payload": { id, station, month, handler, submittedAt, status, ...业务字段,
 *                  categories:[{name,qty,amount}],
 *                  detailImages:[{name,data}], applyImages:[...], ... } }
 *
 * 查询体（公司导出页用）：
 *   { "action": "list" }
 *
 * 做的事：
 *   1. 一单一行写入「一单一销台账」；同单号重复提交覆盖原行（不叠行）
 *   2. 六组佐证图片用 Range.InsertImage(base64) 直接嵌单元格
 *      每组最多 3 张：第 1 张落原表已有图片列，第 2/3 张落新增列 AR~AY
 *   3. 每次提交都在「提交日志」追加一行，永不覆盖，形成全过程留痕
 *   4. action=list 时返回全部台账与日志，供公司端导出/打印
 *
 * ★ 末尾的 main() 调用不能删 —— 金山是「执行整个脚本」，不调用等于空跑。
 * ★ 本脚本不含任何令牌。令牌只放腾讯云函数环境变量 KDOCS_TOKEN。
 * ========================================================================== */

var CFG = {
  SHEET_MAIN: '一单一销台账',
  SHEET_LOG: '提交日志',
  MAX_ROWS: 5000,
  PHOTO_PER_GROUP: 3
};

/* 六组图片：cols[0] 是模板原图列，cols[1]/[2] 是脚本自动补出的扩展列 */
var IMG_GROUPS = [
  { key: 'detailImages',  label: '明细附表', cols: [18, 44, 45] },
  { key: 'applyImages',   label: '申请截图', cols: [22, 46, 47] },
  { key: 'approveImages', label: '审批截图', cols: [27, 48, 49] },
  { key: 'repriceImages', label: '调价截图', cols: [31, 50, 51] },
  { key: 'saleImages',    label: '销售截图', cols: [35, 52, 53] },
  { key: 'closeImages',   label: '销单截图', cols: [38, 54, 55] }
];

/* AR~AY 扩展列 + BF 图片清单的表头。首跑自动补写，不必手工改在线表。 */
var EXTRA_HEADERS = {
  44: '明细附表图片2', 45: '明细附表图片3',
  46: '申请截图2',     47: '申请截图3',
  48: '审批截图2',     49: '审批截图3',
  50: '调价截图2',     51: '调价截图3',
  52: '销售情况截图2', 53: '销售情况截图3',
  54: '销单截图2',     55: '销单截图3',
  58: '图片清单'
};

var LOG = [];
function say(m) { LOG.push(String(m)); try { console.log(String(m)); } catch (e) { } }

function s(v) { return (v === null || v === undefined) ? '' : String(v).trim(); }
function num(v, dflt) {
  if (v === null || v === undefined || v === '') return (dflt === undefined ? 0 : dflt);
  var n = parseFloat(String(v).replace(/[,\s]/g, ''));
  return isNaN(n) ? (dflt === undefined ? 0 : dflt) : n;
}
function money(n) { return num(n, 0).toFixed(2); }
function pct(n) { return (num(n, 0) * 100).toFixed(2) + '%'; }
function pad(n) { return (n < 10 ? '0' : '') + n; }

/* 列号 → 字母：1=A, 26=Z, 27=AA, 58=BF */
function col(n) {
  var out = '';
  while (n > 0) {
    var m = (n - 1) % 26;
    out = String.fromCharCode(65 + m) + out;
    n = Math.floor((n - 1) / 26);
  }
  return out;
}

/* Application.Sheets 是集合对象不是函数，多种取法兜底 */
function sheet(name) {
  var tries = [
    function () { return Application.Sheets.Item(name); },
    function () { return Application.Sheets(name); },
    function () { return Application.Worksheets.Item(name); },
    function () { return Application.Worksheets(name); },
    function () { return Application.ActiveWorkbook.Sheets.Item(name); },
    function () { return Application.ActiveWorkbook.Worksheets.Item(name); }
  ];
  for (var i = 0; i < tries.length; i++) {
    try { var sh = tries[i](); if (sh) return sh; } catch (e) { }
  }
  return null;
}

function sheetNames() {
  var out = [];
  try {
    var S = Application.Sheets;
    var n = S.Count || S.length || 0;
    for (var i = 1; i <= n; i++) {
      try { var sh = S.Item(i); if (sh && sh.Name) out.push(String(sh.Name)); } catch (e) { }
    }
  } catch (e) { }
  return out;
}

function lastRow(sh) {
  var vals = sh.Range('A1:A' + CFG.MAX_ROWS).Value2 || [];
  var last = 0;
  for (var i = 0; i < vals.length; i++) {
    var v = vals[i];
    if (v && v.length !== undefined) v = v[0];
    if (v !== null && v !== undefined && String(v).trim() !== '') last = i + 1;
  }
  return last;
}

function normMonth(v) {
  if (v === null || v === undefined) return '';
  if (typeof v === 'number') {
    if (v < 40000 || v > 55000) return String(v);
    var d = new Date(Date.UTC(1899, 11, 30) + Math.round(v) * 86400000);
    return d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1);
  }
  if (Object.prototype.toString.call(v) === '[object Date]') {
    return v.getFullYear() + '-' + pad(v.getMonth() + 1);
  }
  var t = String(v).trim();
  var m = /^(\d{4})[-\/.](\d{1,2})/.exec(t);
  if (m) return m[1] + '-' + pad(Number(m[2]));
  return t;
}

function readArgv() {
  var p = null;
  try {
    if (typeof Context !== 'undefined' && Context && Context.argv) p = Context.argv;
  } catch (e) { }
  if (!p) return null;
  /* 兼容 {action,payload} 与直接 {id,...} 两种包法 */
  if (p.payload) {
    var outerAction = s(p.action);
    p = p.payload;
    if (!s(p.action) && outerAction) p.action = outerAction;
  }
  if (!s(p.action)) p.action = 'submit';
  return p;
}

function dataUrl(ph) {
  var d = s(ph && (ph.data || ph.src));
  if (!d) return '';
  if (d.substring(0, 5) === 'data:') return d;
  return 'data:' + (s(ph && ph.mime) || 'image/jpeg') + ';base64,' + d;
}

function normImages(o) {
  var map = {}, names = [], total = 0;
  for (var g = 0; g < IMG_GROUPS.length; g++) {
    var def = IMG_GROUPS[g];
    var arr = o[def.key] || [];
    var list = [];
    for (var i = 0; i < arr.length && i < CFG.PHOTO_PER_GROUP; i++) {
      var src = dataUrl(arr[i]);
      if (!src) continue;
      var nm = s(arr[i].name) || (def.label + (i + 1) + '.jpg');
      list.push({ name: nm, src: src });
      names.push(def.label + '：' + nm);
    }
    map[def.key] = list;
    total += list.length;
  }
  return { map: map, total: total, names: names.join(' | ') };
}

function calcCats(cats) {
  var qty = 0, amount = 0, rows = 0, text = [];
  var list = cats || [];
  for (var i = 0; i < list.length; i++) {
    var c = list[i];
    var nm = s(c && c.name);
    if (!nm) continue;
    rows++;
    qty += num(c.qty, 0);
    amount += num(c.amount, 0);
    text.push(nm + ' ' + s(c.qty || '0') + '件/' + money(c.amount) + '元');
  }
  return { rows: rows, qty: qty, amount: amount, text: text.join('；') };
}

function calcRow(o) {
  var cats = calcCats(o.categories);
  var monthSales = num(o.monthSales, 0);
  var expired = num(o.expiredAmount, 0);
  var ratio = monthSales > 0 ? (cats.amount + expired) / monthSales : 0;
  var rate = num(o.discountRate, 0) / 100;
  var declared = num(o.grossDamage, 0);
  var damage = declared > 0 ? declared : cats.amount * rate;
  return {
    cats: cats,
    ratio: ratio,
    over: ratio > 0.01,
    damage: damage,
    near: cats.amount
  };
}

function ensureHeaders(sh) {
  var added = 0;
  var keys = Object.keys(EXTRA_HEADERS);
  for (var i = 0; i < keys.length; i++) {
    var c = Number(keys[i]);
    try {
      var v = sh.Range(col(c) + '1').Value2;
      if (v && v.length !== undefined) v = v[0];
      if (!s(v)) {
        sh.Range(col(c) + '1').Value2 = EXTRA_HEADERS[c];
        added++;
      }
    } catch (e) { }
  }
  if (added) say('已自动补齐图片扩展列表头 ' + added + ' 列');
}

function findRow(sh, id) {
  var vals = sh.Range('A2:A' + CFG.MAX_ROWS).Value2 || [];
  var target = s(id);
  for (var i = 0; i < vals.length; i++) {
    var v = vals[i];
    if (v && v.length !== undefined) v = v[0];
    if (s(v) === target && target !== '') return i + 2;
  }
  return 0;
}

function clearImages(sh, r) {
  for (var g = 0; g < IMG_GROUPS.length; g++) {
    var cols = IMG_GROUPS[g].cols;
    for (var i = 0; i < cols.length; i++) {
      try { sh.Range(col(cols[i]) + r).Clear(); } catch (e) { }
    }
  }
}

function writeMain(o, imgInfo, calc) {
  var sh = sheet(CFG.SHEET_MAIN);
  if (!sh) throw new Error('找不到工作表「' + CFG.SHEET_MAIN + '」。本簿实际表名：' + sheetNames().join(' / '));
  ensureHeaders(sh);

  var r = findRow(sh, o.id);
  var isNew = !r;
  if (isNew) {
    var last = lastRow(sh);
    r = last + 1;
    if (r < 2) r = 2;
  }
  clearImages(sh, r);

  /* 43 个原字段（审计列留空）+ AR~AY 图片扩展列 + BF 图片清单 = 58 列 */
  var row = [];
  for (var i = 0; i < 58; i++) row.push('');

  row[0]  = s(o.id);
  row[1]  = s(o.station);
  row[2]  = s(o.month);
  row[3]  = s(o.handler);
  row[4]  = s(o.status) || '草稿';
  row[5]  = s(o.batchNo);
  row[6]  = s(o.checkDate);
  row[7]  = s(o.batchTotal);
  row[8]  = calc.cats.rows;
  row[9]  = calc.cats.text;
  row[10] = num(o.monthSales, 0);
  row[11] = calc.near;
  row[12] = s(o.hasExpired) || '否';
  row[13] = num(o.expiredAmount, 0);
  row[14] = pct(calc.ratio);
  row[15] = calc.over ? '超 1%（风险）' : '正常';
  row[16] = s(o.nearExpireProducts);

  /* R/V/AA/AE/AI/AL/AQ 七列留给 InsertImage，文本不入值 */
  row[18] = s(o.applyDate);
  row[19] = s(o.applyType);
  row[20] = s(o.applyReason);
  /* row[21] 申请截图图片列 */
  row[22] = s(o.oaNo);
  row[23] = s(o.approver);
  row[24] = s(o.approveDate);
  row[25] = s(o.approveResult);
  /* row[26] 审批截图图片列 */
  row[27] = num(o.discountRate, 0);
  row[28] = s(o.repriceDate);
  row[29] = calc.damage;
  /* row[30] 调价截图图片列 */
  row[31] = num(o.soldQty, 0);
  row[32] = num(o.soldAmount, 0);
  row[33] = s(o.saleEndDate);
  /* row[34] 销售情况截图图片列 */
  row[35] = s(o.closeDate);
  row[36] = s(o.closeNote);
  /* row[37] 销单截图图片列 */
  /* 原表第 39～43 列为历史审计列，本版不再写入，保留留空以兼容既有在线表 */
  row[57] = imgInfo.names;

  /* 单号/月份强制文本，避免 2026-11 被转成日期序列号 */
  try { sh.Range('A' + r).NumberFormat = '@'; } catch (e) { }
  try { sh.Range('C' + r).NumberFormat = '@'; } catch (e) { }

  var wrote = false;
  try {
    sh.Range('A' + r + ':BF' + r).Value2 = [row];
    wrote = true;
  } catch (e1) {
    /* 单行 58 列若不被接受，退回逐格写，慢但稳 */
    say('整行写入失败，改逐格写：' + (e1 && e1.message ? e1.message : e1));
    var ok = 0;
    for (var k = 0; k < row.length; k++) {
      try { sh.Range(col(k + 1) + r).Value2 = row[k]; ok++; } catch (e2) { }
    }
    say('逐格写入成功 ' + ok + ' 格');
    wrote = ok > 0;
  }
  if (!wrote) throw new Error('台账行未能写入');
  return { row: r, isNew: isNew };
}

function writeImages(pics, r) {
  var sh = sheet(CFG.SHEET_MAIN);
  var n = 0, miss = 0;
  for (var g = 0; g < IMG_GROUPS.length; g++) {
    var def = IMG_GROUPS[g];
    var list = pics.map[def.key] || [];
    if (!list.length) { miss++; continue; }
    for (var i = 0; i < list.length; i++) {
      var c = def.cols[i];
      if (!c) continue;
      try {
        sh.Range(col(c) + r).InsertImage(list[i].src);
        n++;
      } catch (e) {
        say('写 ' + col(c) + r + ' 图片失败：' + (e && e.message ? e.message : e));
      }
    }
  }
  if (miss) say('有 ' + miss + ' 组未传图片，对应单元格留空');
  return n;
}

function writeLog(p, imgInfo, calc) {
  var sh = sheet(CFG.SHEET_LOG);
  if (!sh) throw new Error('找不到工作表「' + CFG.SHEET_LOG + '」。本簿实际表名：' + sheetNames().join(' / '));

  var r = lastRow(sh) + 1;
  if (r < 2) r = 2;
  var note = s(p.note) || ('状态：' + s(p.status || '草稿') + '；OA：' + s(p.oaNo || '无'));
  var vals = [[
    r - 1,
    s(p.id),
    s(p.station),
    s(p.month),
    s(p.submittedAt),
    s(p.handler),
    calc.cats.rows,
    calc.near,
    imgInfo.total,
    s(p.actionType) || '提交',
    note
  ]];
  sh.Range('A' + r + ':K' + r).Value2 = vals;
  try { sh.Range('B' + r).NumberFormat = '@'; } catch (e) { }
  return r;
}

function listAll() {
  var out = { ok: true, records: [], logs: [] };
  var sh = sheet(CFG.SHEET_MAIN);
  if (sh) {
    var last = lastRow(sh);
    if (last >= 2) {
      var vals = sh.Range('A2:BF' + last).Value2 || [];
      for (var i = 0; i < vals.length; i++) {
        var r = vals[i];
        if (!r || r.length === undefined || !s(r[0])) continue;
        out.records.push({
          id: s(r[0]), station: s(r[1]), month: normMonth(r[2]), handler: s(r[3]),
          status: s(r[4]), batchNo: s(r[5]), checkDate: s(r[6]), batchTotal: s(r[7]),
          categoryCount: num(r[8], 0), categoryText: s(r[9]),
          monthSales: num(r[10], 0), nearAmount: num(r[11], 0), hasExpired: s(r[12]),
          expiredAmount: num(r[13], 0), ratioText: s(r[14]), redline: s(r[15]),
          nearNote: s(r[16]),
          applyDate: s(r[18]), applyType: s(r[19]), applyReason: s(r[20]),
          oaNo: s(r[22]), approver: s(r[23]), approveDate: s(r[24]), approveResult: s(r[25]),
          discountRate: num(r[27], 0), repriceDate: s(r[28]), grossDamage: num(r[29], 0),
          soldQty: num(r[31], 0), soldAmount: num(r[32], 0), saleEndDate: s(r[33]),
          closeDate: s(r[35]), closeNote: s(r[36]),
          imageList: s(r[57])
        });
      }
    }
  }
  var lg = sheet(CFG.SHEET_LOG);
  if (lg) {
    var llast = lastRow(lg);
    if (llast >= 2) {
      var lvals = lg.Range('A2:K' + llast).Value2 || [];
      for (var j = 0; j < lvals.length; j++) {
        var q = lvals[j];
        if (!q || q.length === undefined || !s(q[1])) continue;
        out.logs.push({
          seq: num(q[0], 0), id: s(q[1]), station: s(q[2]), month: normMonth(q[3]),
          submittedAt: s(q[4]), handler: s(q[5]), categoryCount: num(q[6], 0),
          nearAmount: num(q[7], 0), imageCount: num(q[8], 0),
          actionType: s(q[9]), note: s(q[10])
        });
      }
    }
  }
  out.count = out.records.length;
  out.logCount = out.logs.length;
  return out;
}

function bad(msg) {
  return JSON.stringify({ ok: false, error: msg, log: LOG });
}

function main() {
  LOG = [];
  say('linqi_write v1.0 · 直写台账版');
  var p = readArgv();
  if (!p) return bad('没有收到参数（Context.argv 为空）');

  var action = s(p.action).toLowerCase();
  if (action === 'list' || action === 'query') {
    var data = listAll();
    say('查询：台账 ' + data.count + ' 行，日志 ' + data.logCount + ' 行');
    data.log = LOG;
    return JSON.stringify(data);
  }

  if (action !== 'submit') return bad('未知 action：' + action);
  if (!s(p.id)) return bad('缺 id');
  if (!s(p.station)) return bad('缺 station');
  if (!s(p.month)) return bad('缺 month');
  if (!/^\d{4}-\d{2}$/.test(s(p.month))) return bad('month 格式应为 YYYY-MM，收到：' + s(p.month));
  if (!p.categories || !p.categories.length) return bad('缺 categories（至少填一个品类）');

  var imgInfo = normImages(p);
  var calc = calcRow(p);
  say('分类 ' + calc.cats.rows + ' 类 / 临期金额 ' + money(calc.near) +
      ' / 占比 ' + pct(calc.ratio) + ' / 图片 ' + imgInfo.total + ' 张');

  var wr;
  try {
    wr = writeMain(p, imgInfo, calc);
  } catch (e) {
    return bad('写「' + CFG.SHEET_MAIN + '」失败：' + (e && e.message ? e.message : e));
  }
  say((wr.isNew ? '新增' : '覆盖') + '台账第 ' + wr.row + ' 行');

  var npic = 0;
  try {
    npic = writeImages(imgInfo, wr.row);
  } catch (e) {
    say('图片嵌入异常（文字已落表）：' + (e && e.message ? e.message : e));
  }
  if (npic) say('已嵌图 ' + npic + ' 张');

  var lr = 0;
  try {
    lr = writeLog(p, imgInfo, calc);
  } catch (e) {
    return bad('写「' + CFG.SHEET_LOG + '」失败：' + (e && e.message ? e.message : e));
  }
  say('已追加提交日志第 ' + lr + ' 行');

  return JSON.stringify({
    ok: true,
    action: 'submit',
    id: s(p.id),
    station: s(p.station),
    month: s(p.month),
    row: wr.row,
    isNew: wr.isNew,
    photos: npic,
    logRow: lr,
    ratio: pct(calc.ratio),
    log: LOG
  });
}

/* ★★★ 不能删：金山执行整个脚本，不调用就是空跑、零日志 ★★★ */
var __ret = main();
try { console.log(__ret); } catch (e) { }
return __ret;
