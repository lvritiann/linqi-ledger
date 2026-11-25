/* 通用工具：临期判定、比例计算、单号、提示 */
(function (global) {
  'use strict';

  const U = {
    $: (sel, root) => (root || document).querySelector(sel),
    $$: (sel, root) => Array.from((root || document).querySelectorAll(sel)),

    today() {
      const d = new Date();
      const p = n => String(n).padStart(2, '0');
      return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
    },

    num(v) { const n = parseFloat(v); return isNaN(n) ? 0 : n; },
    money(n) { return Number(n || 0).toFixed(2); },
    pct(n) { return (Number(n || 0) * 100).toFixed(2) + '%'; },

    // 单号 LQ-YYYYMM-油站-序号
    makeId(station, month, allIds) {
      const m = (month || U.today().slice(0, 7)).replace('-', '');
      const st = String(station || '未填').replace(/[^\u4e00-\u9fa5A-Za-z0-9]/g, '').slice(0, 6) || '未填';
      const prefix = `LQ-${m}-${st}-`;
      let max = 0;
      (allIds || []).forEach(id => {
        if (String(id).startsWith(prefix)) {
          const tail = parseInt(String(id).slice(prefix.length), 10);
          if (!isNaN(tail) && tail > max) max = tail;
        }
      });
      return prefix + String(max + 1).padStart(3, '0');
    },

    // 依据制度表1：按保质期总天数返回临期区间 [下限,上限]（剩余天数）
    nearExpiryWindow(shelfLifeDays) {
      const d = Number(shelfLifeDays) || 0;
      if (d > 365) return { lo: 30, hi: 45, label: '45～30 天（一年以上）' };
      if (d > 183) return { lo: 20, hi: 30, label: '30～20 天（半年以上不足一年）' };
      if (d > 30) return { lo: 7, hi: 20, label: '20～7 天（30天以上不足半年）' };
      if (d > 0) return { lo: 1, hi: 5, label: '5～1 天（不足30天）' };
      return null;
    },

    calcShelf(form) {
      const produce = form.produceDate.value;
      const life = U.num(form.shelfLifeDays.value);
      const explicit = form.expiryDate.value;
      const base = form.checkDate.value || U.today();
      let expiry = explicit;
      if (!expiry && produce && life > 0) {
        const d = new Date(produce + 'T00:00:00');
        d.setDate(d.getDate() + life);
        expiry = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      }
      let remain = null;
      if (expiry) {
        remain = Math.round((new Date(expiry + 'T00:00:00') - new Date(base + 'T00:00:00')) / 86400000);
      }
      const win = U.nearExpiryWindow(life);
      let verdict = '无法判定', cls = '';
      if (remain !== null && win) {
        if (remain < 0) { verdict = '已过期'; cls = 'expired'; }
        else if (remain <= win.hi) { verdict = '临期'; cls = 'near'; }
        else { verdict = '正常'; cls = 'normal'; }
      } else if (remain !== null && !win) {
        if (remain < 0) { verdict = '已过期'; cls = 'expired'; }
      }
      return { expiry, remain, window: win ? win.label : '—', verdict, cls };
    },

    // 分类合计：分类行数、总件数、总金额
    calcCategories(cats) {
      let qty = 0, amount = 0, rows = 0;
      (cats || []).forEach(c => {
        if (!c || !String(c.name || '').trim()) return;
        rows++;
        qty += U.num(c.qty);
        amount += U.num(c.amount);
      });
      return { rows, qty, amount };
    },

    calcRatios(form, catAmount) {
      const monthSales = U.num(form.monthSales.value);
      const near = catAmount !== undefined ? catAmount : 0;
      const expired = U.num(form.expiredAmount.value);
      const ratio = monthSales > 0 ? (near + expired) / monthSales : 0;
      return { monthSales, near, expired, ratio, over: ratio > 0.01 };
    },

    calcPrice(form, catAmount) {
      const rate = U.num(form.discountRate.value) / 100;
      const declared = U.num(form.grossDamage.value);
      const near = catAmount !== undefined ? catAmount : 0;
      const estimated = near * rate;
      return { rate, declared, near, estimated, damage: declared || estimated };
    },

    toast(msg, err) {
      const el = U.$('#toast');
      el.textContent = msg;
      el.className = 'toast show' + (err ? ' err' : '');
      clearTimeout(el._t);
      el._t = setTimeout(() => { el.className = 'toast'; }, 2600);
    },

    lightbox(src) {
      const box = document.createElement('div');
      box.className = 'lightbox';
      const img = document.createElement('img');
      img.src = src;
      box.appendChild(img);
      box.addEventListener('click', () => box.remove());
      document.body.appendChild(box);
    },

    escapeHtml(s) {
      return String(s == null ? '' : s).replace(/[&<>"']/g, c =>
        ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    },

    dataURLtoBytes(dataURL) {
      const parts = String(dataURL).split(',');
      const b64 = parts[1] || parts[0];
      const bin = atob(b64);
      const arr = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
      return arr;
    },

    extOf(dataURL) {
      const m = String(dataURL).match(/^data:image\/([a-zA-Z0-9]+);/);
      const t = m ? m[1].toLowerCase() : 'png';
      return t === 'jpeg' ? 'jpg' : t;
    },

    download(blob, filename) {
      const a = document.createElement('a');
      const url = URL.createObjectURL(blob);
      a.href = url; a.download = filename;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 3000);
    }
  };

  global.LQUtils = U;
})(window);
