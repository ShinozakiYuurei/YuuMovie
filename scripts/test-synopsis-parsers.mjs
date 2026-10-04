import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  filmsNeedingSynopsis,
  matchIndex,
  parseKinohkIndex,
  parseKinohkSynopsis,
  parseWmoovIndex,
  parseWmoovNames,
  parseWmoovSynopsis,
  stripHtml,
  usableSynopsis,
} from '../scrapers/synopsis.js';
import { synopsisKey } from '../lib/synopsis-key.js';

const WMOOV_INDEX = `
  <ul>
    <li><h3><a href="/movie/details/72369" title="社交清算電影資料、預告、戲院">社交清算</a></h3></li>
    <li><h3><a href="/movie/details/67513" title="復仇者聯盟5：末日降臨電影資料">復仇者聯盟5：末日降臨</a></h3></li>
  </ul>`;

const WMOOV_DETAIL = `
  <dl class="movie_info">
    <dt>名稱:</dt><dd>復仇者聯盟5：末日降臨 (Avengers: Doomsday)</dd>
    <dt>片種:</dt><dd>動作,英雄</dd>
  </dl>
  <article><p id="description" class="movie-desc" itemprop="description">多元宇宙的邊界開始崩解，來自不同世界的英雄被迫走上同一條命運軌道。</p></article>`;

const KINOHK_INDEX = `
  <li><a href="/movie/復仇者聯盟5末日降臨-早鳥" class="group flex">
    <h3 class="text-[15px]"> 復仇者聯盟5：末日降臨 (早鳥) <span>（復仇者聯盟5）</span> </h3>
    <p class="truncate">Avengers: Doomsday</p>
  </a></li>`;

const KINOHK_DETAIL = `
  <div><p class="text-sm">三個唔同宇宙嘅人氣英雄被迫走上致命碰撞之路，面對前所未見嘅存亡威脅。</p>
  <p class="mt-1 text-[11px]">簡介由本站整理</p></div>`;

test('wmoov index maps a normalised title to its detail id', () => {
  const index = parseWmoovIndex(WMOOV_INDEX);
  assert.deepEqual(index.get(synopsisKey('復仇者聯盟5：末日降臨')), [
    { id: '67513', title: '復仇者聯盟5：末日降臨' },
  ]);
  assert.equal(index.has(synopsisKey('社交清算')), true);
});

test('wmoov sidebar links carry the title in the title attribute, not the inner text', () => {
  const sidebar = `
    <ul class="nav-movie">
      <li><a class="level_IIA" href="/movie/details/73145" title="我阿爹想旅行">我阿爹想旅行</a></li>
      <li><a class="level_IIB" href="/movie/details/73655" title="偵戰電影資料、預告、戲院"></a></li>
    </ul>`;
  const index = parseWmoovIndex(sidebar);
  assert.deepEqual(index.get(synopsisKey('我阿爹想旅行')), [{ id: '73145', title: '我阿爹想旅行' }]);
  assert.deepEqual(index.get(synopsisKey('偵戰')), [{ id: '73655', title: '偵戰' }], '固定尾巴必须剥掉');
});

test('a wrapped title such as 《社交清算》 still matches the plain site title', () => {
  assert.equal(synopsisKey('《社交清算》'), synopsisKey('社交清算'));
  assert.equal(synopsisKey('《空槍》'), synopsisKey('空槍'));
  assert.notEqual(synopsisKey('空槍'), synopsisKey('空手道'));
});
test('wmoov detail gives both the synopsis and the names used to verify it', () => {
  assert.deepEqual(parseWmoovNames(WMOOV_DETAIL), { zh: '復仇者聯盟5：末日降臨', en: 'Avengers: Doomsday' });
  assert.equal(
    parseWmoovSynopsis(WMOOV_DETAIL),
    '多元宇宙的邊界開始崩解，來自不同世界的英雄被迫走上同一條命運軌道。',
  );
});

test('kinohk index keeps the slug and drops the alias span from the title', () => {
  const index = parseKinohkIndex(KINOHK_INDEX);
  assert.deepEqual(index.get(synopsisKey('復仇者聯盟5：末日降臨')), [
    { slug: '/movie/復仇者聯盟5末日降臨-早鳥', title: '復仇者聯盟5：末日降臨 (早鳥)', en: 'Avengers: Doomsday' },
  ]);
});

test('kinohk synopsis is the paragraph before the site credit, not the credit itself', () => {
  assert.equal(
    parseKinohkSynopsis(KINOHK_DETAIL),
    '三個唔同宇宙嘅人氣英雄被迫走上致命碰撞之路，面對前所未見嘅存亡威脅。',
  );
  assert.equal(parseKinohkSynopsis('<p>沒有出處標註</p>'), '');
});

test('matchIndex falls back to a prefix match only when the pick is unambiguous', () => {
  const index = new Map([
    [synopsisKey('復仇者聯盟5：末日降臨'), [{ id: '67513' }]],
  ]);
  assert.deepEqual(matchIndex(index, synopsisKey('復仇者聯盟5：末日降臨')), [{ id: '67513' }]);
  assert.deepEqual(matchIndex(index, synopsisKey('復仇者聯盟5：末日降臨 開畫日特典首場')), [{ id: '67513' }]);
  assert.deepEqual(matchIndex(index, synopsisKey('完全不相關的片名')), []);
  const tie = new Map([
    [synopsisKey('甲片 特典場'), [{ id: 'a' }]],
    [synopsisKey('甲片 優先場'), [{ id: 'b' }]],
  ]);
  assert.deepEqual(matchIndex(tie, synopsisKey('甲片')), [], '两个等长的候选必须放弃');
});

test('filmsNeedingSynopsis only reports films whose every entry lacks text', () => {
  const needs = filmsNeedingSynopsis([
    { nameZh: '甲片', nameEn: 'A', description: '' },
    { nameZh: '甲片 (IMAX)', nameEn: 'A', description: '' },
    { nameZh: '乙片', nameEn: 'B', description: '院線文案' },
  ]);
  assert.deepEqual(needs.map((r) => r.nameZh), ['甲片']);
});

test('usableSynopsis rejects placeholders and one-liners', () => {
  assert.equal(usableSynopsis('--'), '');
  assert.equal(usableSynopsis(''), '');
  assert.equal(usableSynopsis('Introduction :'), '');
  assert.equal(usableSynopsis('太短'), '');
  assert.equal(usableSynopsis('這是一段夠長的中文簡介，用來確認門檻判斷正確。'), '這是一段夠長的中文簡介，用來確認門檻判斷正確。');
  assert.equal(stripHtml('<p>a &amp; b</p>'), 'a & b');
});
