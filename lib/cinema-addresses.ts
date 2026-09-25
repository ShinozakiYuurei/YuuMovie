/**
 * 新增戲院的顯示地址正規化。
 *
 * 地址以本機保存的 HK Movie 6 戲院清單（probe/hk6-cinema.html）逐筆按
 * 戲院名稱與地址核對；只用於顯示，不參與 region.ts 的地區推斷。
 * 主要把來源站只提供英文或縮寫的地址補成繁體中文完整地址。
 */
export const CINEMA_DISPLAY_ADDRESS: Record<string, string> = {
  'chinachem-plnym': '新界屯門河傍街康麗花園地下',
  'cineart-16': '九龍灣宏照道38號企業廣場5期MegaBox 11樓',
  'cineart-17': '新界青衣青衣城2期3樓326號',
  'cineart-18': '香港銅鑼灣百德新街22-36號翡翠明珠廣場3樓',
  'cineart-19': '九龍鑽石山龍蟠街3號荷里活廣場3樓402號舖',
  'cineart-23': '新界馬鞍山鞍祿街18號新港城中心2樓',
  'goldenscene-1': '香港堅尼地城吉席街2號',
  'lumen-1001': '新界葵涌打磚坪街1-25號',
  'newport-hyland': '新界屯門鄉事會路136號',
};
