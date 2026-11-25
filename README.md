# 临期商品一单一销台账（云端直写版）

把《加油站非油业务管理办法》（陕高速延长发〔2024〕91号）第十七、十八、二十六条要求的临期处置过程，做成「填报即落表、提交即留痕」的在线闭环。

## 一、当前架构（2026-11-25 定稿）

```text
油站电脑网页 index.html
  → 腾讯云函数 SCF：linqi-relay
  → 金山 AirScript：linqi_write.js
  → 金山在线表格「临期商品一单一销台账（在线）」
       ├─ sheetId=1 一单一销台账（一行一单，图片嵌单元格）
       ├─ sheetId=2 提交日志（每次提交追加一行，永不覆盖）
       └─ sheetId=3 填报说明
公司电脑网页 admin.html
  → 同一个云函数 action=list
  → 统一导出 / 打印 / 另存 PDF
```

**网页不存数据**：油站端没有 IndexedDB、没有备份/恢复 JSON、没有导出按钮；刷新页面即清空重填。所有业务数据和图片都经云函数写入金山在线表格。

## 二、在线资源

| 资源 | 地址 / ID |
|---|---|
| 油站填报页 | https://lvritiann.github.io/linqi-ledger/ |
| 公司导出页 | https://lvritiann.github.io/linqi-ledger/admin.html |
| GitHub 仓库 | https://github.com/lvritiann/linqi-ledger |
| 金山在线台账 | https://www.kdocs.cn/l/ciKNcgUxkVQx |
| file_id | `rd788mWerrMPskJMJMoFrxX9sgVTBVwCF` |
| drive_id | `261748242` |
| sheetId 1 | 一单一销台账 |
| sheetId 2 | 提交日志 |
| sheetId 3 | 填报说明 |

## 三、目录结构

```text
index.html                  油站填报端（云端直写）
admin.html                  公司导出端（口令进入，只读云端）
css/style.css               样式 + 打印版式
js/config.js                云函数 URL / 金山链接 / 公司口令
js/cloud.js                 提交与查询封装
js/app.js                   油站端主控制器
js/admin.js                 公司端主控制器
js/utils.js                 临期计算、比例、单号
js/images.js                图片上传、压缩、粘贴
tools/airscript/linqi_write.js   AirScript 落表脚本（贴进金山）
tools/relay/index.js             腾讯云函数源码
tools/scf/linqi-relay.zip        腾讯云函数部署包
vendor/exceljs.min.js            Excel 导出库（公司端）
vendor/docx.umd.js               Word 库（保留兼容，油站端不再加载）
TROUBLESHOOTING.md              自助排错手册
```

## 四、一次性部署（照做即可）

### 1. 金山 AirScript

1. 打开金山在线台账 → 效率 → 高级开发 → AirScript。
2. 新建 JS 脚本，把 `tools/airscript/linqi_write.js` 全文贴进去，保存。
3. 回到脚本详情页，复制 webhook 地址，形状类似：
   `https://www.kdocs.cn/api/v3/ide/file/{fileId}/script/{scriptId}/sync_task`
4. 复制该脚本的 `AirScript-Token`。

### 2. 腾讯云函数 SCF

1. 控制台 → 云函数 SCF → 新建 → 从头开始，函数名 `linqi-relay`，运行环境 Node.js 24。
2. 上传 `tools/scf/linqi-relay.zip`（zip 根目录必须是 `index.js`）。
3. 执行超时时间设为 **120 秒**。
4. 环境变量：

   | 变量 | 值 |
   |---|---|
   | `KDOCS_URL` | 第 1 步复制的 AirScript `sync_task` 地址 |
   | `KDOCS_TOKEN` | 第 1 步复制的 AirScript-Token |
   | `ALLOW_ORIGIN` | `*` |
   | `TIMEOUT_SEC` | `20` |
   | `ASYNC_POLL_SEC` | `0`（自动按函数剩余时间轮询） |

5. 左侧「函数 URL」→ 新建函数 URL → 别名 `$LATEST`、公网访问开启、授权类型「开放」、CORS 关闭。
6. 复制函数 URL，形状类似 `https://xxxxxxxx-xxxxxxxx.ap-guangzhou.tencentscf.com`。
7. **不要建 API 网关触发器**：API 网关产品已停止新建，函数 URL 是当前唯一可用入口。

### 3. 前端配置

编辑 `js/config.js`：

```js
report: {
  url: 'https://你刚复制的腾讯云函数URL',
  token: ''   // 必须留空，AirScript-Token 只在云函数环境变量里
},
companyCode: '你给公司的口令'
```

推送到 GitHub 后，Pages 会自动更新。验证地址：`函数URL` 直接浏览器打开，应返回 `service: linqi-scf-relay` 的健康检查 JSON。

## 五、油站填报流程

1. 打开 https://lvritiann.github.io/linqi-ledger/
2. 单号自动生成（LQ-年月-油站-序号）；也可手工改。
3. 第 1 步：填油站/月份、批次信息；按品类填分类汇总；上传明细附表图片。
4. 第 2 步：填销售额、过期金额、申请与审批信息，上传申请/审批截图。
5. 第 3 步：填让利幅度、毛利损伤、销售情况，上传调价/销售截图。
6. 第 4 步：填销单与审计信息，上传销单/审计截图，自检全绿后点「确认销单并提交」。
7. 中途需要保存进度，点「提交到在线台账」，状态可先填草稿/待审批。
8. 提交成功后在「提交记录」页核对；也可点「打开在线台账」直接看金山表格。

**填错了怎么办**：用同一个单号重新提交。台账该行会被覆盖，但提交日志不删，旧记录仍可追溯。

## 六、图片规则

- 七组佐证图片：明细附表、申请、审批、调价、销售、销单、审计。
- 每组最多 3 张落表：第 1 张落原表图片列，第 2/3 张落自动补出的扩展列；多余的请先合并成长图。
- 上传后自动压缩：最长边 1400px、JPEG 0.82；单次提交总体积上限 8MB。
- 支持点击选择、拖拽、Ctrl+V 粘贴截图。

## 七、公司导出与打印

1. 打开 https://lvritiann.github.io/linqi-ledger/admin.html
2. 输入公司端口令（默认 `888888`，部署时请改）。
3. 可按油站/月份筛选，查看台账和提交日志。
4. 三个出口：
   - **直接打印 / 另存 PDF**：打印本页，含全部提交记录和时间留痕。
   - **导出 Excel（公司打印版）**：台账打印版 + 提交日志 + 打印说明三个 sheet。
   - **打开在线台账**：到金山表格打印含单元格原图的版本。

说明：Excel 打印版为文字+日志版；如需打印佐证图片原件，请在金山在线表格内直接打印，图片已嵌在单元格里。

## 八、制度口径（页面「填报说明」内置）

- 第十七条(一)：达临期 2 个工作日内联系供应商退换；降价促销报计划经营科审批后执行。
- 第十七条(三)/十八条(三)：管理原因过期按售价赔偿，站长 75%、非油主管 25%。
- 第十八条(二)：每月报《商品报损申请表》，审批后报财务科。
- 第二十六条(二)：未在保质期前 3 个月报告导致临期/过期超销售额 1%，站长约谈并扣当月 50% 非油提成。
- 临期界定表 1：一年以上 45~30 天；半年以上不足一年 30~20 天；30 天以上不足半年 20~7 天；不足 30 天 5~1 天。

## 九、常见问题

见同目录 `TROUBLESHOOTING.md`。
