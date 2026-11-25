/* Excel 主台账导出：一行一单，六组佐证图嵌入对应单元格 */
(function (global) {
  'use strict';
  const U = global.LQUtils;

  const COLS = [
    { h: '单号', k: 'id', w: 24 },
    { h: '油站', k: 'station', w: 12 },
    { h: '统计月份', k: 'month', w: 12 },
    { h: '填报人', k: 'handler', w: 11 },
    { h: '状态', k: 'status', w: 11 },
    { h: '批次号', k: 'batchNo', w: 16 },
    { h: '盘点日期', k: 'checkDate', w: 13 },
    { h: '批次总数(件)', k: 'batchTotal', w: 13 },
    { h: '品类数', k: 'categoryCount', w: 9 },
    { h: '分类汇总', k: 'categorySummary', w: 36 },
    { h: '当月非油销售额', k: 'monthSales', w: 16 },
    { h: '临期商品金额', k: 'nearExpireAmount', w: 14 },
    { h: '是否有过期产品', k: 'hasExpired', w: 14 },
    { h: '过期商品金额', k: 'expiredAmount', w: 14 },
    { h: '临期+过期占比', k: 'ratio', w: 15 },
    { h: '1%红线', k: 'redline', w: 11 },
    { h: '分类说明', k: 'nearExpireProducts', w: 30 },
    { h: '明细附表图片', k: 'detailImages', img: true, w: 26 },
    { h: '申请日期', k: 'applyDate', w: 13 },
    { h: '处理方式', k: 'applyType', w: 14 },
    { h: '申请事由', k: 'applyReason', w: 30 },
    { h: '申请截图', k: 'applyImages', img: true, w: 26 },
    { h: 'OA单号', k: 'oaNo', w: 18 },
    { h: '审批人/科室', k: 'approver', w: 16 },
    { h: '审批日期', k: 'approveDate', w: 13 },
    { h: '审批结果', k: 'approveResult', w: 13 },
    { h: '审批截图', k: 'approveImages', img: true, w: 26 },
    { h: '让利幅度', k: 'discountRate', w: 11 },
    { h: '调价日期', k: 'repriceDate', w: 13 },
    { h: '毛利损伤(元)', k: 'grossDamage', w: 13 },
    { h: '调价截图', k: 'repriceImages', img: true, w: 26 },
    { h: '促销销售数量', k: 'soldQty', w: 13 },
    { h: '促销销售金额', k: 'soldAmount', w: 14 },
    { h: '销售截止日期', k: 'saleEndDate', w: 14 },
    { h: '销售情况截图', k: 'saleImages', img: true, w: 26 },
    { h: '销单日期', k: 'closeDate', w: 13 },
    { h: '销单说明', k: 'closeNote', w: 28 },
    { h: '销单截图', k: 'closeImages', img: true, w: 26 }
  ];

  const IMG_W = 168, IMG_H = 84, EMU = 9525;

  function rowData(order) {
    const cats = order.categories || [];
    const sub = U.calcCategories(cats);
    const near = parseFloat(order.nearExpireAmount) || sub.amount;
    const ratio = U.calcRatios({
      monthSales: { value: order.monthSales },
      expiredAmount: { value: order.expiredAmount }
    }, near);
    const categorySummary = cats.filter(c => String(c.name || '').trim())
      .map(c => `${c.name} ${c.qty || 0}件/${U.money(c.amount)}元`).join('；');
    return Object.assign({}, order, {
      categoryCount: sub.rows,
      categorySummary,
      nearExpireAmount: U.money(near),
      ratio: U.pct(ratio.ratio),
      redline: ratio.over ? '超1%' : '正常',
      discountRate: order.discountRate ? order.discountRate + '%' : ''
    });
  }

  function styleHeader(row) {
    row.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 10 };
    row.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF12335E' } };
    row.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
    row.height = 34;
  }

  async function exportExcel(orders) {
    if (!orders.length) { U.toast('没有可导出的单据', true); return; }
    const wb = new ExcelJS.Workbook();
    wb.creator = '临期商品一单一销台账';
    wb.created = new Date();
    const ws = wb.addWorksheet('一单一销台账', {
      views: [{ state: 'frozen', ySplit: 1, xSplit: 2 }]
    });

    COLS.forEach(c => ws.getColumn(c.k).width = c.w);
    const header = ws.addRow(COLS.map(c => c.h));
    styleHeader(header);
    ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: COLS.length } };

    for (const order of orders) {
      const data = rowData(order);
      const row = ws.addRow(COLS.map(c => {
        if (c.img) {
          const imgs = order[c.k] || [];
          return imgs.length ? `${imgs.length} 张（图片已嵌入下方）` : '';
        }
        const v = data[c.k];
        return v === undefined || v === null ? '' : v;
      }));
      row.alignment = { vertical: 'top', wrapText: true };
      row.font = { size: 10 };

      // 超 1% 红线标红
      if (data.redline === '超1%') {
        const idx = COLS.findIndex(c => c.k === 'redline') + 1;
        row.getCell(idx).font = { bold: true, color: { argb: 'FFC00000' }, size: 10 };
        row.getCell(idx).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFDE9E9' } };
      }
      if (order.status === '已销单') {
        const idx = COLS.findIndex(c => c.k === 'status') + 1;
        row.getCell(idx).font = { bold: true, color: { argb: 'FF1F8A5B' }, size: 10 };
      }

      // 计算图片行数并设定行高
      let maxImgs = 0;
      COLS.forEach(c => { if (c.img) maxImgs = Math.max(maxImgs, (order[c.k] || []).length); });
      const rowsNeeded = Math.max(1, Math.ceil(maxImgs));
      row.height = Math.max(66, rowsNeeded * (IMG_H * 0.78) + 12);

      // 嵌入图片（纵向排列，保证每张可见）
      COLS.forEach((c, colIndex) => {
        if (!c.img) return;
        const imgs = order[c.k] || [];
        imgs.forEach((im, i) => {
          try {
            const imageId = wb.addImage({ base64: im.data, extension: 'jpeg' });
            ws.addImage(imageId, {
              tl: { col: colIndex, row: row.number - 1, colOff: 4 * EMU, rowOff: Math.round(i * (IMG_H + 6)) * EMU },
              ext: { width: IMG_W, height: IMG_H }
            });
          } catch (e) { console.warn('图片嵌入失败', c.k, i, e); }
        });
      });
    }

    // 说明页
    const ws2 = wb.addWorksheet('填报说明');
    ws2.getColumn(1).width = 34;
    ws2.getColumn(2).width = 70;
    const notes = [
      ['临期商品一单一销台账', ''],
      ['制度依据', '《加油站非油业务管理办法》（202411版）陕高速延长发〔2024〕91号'],
      ['第十七条(一)', '达临期2个工作日内联系供应商退换并登记台账；降价促销报计划经营科审批后执行'],
      ['第十七条(三)', '管理原因过期按售价赔偿，站长75%、非油主管25%'],
      ['第十八条(二)', '每月报《商品报损申请表》，经审批后报财务科处理'],
      ['第二十六条(二)', '未在保质期前三月报告导致临期/过期超销售额1%，站长约谈并扣当月50%非油提成'],
      ['临期界定 一年以上', '剩余 45～30 天'],
      ['临期界定 半年以上不足一年', '剩余 30～20 天'],
      ['临期界定 30天以上不足半年', '剩余 20～7 天'],
      ['临期界定 不足30天', '剩余 5～1 天'],
      ['填报口径', '一单一批；分类汇总只填品类/件数/金额，逐商品明细以「明细附表图片」为准'],
      ['导出说明', '每行一单；七组佐证图片直接嵌在对应列，单元格文本显示张数'],
      ['数据说明', '数据保存在本机浏览器 IndexedDB，请定期使用「备份 JSON」留存']
    ];
    notes.forEach((n, i) => {
      const r = ws2.addRow(n);
      if (i === 0) { r.font = { bold: true, size: 14, color: { argb: 'FF12335E' } }; }
      else { r.font = { size: 10 }; r.alignment = { wrapText: true, vertical: 'top' }; r.getCell(1).font = { bold: true, size: 10 }; }
    });

    const buf = await wb.xlsx.writeBuffer();
    const stamp = U.today();
    U.download(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }),
      `临期商品一单一销台账_${stamp}.xlsx`);
    U.toast('Excel 主台账已导出');
  }

  global.LQExportExcel = { exportExcel, COLS };
})(window);
