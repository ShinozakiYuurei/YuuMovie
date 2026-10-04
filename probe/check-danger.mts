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
  ['Oh My Ghost ! Oh My God!', 'Oh My Ghost! Oh My God!(SP)'],
  ['怎麼可能我家的祖先是你家的鬼', '怎麽可能我家的祖先是你家的鬼(優先)'],
  ['CHIIKAWA the Movie: The Secret of the Mermaid Island', 'CHIIKAWA the Movie: The Secret of the Mermaid Isla'],
  ['復仇者聯盟5：末日降臨', '開畫日特典首場 SCREENX - 復仇者聯盟5: 末日降臨 Infinity Vision'],
  ['復仇者聯盟5：末日降臨', '(IV) (開畫日特典首場) 復仇者聯盟5：末日降臨'],
  ['復仇者聯盟5：末日降臨', '(IV) (早鳥場) 復仇者聯盟5：末日降臨'],
  ['復仇者聯盟5：末日降臨', '復仇者聯盟5 末日降臨 早鳥'],
  // 括号内定冠词：主办方名称两家写法差一个 the，不归一会把同一部片拆成两组
  // （2026-10-04 线上：《柴可夫斯基 尤金.奧涅金》MCL 一组、英皇一组，
  //   其中 MCL 那组没有简介 → 用户看到「一部片两个组，一个没简介」）
  ['柴可夫斯基《尤金．奧涅金》 (MET 2026)', '柴可夫斯基《尤金．奧涅金》 (The Met 2026)'],
  ['華格納《崔斯坦與伊索德》(The Met 2026)', '華格納《崔斯坦與伊索德》 (Met 2026)'],
  // 场次修饰词前缀不得吃掉片名尾巴：百老匯把「開畫日特典首場」直接缀在片名后、
  // 中间没有分隔符，旧写法会连「末日降臨」一起剥掉，详情页标题只剩「復仇者聯盟5」。
  ['復仇者聯盟5：末日降臨', '復仇者聯盟5：末日降臨開畫日特典首場'],
  ['復仇者聯盟5：末日降臨', '復仇者聯盟5：末日降臨開畫日特典首場 (全景聲)'],
];
let bad = 0;
for (const [a, b] of mustNot) if (normalizeTitle(a) === normalizeTitle(b)) { console.log('✗ 误并:', a, '/', b); bad++; }
for (const [a, b] of must) if (normalizeTitle(a) !== normalizeTitle(b)) { console.log('✗ 漏并:', a, '=>', JSON.stringify(normalizeTitle(a)), '/', b, '=>', JSON.stringify(normalizeTitle(b))); bad++; }

// 片名本体里的定冠词不能被剥掉：只有**括号内紧跟左括号**的 the 才是主办方名称的冠词，
// 「The Sea」「Giant – The Play」的 the 属于片名。
for (const name of ['The Sea (HKJFF 2026)', 'Giant – The Play (2026)', 'The Shoshani Riddle (HKJFF2026)']) {
  if (!normalizeTitle(name).includes('the')) {
    console.log('✗ 误剥片名本体冠词:', name, '=>', JSON.stringify(normalizeTitle(name)));
    bad++;
  }
}
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
