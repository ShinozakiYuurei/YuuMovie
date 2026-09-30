import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  getAllPaymentMethods,
  getVerifiedPaymentSources,
  isPaymentVerified,
  paymentMethodsOf,
  PAYMENT_LABEL,
  type PaymentMethod,
} from '../lib/cinema-payments';
import { getCinemaFacets, getCinemaRows } from '../lib/data';

test('Sun Beam Whampoa uses only the methods explicitly listed in its website terms', () => {
  const info = paymentMethodsOf('sunbeam-1', 'sunbeam');
  assert.equal(info.verified, true);
  assert.equal(isPaymentVerified('sunbeam'), true);
  assert.deepEqual(info.methods, ['visa', 'mastercard', 'paypal', 'alipay', 'wechat_pay']);
  assert.equal(info.source, 'https://www.sunbeamwhampoa.com/');
  assert.match(info.note, /新光黃埔影藝城/);
  assert.match(info.note, /官網網購/);
  assert.match(info.note, /不代表 App、票房或其他新光場地/);
  assert.ok(!info.methods.includes('alipayhk'));
  assert.ok(!info.methods.includes('apple_pay'));
  assert.ok(!info.methods.includes('google_pay'));
});

test('PayPal has a display label and is included exactly once in verified filters', () => {
  assert.equal(PAYMENT_LABEL.paypal, 'PayPal');
  const methods = getAllPaymentMethods();
  assert.equal(methods.filter(method => method === 'paypal').length, 1);
  for (const method of methods) assert.ok(PAYMENT_LABEL[method]);
  assert.deepEqual(
    getVerifiedPaymentSources().filter(info => info.methods.includes('paypal')).map(info => info.source),
    ['sunbeam'],
  );
});

test('User-attested official web payment pages are recorded for the four researched operators', () => {
  const expected: Record<string, PaymentMethod[]> = {
    emperor: ['visa', 'mastercard', 'unionpay', 'american_express', 'alipayhk', 'wechat_pay_hk', 'apple_pay'],
    cinemacity: ['visa', 'mastercard', 'unionpay', 'jcb', 'alipay', 'alipayhk', 'octopus'],
    goldenscene: ['visa', 'mastercard', 'payme'],
    lumen: ['visa', 'mastercard', 'unionpay', 'alipayhk', 'alipay', 'wechat_pay'],
  };
  const sources = new Set(getVerifiedPaymentSources().map(info => info.source));
  const allMethods = getAllPaymentMethods();
  for (const [source, methods] of Object.entries(expected)) {
    const info = paymentMethodsOf(`${source}-1`, source);
    assert.equal(info.verified, true, source);
    assert.equal(isPaymentVerified(source), true, source);
    assert.deepEqual(info.methods, methods, source);
    assert.ok(sources.has(source), source);
    for (const method of methods) {
      assert.ok(allMethods.includes(method), `${source} ${method} should be available as a filter option`);
      assert.ok(PAYMENT_LABEL[method], `${method} should have a readable filter label`);
    }
    assert.match(info.note, /用戶提供並確認/);
    assert.match(info.note, /電腦及手機網頁購票/);
    assert.match(info.note, /不外推至 App、票房(?:、|或)自助機/);
  }
  assert.equal(PAYMENT_LABEL.jcb, 'JCB');
  assert.equal(PAYMENT_LABEL.alipay, '支付寶');
  assert.equal(PAYMENT_LABEL.alipayhk, 'AlipayHK');
  assert.equal(PAYMENT_LABEL.octopus, '八達通');
  assert.equal(PAYMENT_LABEL.payme, 'PayMe');
  assert.equal(PAYMENT_LABEL.wechat_pay, '微信支付');
  assert.equal(PAYMENT_LABEL.wechat_pay_hk, 'WeChat Pay HK');
});

test('Hong Kong Emperor payment evidence is not extrapolated to the Macau cinema', () => {
  const hk = paymentMethodsOf('emperor-57006', 'emperor');
  const macau = paymentMethodsOf('emperor-57011', 'emperor');
  assert.equal(hk.verified, true);
  assert.deepEqual(hk.methods, ['visa', 'mastercard', 'unionpay', 'american_express', 'alipayhk', 'wechat_pay_hk', 'apple_pay']);
  assert.equal(macau.verified, false);
  assert.equal(isPaymentVerified('emperor', 'emperor-57011'), false);
  assert.deepEqual(macau.methods, []);
  assert.equal(macau.source, null);
  assert.match(macau.note, /未確認澳門戲院/);
});

/*
 * 戲院列表頁的支付方式篩選（2026-09-30 新增）
 *
 * 為什麼要釘死：篩選器算錯了頁面照樣 200、照樣好看 ——
 * 只是用戶勾「八達通」時，清單裡會**多出**一間根本不知道收不收八達通的戲院
 * （等於憑空發明資料），或**少掉**一間明明收的。
 * 兩種都不會報錯，只有對照院線政策表才看得出來。
 *
 * 規則：只收已確認（verified）院線的方式；未確認的院線不得混進任何選項的計數。
 */
test('Cinema list filter offers exactly the confirmed payment methods, counted per cinema', () => {
  const rows = getCinemaRows();
  const facets = getCinemaFacets(rows);

  // 1. 選項集合 = 已確認院線方式的並集（不多不少）
  const expected = new Set<string>();
  for (const r of rows) {
    if (!r.paymentsVerified) continue;
    for (const m of r.payments) expected.add(m);
  }
  assert.deepEqual(
    [...new Set(facets.payments.map((o) => o.value))].sort(),
    [...expected].sort(),
  );

  // 2. 每個選項的計數 = 已確認且支持該方式的戲院數
  for (const o of facets.payments) {
    assert.equal(
      o.count,
      rows.filter((r) => r.paymentsVerified && r.payments.includes(o.value as PaymentMethod)).length,
      `${o.value} 的篩選計數應等於已確認且支持該方式的戲院數`,
    );
    assert.equal(o.label, PAYMENT_LABEL[o.value as PaymentMethod], `${o.value} 應有可讀標籤`);
  }

  // 3. 未確認院線不得被算進任何選項（否則等於宣稱它們支持）
  const unverified = rows.filter((r) => !r.paymentsVerified);
  assert.ok(unverified.length > 0, '本專案應仍有未確認院線，否則本測試失去意義');
  const unverifiedIds = new Set(unverified.map((r) => r.id));
  for (const o of facets.payments) {
    const counted = rows.filter(
      (r) => r.paymentsVerified && r.payments.includes(o.value as PaymentMethod) && unverifiedIds.has(r.id),
    );
    assert.deepEqual(counted, [], `未確認院線不得計入 ${o.value}`);
  }

  // 4. 排序：支持的戲院數由多到少（與場次頁一致）
  const counts = facets.payments.map((o) => o.count);
  assert.deepEqual(counts, [...counts].sort((a, b) => b - a));
});

test('Unknown operators do not inherit confirmed methods', () => {
  const info = paymentMethodsOf('unknown-cinema', 'unknown-source');
  assert.equal(info.verified, false);
  assert.deepEqual(info.methods, []);
  assert.equal(info.source, null);
  assert.equal(isPaymentVerified('unknown-source'), false);
});
