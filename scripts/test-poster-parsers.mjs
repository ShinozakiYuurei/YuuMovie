import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  parseChinachemPosters,
  parseLumenPoster,
  parseNewportPoster,
  parseSunbeamPoster,
} from '../scrapers/other-circuits.js';
import { normalizeTitle, stripEnglishTitleNoise, stripFormats } from '../lib/versions.ts';

test('Chinachem carousel poster maps titles and accepts either attribute order', () => {
  const html = `
    <div class="slide"><h4 data-id="a">Resident Evil</h4><img src="/posters/re.jpg" class="poster"></div>
    <div class="slide"><img class="poster" src='https://cdn.example/v.jpg'><h4>V</h4></div>
    <div class="slide"><h4>Placeholder</h4><img src="/images/poster-spacer.png"></div>`;
  const posters = parseChinachemPosters(html, 'https://www.cel-cinemas.com');
  assert.equal(posters.get('residentevil'), 'https://www.cel-cinemas.com/posters/re.jpg');
  assert.equal(posters.get('v'), 'https://cdn.example/v.jpg');
  assert.equal(posters.has('placeholder'), false);
});

test('Lumen constructs the poster graphic URL from its film ID', () => {
  assert.equal(
    parseLumenPoster('', 'f-F000001407'),
    'https://www.lumencinema.com.hk/CDN/media/entity/get/FilmPosterGraphic/f-F000001407?width=800&height=1200&referenceScheme=Global&allowPlaceHolder=true',
  );
  assert.equal(parseLumenPoster('', ''), null);
});

test('Newport finds its poster when src precedes class and resolves relative paths', () => {
  assert.equal(
    parseNewportPoster(`<div><img src="/images/poster.jpg" alt="film" class="movieImageImg"></div>`),
    'https://www.theatre.com.hk/images/poster.jpg',
  );
  assert.equal(
    parseNewportPoster(`<img class='movieImageImg' data-src='/lazy.jpg'>`),
    'https://www.theatre.com.hk/lazy.jpg',
  );
});

test('Sunbeam resolves event coverUrl relative to its CDN', () => {
  assert.equal(
    parseSunbeamPoster(`eventNameTc:"影片",coverUrl:"whampoa/covers/a.jpg",censorshipImageUrl:null`),
    'https://cdn.sunbeamwhampoa.com/whampoa/covers/a.jpg',
  );
  assert.equal(
    parseSunbeamPoster(`coverUrl:"https://images.example/poster.jpg"`),
    'https://images.example/poster.jpg',
  );
  assert.equal(parseSunbeamPoster('coverUrl:null'), null);
});

test('known screening suffixes normalize without damaging a one-letter title', () => {
  const variants = [
    'Forgotten Island',
    'Forgotten Island(preview)',
    'Forgotten Island (CHI)',
    'Forgotten Island(Chi)SP',
  ];
  assert.equal(new Set(variants.map(normalizeTitle)).size, 1);
  assert.equal(normalizeTitle('Oh My Ghost! Oh My God!(SP)'), normalizeTitle('Oh My Ghost! Oh My God!'));
  assert.equal(normalizeTitle('V (Meet & Greet)'), normalizeTitle('V'));
  assert.equal(stripFormats('V (Meet & Greet)'), 'V');
  assert.equal(stripEnglishTitleNoise('Forgotten Island(Chi)SP'), 'Forgotten Island');
  assert.equal(normalizeTitle('怎麼可能我家的祖先是你家的鬼(優先)'), normalizeTitle('怎麼可能我家的祖先是你家的鬼'));
});
