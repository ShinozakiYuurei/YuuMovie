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

test('Unknown operators do not inherit confirmed methods', () => {
  const info = paymentMethodsOf('unknown-cinema', 'unknown-source');
  assert.equal(info.verified, false);
  assert.deepEqual(info.methods, []);
  assert.equal(info.source, null);
  assert.equal(isPaymentVerified('unknown-source'), false);
});
