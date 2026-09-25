/**
 * 新增戲院的顯示地址正規化。
 *
 * 地址以院線官方分店頁/API 為準；來源只提供英文時翻譯為繁體中文，
 * 官方沒有列明的樓層不額外推定。只用於顯示，不參與 region.ts 的地區推斷。
 */
export const CINEMA_DISPLAY_ADDRESS: Record<string, string> = {
  'chinachem-plnym': '新界屯門河傍街康麗花園',
  'cineart-16': '九龍灣宏照道38號企業廣場5期MegaBox 11樓',
  'cineart-17': '新界青衣青衣城2期3樓326號',
  'cineart-19': '九龍鑽石山龍蟠街3號荷里活廣場3樓402號舖',
  'cineart-23': '新界馬鞍山鞍祿街18號新港城中心2樓',
  'goldenscene-1': '香港堅尼地城吉席街2號',
  'lumen-1001': '新界葵涌打磚坪街1-25號寶星廣場地下',
  'newport-hyland': '新界屯門鄉事會路136號',
};
