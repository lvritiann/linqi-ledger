/* Word 存档导出：每单一页，图片随段插入 */
(function (global) {
  'use strict';
  const U = global.LQUtils;
  const D = global.docx;

  function P(text, opt) {
    return new D.Paragraph(Object.assign({ text: String(text == null ? '' : text) }, opt || {}));
  }
  function Heading(text, level) {
    return new D.Paragraph({ text: String(text), heading: level === 2 ? D.HeadingLevel.HEADING_2 : D.HeadingLevel.HEADING_1,
      spacing: { before: 160, after: 100 } });
  }
  function kvTable(pairs) {
    const rows = pairs.map(p => new D.TableRow({
      children: [
        new D.TableCell({ width: { size: 32, type: D.WidthType.PERCENTAGE },
          children: [new D.Paragraph({ children: [new D.TextRun({ text: String(p[0]), bold: true })] })] }),
        new D.TableCell({ width: { size: 68, type: D.WidthType.PERCENTAGE },
          children: [new D.Paragraph({ text: String(p[1] == null ? '' : p[1]) })] })
      ]
    }));
    return new D.Table({ rows, width: { size: 100, type: D.WidthType.PERCENTAGE } });
  }
  function imageParagraphs(imgs, title) {
    const out = [new D.Paragraph({
      spacing: { before: 100, after: 60 },
      children: [new D.TextRun({ text: `${title}（${(imgs || []).length} 张）`, bold: true, size: 20 })]
    })];
    (imgs || []).forEach(im => {
      try {
        const bytes = U.dataURLtoBytes(im.data);
        out.push(new D.Paragraph({
          children: [new D.ImageRun({ data: bytes, transformation: { width: 420, height: 260 }, type: 'jpeg' })],
          spacing: { after: 80 }
        }));
      } catch (e) { out.push(P('（图片插入失败：' + (im.name || '') + '）')); }
    });
    if (!imgs || !imgs.length) out.push(P('（未上传）'));
    return out;
  }

  function catTable(cats) {
    const rows = (cats || []).filter(c => String(c.name || '').trim()).map(c => new D.TableRow({
      children: [
        new D.TableCell({ children: [new D.Paragraph({ text: String(c.name || '') })] }),
        new D.TableCell({ children: [new D.Paragraph({ text: String(c.qty || '') })] }),
        new D.TableCell({ children: [new D.Paragraph({ text: U.money(c.amount) })] })
      ]
    }));
    return new D.Table({
      rows: [new D.TableRow({
        children: ['品类', '数量(件)', '金额(元)'].map(t => new D.TableCell({
          children: [new D.Paragraph({ children: [new D.TextRun({ text: t, bold: true })] })]
        }))
      })].concat(rows),
      width: { size: 100, type: D.WidthType.PERCENTAGE }
    });
  }

  function orderChildren(order) {
    const cats = order.categories || [];
    const sub = U.calcCategories(cats);
    const near = parseFloat(order.nearExpireAmount) || sub.amount;
    const ratio = U.calcRatios({
      monthSales: { value: order.monthSales }, expiredAmount: { value: order.expiredAmount }
    }, near);

    const c = [];
    c.push(new D.Paragraph({
      text: '临期商品一单一销台账', alignment: D.AlignmentType.CENTER,
      spacing: { after: 120 },
      children: [new D.TextRun({ text: '临期商品一单一销台账', bold: true, size: 30 })]
    }));
    c.push(new D.Paragraph({
      text: `单号：${order.id || ''}    油站：${order.station || ''}    月份：${order.month || ''}    状态：${order.status || ''}`,
      alignment: D.AlignmentType.CENTER, spacing: { after: 160 }
    }));

    c.push(Heading('一、批次信息', 2));
    c.push(kvTable([
      ['批次号', order.batchNo], ['盘点日期', order.checkDate], ['批次商品总数(件)', order.batchTotal],
      ['品类数', sub.rows], ['填报人', order.handler]
    ]));

    c.push(Heading('二、分类汇总', 2));
    c.push(catTable(cats));
    c.push(new D.Paragraph({ spacing: { before: 80 }, children: [new D.TextRun({
      text: `合计：${sub.qty} 件 / ${U.money(sub.amount)} 元`, bold: true, size: 20 })] }));
    c.push(new D.Paragraph({ spacing: { before: 60 }, children: [new D.TextRun({
      text: '单品明细详见下方附表图片', italics: true, size: 20 })] }));
    c.push(...imageParagraphs(order.detailImages, '明细附表图片'));

    c.push(Heading('三、申请与审批', 2));
    c.push(kvTable([
      ['当月非油销售额', order.monthSales], ['临期商品金额', U.money(near)],
      ['是否有过期产品', order.hasExpired], ['过期商品金额', order.expiredAmount],
      ['临期+过期占比', U.pct(ratio.ratio)], ['1% 红线', ratio.over ? '超1%（风险）' : '正常'],
      ['分类说明', order.nearExpireProducts], ['申请日期', order.applyDate],
      ['处理方式', order.applyType], ['申请事由', order.applyReason],
      ['OA 单号', order.oaNo], ['审批人/科室', order.approver],
      ['审批日期', order.approveDate], ['审批结果', order.approveResult]
    ]));
    c.push(...imageParagraphs(order.applyImages, '申请截图'));
    c.push(...imageParagraphs(order.approveImages, '审批截图'));

    c.push(Heading('四、调价与销售', 2));
    c.push(kvTable([
      ['让利幅度', order.discountRate ? order.discountRate + '%' : ''],
      ['调价日期', order.repriceDate], ['对毛利的损伤(元)', order.grossDamage],
      ['促销销售数量', order.soldQty], ['促销销售金额', order.soldAmount], ['销售截止日期', order.saleEndDate]
    ]));
    c.push(...imageParagraphs(order.repriceImages, '调价截图'));
    c.push(...imageParagraphs(order.saleImages, '销售情况截图'));

    c.push(Heading('五、销单与留痕', 2));
    c.push(kvTable([
      ['销单日期', order.closeDate], ['单据状态', order.status], ['销单说明', order.closeNote]
    ]));
    c.push(...imageParagraphs(order.closeImages, '销单截图'));

    c.push(new D.Paragraph({ spacing: { before: 240 },
      children: [new D.TextRun({ text: '填报人：____________    站长：____________    计划经营科：____________    日期：____________', size: 20 })] }));
    return c;
  }

  async function exportWord(orders, note) {
    if (!orders || !orders.length) { U.toast('没有可导出的单据', true); return; }
    const children = [];
    orders.forEach((o, i) => {
      if (i > 0) children.push(new D.Paragraph({ children: [new D.PageBreak()] }));
      children.push(...orderChildren(o));
    });
    const doc = new D.Document({
      creator: '临期商品一单一销台账',
      sections: [{ properties: { page: { margin: { top: 900, right: 900, bottom: 900, left: 900 } } }, children }]
    });
    const blob = await D.Packer.toBlob(doc);
    const stamp = U.today();
    const suffix = note === 'current' ? orders[0].id.replace(/[^\w\u4e00-\u9fa5-]/g, '_') : `全部${orders.length}单`;
    U.download(blob, `临期商品一单一销存档_${suffix}_${stamp}.docx`);
    U.toast(`Word 存档已导出（${orders.length} 单）`);
  }

  global.LQExportWord = { exportWord };
})(window);
