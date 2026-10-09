// Generates the reference output for the Chinachem parser from the real
// captured page, using the ORIGINAL Node implementation. The Go port must
// reproduce these values exactly — that is the point of keeping this file.
import fs from 'node:fs';
import { parseChinachemPosters } from '../scrapers/other-circuits.js';

const html = fs.readFileSync(new URL('./chinachem-home.html', import.meta.url), 'utf8');
const base = 'https://www.cel-cinemas.com';

// --- posters ---
const posters = parseChinachemPosters(html, base);
const posterEntries = [...posters.entries()].sort((a, b) => a[0].localeCompare(b[0]));
console.log('POSTERS count=' + posters.size);
for (const [k, v] of posterEntries.slice(0, 8)) console.log('  ' + k + ' => ' + v);

// --- date tabs ---
const text = (v) => String(v || '').replace(/<[^>]*>/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;|&#160;/g, ' ').replace(/\s+/g, ' ').trim();
const year = Number(new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Hong_Kong', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date()).slice(0, 4));
const MONTHS = new Map(['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'].map((m, i) => [m.toLowerCase(), i + 1]));
const tabs = [];
for (const [, day, label] of html.matchAll(/<a[^>]*href="#day-(\d+)"[^>]*>([\s\S]*?)<\/a>/gi)) {
  const parsed = text(label).match(/([A-Za-z]{3})\s*(\d{1,2})/);
  if (!parsed) continue;
  const month = MONTHS.get(parsed[1].toLowerCase());
  if (month) tabs.push([day, String(year) + '-' + String(month).padStart(2, '0') + '-' + String(parsed[2]).padStart(2, '0')]);
}
console.log('TABS count=' + tabs.length);
for (const [d, v] of tabs.slice(0, 6)) console.log('  day-' + d + ' => ' + v);

// --- day sections + movies + shows ---
function blocksByClass(html, className, tag = 'div') {
  const opening = new RegExp('<' + tag + '\\b(?=[^>]*class="[^"]*\\b' + className + '\\b[^"]*")[^>]*>', 'gi');
  const token = new RegExp('<\\/?' + tag + '\\b[^>]*>', 'gi');
  const blocks = [];
  for (const match of html.matchAll(opening)) {
    token.lastIndex = match.index + match[0].length;
    let depth = 1, end = token.lastIndex, item;
    while ((item = token.exec(html))) {
      if (item[0].startsWith('</')) depth--;
      else if (!item[0].endsWith('/>')) depth++;
      if (depth === 0) { end = token.lastIndex; break; }
    }
    if (depth === 0) blocks.push(html.slice(match.index, end));
  }
  return blocks;
}
function firstText(html, tag, className) {
  const pattern = new RegExp('<' + tag + '\\b(?=[^>]*class="[^"]*\\b' + className + '\\b[^"]*")[^>]*>([\\s\\S]*?)</' + tag + '>', 'i');
  return text(html.match(pattern)?.[1] || '');
}
function attr(tag, name) {
  const match = tag.match(new RegExp('\\b' + name + '\\s*=\\s*(?:"([^"]*)"|\'([^\']*)\')', 'i'));
  return String(match?.[1] ?? match?.[2] ?? '');
}
const daySections = [...html.matchAll(/<div id="day-(\d+)"[^>]*class="time-wrap"[^>]*>/gi)];
console.log('DAYSECTIONS count=' + daySections.length);
const tabMap = new Map(tabs);
let movieCount = 0, showCount = 0;
const showSamples = [];
for (let i = 0; i < daySections.length; i++) {
  const section = daySections[i];
  const end = daySections[i + 1]?.index ?? html.length;
  const date = tabMap.get(section[1]);
  if (!date) continue;
  for (const movieBlock of blocksByClass(html.slice(section.index, end), 'each-movie-wrap')) {
    const title = text(movieBlock.match(/<h4[^>]*>([\s\S]*?)<\/h4>/i)?.[1] || '');
    if (!title) continue;
    movieCount++;
    for (const sessionGroup of blocksByClass(movieBlock, 'session-type')) {
      const typeText = text(sessionGroup.match(/<p[^>]*>([\s\S]*?)<\/p>/i)?.[1] || '');
      for (const [, anchor] of sessionGroup.matchAll(/(<a\b[^>]*class="[^"]*\bsession\b[^"]*"[^>]*>[\s\S]*?<\/a>)/gi)) {
        const opening = anchor.match(/^<a\b[^>]*>/i)?.[0] || '';
        const bookingUrl = new URL(attr(opening, 'href'), base).href;
        const id = bookingUrl.split('/').pop();
        showCount++;
        if (showSamples.length < 5) {
          showSamples.push({ id, title, date, typeText, house: firstText(anchor, 'p', 'schedule_housename'), time: firstText(anchor, 'p', 'time'), price: firstText(anchor, 'p', 'price'), bookingUrl });
        }
      }
    }
  }
}
console.log('MOVIES count=' + movieCount + ' SHOWS count=' + showCount);
for (const s of showSamples) console.log('  ' + JSON.stringify(s));