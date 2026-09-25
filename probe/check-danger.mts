import { getMovieGroups, getShowingGroups, getUpcomingGroups } from '../lib/data.ts';
import { normalizeTitle } from '../lib/versions.ts';
// 危险对：绝不能合并
const mustNot = [
  ['生化危機', '生化壽屍'], ['新世紀福音戰士新劇場版：序', '新世紀福音戰士新劇場版：破'],
  ['新世紀福音戰士新劇場版：Q', '新世紀福音戰士新劇場版：終'], ['復仇者聯盟4：終局之戰', '復仇者聯盟5：末日降臨'],
  ['蜘蛛俠：英雄重生', '蜘蛛俠：不戰無歸'], ['天鵝湖 (The Royal Ballet 2026 – 2027)', '天鵝湖 (Paris Opera Ballet 2026 - 2027)'],
  ['特別放映日記', '日記'], ['日記特別放映', '日記'], ['30周年修復版日記', '日記'],
  ['情書', '情書未寄出的一封信'],
];
// 必须合并
const must = [
  ['奧德賽', '35mm 菲林版 奧德賽'], ['愛的綠洲', '愛的綠洲（35mm菲林版）'],
  ['我阿爹想旅行', '《我阿爹想旅行》中秋特典場'], ['奇愛博士 (NT Live 2026-27)', '奇愛博士 (NT Live)'],
  ['劇場版 CHIIKAWA 人魚島的秘密 (日語版)', '劇場版 CHIIKAWA 人魚島的秘密 (日)'],
  ['復仇者聯盟4：終局之戰 加碼重映', '(IV) 復仇者聯盟4：終局之戰 加碼重映'],
  ['蜘蛛俠：英雄重生', '蜘蛛俠: 英雄重生 (2D版)'], ['廚師發辦', '《廚師發辦》心跳回憶特典場'],
  ['以你的名字呼喚我', '以你的名字呼喚我 (特別放映)'],
  ['情書', '《情書》30周年修復版 (「相約在The One」特別放映)'],
  ['復仇者聯盟5：末日降臨', '開畫日特典首場 SCREENX - 復仇者聯盟5: 末日降臨 Infinity Vision'],
  ['復仇者聯盟5：末日降臨', '(IV) (開畫日特典首場) 復仇者聯盟5：末日降臨'],
  ['復仇者聯盟5：末日降臨', '(IV) (早鳥場) 復仇者聯盟5：末日降臨'],
];
let bad = 0;
for (const [a, b] of mustNot) if (normalizeTitle(a) === normalizeTitle(b)) { console.log('✗ 误并:', a, '/', b); bad++; }
for (const [a, b] of must) if (normalizeTitle(a) !== normalizeTitle(b)) { console.log('✗ 漏并:', a, '=>', JSON.stringify(normalizeTitle(a)), '/', b, '=>', JSON.stringify(normalizeTitle(b))); bad++; }
const showing = getShowingGroups();
const upcoming = getUpcomingGroups();
const movieGroups = getMovieGroups();
const avengers5 = (groups: typeof movieGroups) =>
  groups.filter((group) => normalizeTitle(group.displayName).includes('復仇者聯盟5'));
const avengers5All = avengers5(movieGroups);
if (avengers5All.length > 1) {
  console.log('✗ 復仇者聯盟5仍被拆成多個電影組:', avengers5All.map((group) => group.displayName));
  bad++;
}
if (avengers5(showing).length && avengers5(upcoming).length) {
  console.log('✗ 復仇者聯盟5同時出現在上映與待映列表');
  bad++;
}
console.log(bad === 0 ? '✓ 规则及电影分组检查全部通过' : `${bad} 项检查不通过`);
const g = [...showing, ...upcoming];
console.log('组数:', g.length, '| showing 卡片:', showing.length, '| upcoming:', upcoming.length);
if (bad > 0) process.exitCode = 1;
