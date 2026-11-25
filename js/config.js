/* ==========================================================================
 * 临期台账 · 前端配置
 *
 * 油站填报页：index.html
 * 公司导出页：admin.html
 *
 * ★ report.url 必须填「腾讯云函数 URL」，不是金山 AirScript 地址。
 *   空着时页面会提示「未配置云函数地址」，不会本地存数据。
 * ★ report.token 保持留空。AirScript-Token 只放云函数环境变量 KDOCS_TOKEN。
 * ★ companyCode 只是防误用的简单口令，不是高安全鉴权；公司端可自行改。
 * ========================================================================== */
(function (global) {
  'use strict';

  global.LQ_CFG = {
    report: {
      url: 'https://1320695126-l6lngmmgot.ap-guangzhou.tencentscf.com', // 腾讯云函数 URL
      token: ''     // 保持留空
    },
    kdocs: {
      url: 'https://www.kdocs.cn/l/ciKNcgUxkVQx',
      fileId: 'rd788mWerrMPskJMJMoFrxX9sgVTBVwCF'
    },
    companyCode: '888888',
    maxPayloadMB: 8,
    photoSlotsPerGroup: 3
  };
})(window);
