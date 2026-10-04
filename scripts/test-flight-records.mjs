import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildRecordMap, langField } from '../scrapers/broadway.js';

test('Flight records resolve a decimal row id', () => {
  const rsc = '"description_lang":"$37"\n37:T83e,{"en":"Hello","zh_hk":"你好"}';
  const records = buildRecordMap(rsc);
  assert.deepEqual(langField(records, '$37'), { en: 'Hello', zh_hk: '你好' });
});

test('Flight records resolve a hex row id (CineArt uses $3a)', () => {
  const rsc = '"description":"$3a"\n3a:T12,{"zh_hk":"中文簡介"}';
  const records = buildRecordMap(rsc);
  assert.deepEqual(langField(records, '$3a'), { zh_hk: '中文簡介' });
});

test('a timestamp is never mistaken for a row id', () => {
  assert.equal(buildRecordMap('"createTime":"2026-01-28T03:11:08.542Z"').size, 0);
  assert.equal(buildRecordMap('x37:T1,{"zh_hk":"不該命中"}').size, 0);
});

test('an unresolvable reference yields no language object', () => {
  const records = buildRecordMap('');
  assert.deepEqual(langField(records, '$3a'), {});
  assert.deepEqual(langField(records, '$999'), {});
});

test('inline objects, JSON strings and plain strings still pass through', () => {
  const records = buildRecordMap('');
  assert.deepEqual(langField(records, { zh_hk: '中文' }), { zh_hk: '中文' });
  assert.deepEqual(langField(records, '{"zh_hk":"內層"}'), { zh_hk: '內層' });
  assert.deepEqual(langField(records, 'Love Is Not A Game'), {});
});
