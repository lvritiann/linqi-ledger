'use strict';
/**
 * 本地自测：模拟 SCF event 调 main_handler，mock 掉 https.request，
 * 不访问金山，只断言转发出去的 body 是否按 AirScript 协议包了 Context.argv。
 *
 * 用法：node tools/relay/_test_wrap.js
 * 说明：KDOCS_URL 指向 example.invalid，KDOCS_TOKEN 为占位符，无任何真实凭据。
 */
const assert = require('assert');
const https = require('https');
const { EventEmitter } = require('events');

process.env.KDOCS_URL = 'https://example.invalid/api/v3/ide/file/FAKE/script/FAKE/sync_task';
process.env.KDOCS_TOKEN = 'PLACEHOLDER_TOKEN_NOT_REAL';
process.env.ASYNC_POLL_SEC = '3';

const captured = [];
let mode = 'async';   // 'async' = /task 正常给 task_id；'sync' = 不给 task_id 触发兜底

/* ---- mock 金山 HTTP，记录每一次 POST 的原始 body ---- */
https.request = function (opts, cb) {
  const req = new EventEmitter();
  req.setTimeout = function () { };
  req.end = function (buf) {
    if (buf) captured.push({ method: opts.method, path: opts.path, body: buf.toString('utf8') });
    setImmediate(() => {
      const res = new EventEmitter();
      res.statusCode = 200;
      cb(res);
      let payload;
      if (opts.path.indexOf('/api/v3/script/task') >= 0 || opts.path.indexOf('/sync_task') >= 0) {
        payload = {
          status: 'finished', error: '',
          data: { result: JSON.stringify({ ok: true, records: [], logs: [] }), logs: [] }
        };
      } else if (mode === 'sync') {
        payload = {};                       // 没有 task_id → 走 /sync_task 兜底
      } else {
        payload = { task_id: 'mock-task-1' };
      }
      const text = JSON.stringify(payload);
      setImmediate(() => { res.emit('data', Buffer.from(text)); res.emit('end'); });
    });
  };
  return req;
};

const relay = require('./index.js');

function pass(label, detail) {
  console.log('  PASS  ' + label + (detail === undefined ? '' : '  → ' + detail));
}
function argvOf(text) {
  const j = JSON.parse(text);
  assert(j && j.Context && j.Context.argv && typeof j.Context.argv === 'object',
    '缺少 Context.argv 层：' + text);
  assert.strictEqual(Object.prototype.hasOwnProperty.call(j, 'action'), false,
    '业务字段不应留在请求体顶层：' + text);
  return j.Context.argv;
}
function ctx() { return { time_limit_in_ms: 120000 }; }
function evt(body, isBase64) {
  return {
    httpMethod: 'POST',
    headers: { origin: 'https://example.invalid' },
    body: body,
    isBase64Encoded: !!isBase64
  };
}

async function run() {
  console.log('== 1. 纯函数 toAirScriptBody ==');
  let a = argvOf(relay._toAirScriptBody('{"action":"list"}'));
  assert.deepStrictEqual(a, { action: 'list' });
  pass('list 裸包 → Context.argv.action=list', JSON.stringify(a));

  a = argvOf(relay._toAirScriptBody('{"action":"submit","payload":{"id":"X1","station":"测试站"}}'));
  assert.strictEqual(a.action, 'submit');
  assert.strictEqual(a.payload.id, 'X1');
  pass('submit 裸包 → Context.argv.payload.id=X1', JSON.stringify(a));

  const already = '{"Context":{"argv":{"action":"list"}}}';
  assert.strictEqual(relay._toAirScriptBody(already), already, '已包 body 应幂等');
  pass('已包 body 幂等透传，不重复套层', already);

  a = argvOf(relay._toAirScriptBody('{}'));
  assert.deepStrictEqual(a, {});
  pass('空 body → Context.argv={}', JSON.stringify(a));

  console.log('== 2. 异步路径：main_handler({"action":"list"}) ==');
  mode = 'async'; captured.length = 0;
  const resA = await relay.main_handler(evt(JSON.stringify({ action: 'list' })), ctx());
  const postA = captured.filter(c => c.method === 'POST' && /\/task$/.test(c.path));
  assert.strictEqual(postA.length, 1, '应恰好一次 POST /task，实际 ' + postA.length);
  const argvA = argvOf(postA[0].body);
  assert.strictEqual(argvA.action, 'list');
  pass('POST /task 转发 body 已包 Context.argv', postA[0].body);
  assert.strictEqual(resA.statusCode, 200);
  const innerA = JSON.parse(JSON.parse(resA.body).data.result);
  assert.deepStrictEqual(innerA, { ok: true, records: [], logs: [] });
  pass('返回信封 data.result = {ok:true,records:[],logs:[]}', resA.body);

  console.log('== 3. 同步兜底路径：/task 无 task_id ==');
  mode = 'sync'; captured.length = 0;
  const resB = await relay.main_handler(evt(JSON.stringify({ action: 'list' })), ctx());
  const postB = captured.filter(c => c.method === 'POST' && /\/sync_task$/.test(c.path));
  assert.strictEqual(postB.length, 1, '应恰好一次 POST /sync_task，实际 ' + postB.length);
  assert.strictEqual(argvOf(postB[0].body).action, 'list');
  pass('POST /sync_task 转发 body 已包 Context.argv', postB[0].body);
  assert.strictEqual(resB.statusCode, 200);

  console.log('== 4. base64 body：先解码再包装 ==');
  mode = 'sync'; captured.length = 0;
  const raw = JSON.stringify({ action: 'submit', payload: { id: 'X1', station: '测试站' } });
  const b64 = Buffer.from(raw, 'utf8').toString('base64');
  await relay.main_handler(evt(b64, true), ctx());
  const postC = captured.filter(c => c.method === 'POST' && /\/sync_task$/.test(c.path));
  assert.strictEqual(postC.length, 1, '应恰好一次 POST /sync_task，实际 ' + postC.length);
  const argvC = argvOf(postC[0].body);
  assert.strictEqual(argvC.action, 'submit');
  assert.strictEqual(argvC.payload.id, 'X1');
  pass('base64 解码后仍需包 Context.argv', postC[0].body);

  console.log('\n全部断言通过（4 组 / 12 项）。');
}

run().catch(e => { console.error('自测失败：', e && e.stack || e); process.exitCode = 1; });
