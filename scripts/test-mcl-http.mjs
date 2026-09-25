import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';
import { getJson, getJsonWithRetry } from '../scrapers/mcl.js';

function mockHttps({ onRequest }) {
  let calls = 0;
  return {
    get(url, options, callback) {
      const request = new EventEmitter();
      request.destroy = (error) => {
        if (error) queueMicrotask(() => request.emit('error', error));
        return request;
      };
      onRequest({ url, options, callback, request, call: ++calls });
      return request;
    },
    get calls() { return calls; },
  };
}

function respond(callback, body = '[{"ok":true}]') {
  const response = new EventEmitter();
  response.statusCode = 200;
  response.setEncoding = () => {};
  callback(response);
  queueMicrotask(() => {
    response.emit('data', body);
    response.emit('end');
  });
}

test('getJson parses a successful response and applies timeout options', async () => {
  let captured;
  const httpsModule = mockHttps({ onRequest: ({ options, callback }) => {
    captured = options;
    respond(callback);
  } });
  assert.deepEqual(await getJson('sample.json', { timeoutMs: 250, httpsModule }), [{ ok: true }]);
  assert.equal(captured.timeout, 250);
});

test('getJson enforces a total timeout before a response arrives', async () => {
  const httpsModule = mockHttps({ onRequest: () => {} });
  await assert.rejects(getJson('slow.json', { timeoutMs: 25, httpsModule }), /slow\.json.*超时/);
});

test('getJsonWithRetry retries a transient request failure', async () => {
  const httpsModule = mockHttps({ onRequest: ({ callback, request, call }) => {
    if (call === 1) queueMicrotask(() => request.emit('error', new Error('temporary socket failure')));
    else respond(callback, '[{"retried":true}]');
  } });
  const result = await getJsonWithRetry('retry.json', {
    attempts: 2,
    retryDelayMs: 1,
    httpsModule,
  });
  assert.deepEqual(result, [{ retried: true }]);
  assert.equal(httpsModule.calls, 2);
});
