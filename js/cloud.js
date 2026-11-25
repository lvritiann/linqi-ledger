/* 云端直写：网页 → 腾讯云函数 → 金山 AirScript → 在线表格
 * 本文件只做三件事：提交、查询、把返回值拆成统一形状。网页不落盘。 */
(function (global) {
  'use strict';

  const CFG = global.LQ_CFG || {};

  function jsonBytes(obj) {
    try { return new TextEncoder().encode(JSON.stringify(obj)).length; }
    catch (e) { return JSON.stringify(obj).length; }
  }

  function unwrap(text) {
    let env;
    try { env = JSON.parse(text); }
    catch (e) { throw new Error('云函数返回的不是 JSON：' + String(text).slice(0, 160)); }

    /* 云函数异步轮询完成后，形状与 sync_task 一致：{data:{result:"<JSON串>"}} */
    let raw = null;
    if (env && env.data && env.data.result !== undefined) raw = env.data.result;
    else if (env && env.result !== undefined) raw = env.result;
    else raw = env;

    if (typeof raw === 'string') {
      try { raw = JSON.parse(raw); }
      catch (e) { return { ok: false, error: '脚本返回不是 JSON：' + raw.slice(0, 200) }; }
    }
    if (!raw || typeof raw !== 'object') return { ok: false, error: '脚本返回为空' };
    return raw;
  }

  async function call(body) {
    const url = CFG.report && String(CFG.report.url || '').trim();
    if (!url) throw new Error('未配置云函数地址：请在 js/config.js 填写 report.url');

    const payload = JSON.stringify(body);
    const sizeMB = jsonBytes(body) / 1024 / 1024;
    const cap = Number(CFG.maxPayloadMB || 8);
    if (sizeMB > cap) {
      throw new Error('本次提交 ' + sizeMB.toFixed(1) + 'MB，超过 ' + cap +
        'MB 上限。请减少每组图片张数，或把多张截图合并成一张长图。');
    }

    const headers = { 'Content-Type': 'application/json' };
    if (CFG.report.token) headers['AirScript-Token'] = CFG.report.token;

    let resp;
    try {
      resp = await fetch(url, { method: 'POST', headers: headers, body: payload });
    } catch (e) {
      throw new Error('连不上云函数：' + (e && e.message ? e.message : e));
    }

    const text = await resp.text();
    if (!resp.ok) {
      throw new Error('云函数返回 HTTP ' + resp.status + '：' + String(text).slice(0, 200));
    }
    return unwrap(text);
  }

  global.LQCloud = {
    async submit(order, actionType) {
      return call({
        action: 'submit',
        actionType: actionType || '提交',
        payload: order
      });
    },
    async list() {
      return call({ action: 'list' });
    }
  };
})(window);
