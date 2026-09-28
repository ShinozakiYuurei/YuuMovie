# 官網網購支付方式續查 — 2026-09-27

## 採納標準

只採院方官網或官方 App 開發者直接公開列明的網上購票方式。API 欄位、SDK、付款按鈕、商標或指定銀行優惠不構成一般支付政策。區分電腦網站、手機網站、App、票房及自助售票機。沒有直接清單的院線維持 `verified: false`、空 `methods`。

## 新增確認：新光黃埔影藝城

- 官網：<https://www.sunbeamwhampoa.com/>
- 實際 rendered 頁面標題：`新光黃埔影藝城 | SunBeam Whampoa`
- 位置：場次 → 本地選位 →「立即購票」→《購票條款及細則》第 1 點。
- 原文：**「只支援Visa/MasterCard、PayPal、支付寶、微信支付購票。」**
- 採納：`visa`, `mastercard`, `paypal`, `alipay`, `wechat_pay`。
- 範圍：僅該官網的網上購票，以及本專案目前唯一的 `sunbeam` 戲院（新光黃埔）。不推廣至其他新光場地、App、票房或自助售票機。
- 「支付寶」未細分地區版本，沒有另確認 `alipayhk`。
- JS bundle 只用來找到公開條款；採納依據是官網實際可讀的條款文字，不是程式配置或 SDK。

證據：

- `probe/payment-sunbeam-terms-live.json`：URL、標題、全文、選位後請求記錄、關閉結果。
- `probe/sunbeam-public-terms-live.png`：實際條款彈窗。
- `probe/payment-sunbeam-terms-readonly.cjs`：重現步驟，禁止院方站點所有非 GET／HEAD／OPTIONS 請求。

安全界線：

- 院方站點的本次網絡記錄只有兩次 GET，選位後沒有請求，沒有被攔截的寫入請求。
- 選位是本地 React 狀態；未觸發占座、建單或付款請求。
- 點「返回」已關閉條款。未點「同意條款並繼續購票」、未輸入聯絡資料、未操作驗證挑戰。
- 每次探查均關閉獨立 browser context；本地選位未提交。

## 仍待確認

### 英皇

- FAQ：<https://www.emperorcinemas.com/stationary/faq?wapid=ECML_WEB_PROD_S_MPS>
- 官方條款：<https://www.emperorcinemas.com/stationary/terms?wapid=ECML_WEB_PROD_S_MPS>
- 本次由首頁點「常見問題」成功載入，再逐頁讀完四頁 FAQ 及一般條款。
- FAQ 有「於英皇戲院網站或手機App使用信用卡購票安全嗎？」及 SSL 答覆，但未列品牌或一般支付清單。
- Visa Signature 是指定優惠。Apple ID 是登入方式，不等於 Apple Pay。
- 保存：`probe/payment-emperor-faq-live.json`。

### Cinema City

- 官方購票守則：<https://cdn.icirena.ai/zh_TW/agreement/default/用户协议-ciciV5.htm>
- 第 22–24 條只談 CC 錢包代幣、代幣不足不能用現金或信用卡補差額及不可退款。
- 官網連結的 App Store：<https://apps.apple.com/hk/app/cinema-city-quick-ticket/id6677028063>
- 官網連結的 Google Play：<https://play.google.com/store/apps/details?id=com.cinema.ticket.android2cc>
- 兩個開發者說明僅介紹查場次、購票及掃碼取票，沒有支付清單。
- 保存：`probe/payment-appstore-public.json`。

### 高先

- 官網會員頁：<https://goldenscene.com/membership>
- 官方連結的《會籍 FAQ》及《會員條款及守則》是已發布 Google Docs 文件，已實際讀取。
- 文件介紹會籍、積分、贈券及 HKMovie App；没有一般網購支付清單。現金續會不能當成網購戲票方式。
- 官網非會員購票會開啟 `ticket.hkmovie6.com/gsc/.../none/seat`；本次只讀該選座入口，沒有選位。第三方售票頁不等同院方一般付款政策。
- 保存：`probe/payment-gs-faq-live.json`。

### Lumen

- 官網：<https://www.lumencinema.com.hk/Browsing/>
- 一般條款：<https://www.lumencinema.com.hk/Browsing/General/TermsAndConditions>
- 本次另讀票價及聯絡頁，未取得方式清單。
- 保存：`probe/payment-public-lumen-sunbeam.json`、`probe/payment-public-more.json`。
- 本次沒有重跑選座／確認訂單流程。前序 Lumen 取消脚本的結果未保存在可核實日誌中，不能據此聲稱取消成功；也不為核查舊狀態另建一張訂單。

## 第二輪：續查四家付款入口及官方 App（2026-09-27）

本輪沒有新增可錄入的支付方式，四家仍為空 `methods`、`verified: false`，不進入已確認篩選。更新的是核查備註，而不是以技術線索填補清單。

### 英皇

- 已找到並讀取官方 iOS App：<https://apps.apple.com/hk/app/emperor-cinemas/id1294743651>，HTTP 200，開發者 Emperor Group，供應商 EIML。
- 香港區中文 Google Play 搜尋及實際詳情頁確認 Android App 為 `com.emperor.cinemas`：<https://play.google.com/store/apps/details?id=com.emperor.cinemas&hl=zh_HK&gl=HK>，HTTP 200，開發者 Emperor Group，支援網站連回英皇官網；英文說明亦已讀取。
- 中英文介紹只有 UI、CINEMER、印花、會員折扣及 PopCoin，沒有支付清單。已目視檢查 iOS 5 張及 Android 中文 5 張／英文 5 張開發者截圖，均沒有直接付款方式文字。
- iOS 評論的 Apple Pay、Android 評論的 PayMe 不作院方證據。同名 Empire Cinemas 並非英皇，不混用。
- 無訂單參數、全新上下文的公開 `/payment` 探測在請求阻斷下跳到 `/err`，只有錯誤文字，不是成功讀取付款頁；未加入虛構訂單或重放交易 API。`/app` 是返回原生 App 的路由，不是付款說明。
- App 開發者連結的私隱政策已讀取，只說交易／信用卡／電子銀行資料處理及 SSL，不是一般香港網購品牌清單。
- 詳細報告：`probe/emperor-payment-round2-conclusion.md`。主要正文及圖片來源：`emperor-payment-round2-store.json`、`emperor-payment-round2-android.json`、`emperor-payment-round2-android-assets.json`；路由限制記錄：`emperor-payment-round2-routes.json`。

### Cinema City

- 重核官方 iOS／Android 開發者說明，並下載目視檢查全部 4 張 iOS、5 張 Android 宣傳圖；沒有支付清單或付款選擇器。
- App Store 開發者連結的英文守則：<https://cdn.icirena.ai/en/agreement/default/用户协议-cici.htm>，第 23 條同樣只限制 CC Wallet 不足時不可補差額。中文 V5 與英文條款數量不同，不據此推斷一般付款品牌。
- 官網「用戶協議」只打開公開「政策&協議」選擇窗口；沒有接受購票條款。Google Play 的開發者私隱鏈接本次正文為空，不視為付款證據。
- 報告：`probe/cc-payment-round2-findings.md`；正文：`cc-payment-round2-public.json`、`cc-payment-round2-footer.json`；圖片來源：`cc-payment-round2-screenshot-manifest.json`。

### 高先

- 補讀 `/cinema`、`/aboutUs` 及已載入的最新消息第 1–3 頁，沒有一般支付清單。後兩頁只見導航及頁尾，不能稱為讀到付款政策。
- Google 搜索被異常流量頁阻擋；Bing／Google Play 沒有提供可核實的高先支付線索。外地 Golden Screen Cinemas／Golden Screen Cinemas Sdn Bhd 不是高先，不採納。
- `robots.txt`、`sitemap.xml` 失敗，不是有效政策內容。未重做既有會籍 FAQ，未把 HKMovie 通用方式套到高先。
- 報告：`probe/gs-payment-round2-summary.md`；正文：`gs-payment-round2-public.json`、`gs-payment-round2-discovery.json`、`gs-payment-round2-app.json`。

### Lumen

- 本次一般條款及私隱政策均 HTTP 200。條款只要求付款前核對金额；私隱政策只說 SSL、向銀行傳送審批及取票刷卡檢查，沒有品牌清單。
- 私隱政策：<https://www.lumencinema.com.hk/Browsing/General/Privacy>。
- 無訂單訪問猜測付款路徑得到 404；猜測 FAQ／Help 跳到 Error，最終 HTTP 200 也不是有效幫助正文。不能當成已成功讀取付款／FAQ。
- 已捕獲首頁公開鏈接，未找到直接連接的官方 App 付款說明；不據此聲稱沒有 App。
- 報告：`probe/lumen-payment-round2-conclusion.md`；正文：`lumen-payment-round2-public.json`、`lumen-payment-round2-discovery.json`。

### 本輪安全及實測範圍

- 本輪四家沒有登入、填資料、選位、占座、建單、接受購票條款或付款；選位圖片只是開發者商店宣傳圖。
- 部分探測設有非讀取請求阻斷，但不聲稱所有腳本的所有背景請求都是 GET。交易安全界線由實際導航／未推進交易及相應請求記錄支持。
- 未安装或操作原生 App。本輪 App 查核是開發者商店正文及宣傳圖，不是 App 內付款流程實測。
- 未重跑歷史 Lumen 交易／取消腳本；歷史取消狀態仍不可核實。

## 第三輪：公開購票入口與安全阻點（2026-09-27）

本輪沒有取得新的院方明文支付清單。按「只有取得合格證據才更新」的要求，**`lib/cinema-payments.ts` 及測試內容均未修改**；四家維持 `methods: []`、`verified: false`，原有 UI／已確認篩選行為不變。未核實不代表沒有支付方式或政策。

本輪不再重做 App 商店介紹。歷史購票／continue／確認／取消腳本僅閱讀，不執行；不為調查占座、建單或提供資料。

### 英皇

- 由已捕獲的官方路由註冊發現 `stationary/bookingFAQ`，實際訪問 <https://www.emperorcinemas.com/stationary/bookingFAQ?wapid=ECML_WEB_PROD_S_MPS>。
- 主文檔 GET／HTTP 200，但安全阻斷下最終為 `/err?wapid=ECML_WEB_PROD_S_MPS`，全文僅 “Oh! Something went wrong” 等錯誤文字，並非成功讀取 FAQ／付款政策。
- 自動 POST `gop.alipic.icirena.own.cinema.checkdomain` 及包含該接口的嵌套 GET 包裝 URL 已阻斷；未放行、改方法、重放签名或偽造本地域名檢查快取。不能把限制下的錯誤頁說成院方永久故障，也不覆蓋前輪成功 FAQ 證據。
- 實際下載的 `p_stationary-bookingfaq-index.js` 只用於核對路由用途：問題是 private booking／包場、外來食物、片源、贈品及惡劣天氣，不能由 bookingFAQ 名稱當作一般戲票付款說明。沒有將源碼內容描述為本輪 rendered FAQ。
- 本輪未讀正常資訊正文、電影／場次／未選位入口及下游付款頁，未用虛構訂單或交易狀態補齊。
- 報告：`probe/emperor-payment-round3-conclusion.md`；完整來源／正文／URL／HTTP／准許／阻斷／失敗及 script 映射：`emperor-payment-round3-public.json`；實際錯誤頁 `.html`／`.png`。

### Cinema City

- 從官网 <https://www.cinemacity.com.hk/> 正常起步，302 到含 `wapid` 的首頁，主文檔 HTTP 200；只讀限制下最終為 `/err?wapid=CICI_WEB_PROD_S_MPS`，只有錯誤正文。
- 自動啟動 `cinema.checkdomain` 實際為 POST，連同嵌套 GET 包裝已阻斷。未把 POST 配置查詢改方法放行，未刷新循環或繞過初始化直接進下游。
- 未取得電影／場次／具體場地未選位頁的正文，該頁如存在的 Help／Terms 及下游付款頁均未讀；不能據此聲稱院方没有公開說明。
- 報告：`probe/cc-payment-round3-findings.md`；`cc-payment-round3-discover.json` 保存真實 URL／HTTP／錯誤／全文／blocked；`cc-payment-round3-source-review.json` 僅解釋啟動阻點，非支付證據。

### 高先

- 當前官網首頁實際公布的《狂野雄心》電影頁 HTTP 200；9 月 28 日、4 號院、13:30 場次打開身份選擇彈窗。
- 正常點「非會員購票」後，院方實際打開 `https://ticket.hkmovie6.com/gsc/278b6d3d-edb1-4e32-b9f3-3f88e543b865/none/?lang=zh`，主文檔 HTTP 200；最終客戶端路由 `/none/seat`，没有獨立 `/seat` 文檔回應。
- 該入口初始化自動嘗試 **POST `/tixis-api/v1/transaction/create`**，請求發出前被 context route 阻斷。最終可讀正文、links／controls 為空，沒有 Help／Terms 或付款清單可採納；因此止步，沒有建單。
- 不把 HTTP 200 空殼當正常付款頁，也不把支付 SDK／資源或 HKMovie 通用政策當高先政策。不能斷言普通訪客必須占座才見付款頁；只確認本次初始化觸及禁止的交易接口。
- 報告：`probe/gs-payment-round3-summary.md`；`gs-payment-round3-home.json`／`gs-payment-round3-entrance.json` 保存來源鏈、導航回應、正文、准許及 blocked。

### Lumen

- 沿官網真實鏈接读取首頁、當前節目、票價、聯絡及《Avengers: Endgame Encore》影片詳情，共 5 個公開頁，均 requested/final 相同且 HTTP 200，沒有新的一般支付清單。
- 實際發現 `visSelectTickets.aspx?...txtSessionId=66432...`／`66462`，**沒有請求**。公開 href／客戶端 JS 及舊腳本不能證明 ASP.NET 初始 GET 不產生服務端交易或占座狀態，因此不假定 GET 一定只讀。
- 初始售票頁自身的正文／幫助／Terms／JS 及後續選位、資料、交易、付款頁本輪均未讀。沒有數量、PostBack、Next 或舊訂單檢查；歷史 Lumen 取消狀態仍未知。
- 22 個官網實際引用的静態 JS 只用於導航发现，不作支付證據。首頁兩個自動 POST 及影片評分 POST 已阻斷；寬泛 lock 規則亦誤攔 `Clock.png`，保留記錄，不解讀為交易。
- 報告：`probe/lumen-payment-round3-conclusion.md`；`lumen-payment-round3-capture.json`／`lumen-payment-round3-scripts.json` 保存實際正文／HTML、links、完整 URL／HTTP／錯誤／blocked 和靜態腳本來源。

### 第三輪安全、驗證及未讀範圍

- 所有本輪瀏覽器捕獲在首個導航前設置阻斷所有非 GET／HEAD／OPTIONS，並過濾交易／未審入口；GET／JSONP 不因方法自動視為安全。英皇／Cinema City 的嵌套 API 包裝也被阻斷。Lumen 靜態腳本另以明確 GET、無重定向取得，限定已发现的官網 `.js`。
- 四家没有登入、提供個人資料、選位、占座、建單、接受購票條款、繼續購票、付款或取消。錯誤／空頁與未請求頁面的範圍如上，不宣稱本輪成功讀取完整付款頁；也不概括前兩輪所有背景請求都是 GET。
- `node --check`：本輪四家捕獲腳本及離線验证腳本均通過。
- `node probe/check-payment-round3.cjs`：JSON 可解析、來源文件存在、成功回應方法／阻點檢查通過。英皇 78 個准許請求／19 blocked／37 script 回應；Cinema City 95 個回應或失敗事件／12 blocked／43 script 回應；高先 transaction/create 只在 blocked、非准許記錄；Lumen 5 公開頁／22 靜態脚本／0 Ticketing 請求。這是既存記錄的離線驗證，不是額外聯網。
- `lib/cinema-payments.ts`／`scripts/test-cinema-payments.ts` 在捕獲 hash 後保持不變；全部第三輪 worker 亦未修改應用或測試。
- `npx tsx --test scripts/test-cinema-payments.ts`：本輪重新執行，4 項通過；`git diff --check` 通過。
- 本輪只新增調查／验证文件及本審計段，沒有重跑 TypeScript、build 或瀏覽器 UI 測試；下節建置結果屬前輪，不作第三輪新結果。未部署、未提交，未覆蓋其他既有工作區修改。
- 驗證摘要：`probe/payment-round3-validation.json`。
- 第三輪獨立 reviewer 只讀复核結論 OK：沒有編輯、聯網、執行脚本／測試或再次導航交易流程，結論僅核對既有證據，不作額外現場實測。

## 第四輪：非交易公開條款、FAQ 與 App 開發者版本說明（2026-09-27）

四家本輪均**未取得適用於一般網上／官方 App 購票的院方明文支付清單**。按用戶要求，沒有新清單就不改 `lib/cinema-payments.ts`，連核查備註亦未改；測試內容不變。仍為空清單、未核實，只表示證據不足，不代表不支援付款或沒有官方 App。

### 英皇

- 新讀香港 App Store 官方 App `id1294743651` 中英頁，均 HTTP 200；院方開發者文字及當前版本 3.1.6（2026-06-01）談 CINEMER、UI/UX、免手續費、印花、VIP、PopCoin，沒有支付清單。
- 各語言離線整理 Apple 隨頁公開的 25 項版本記錄（3.1.6 至 2.30）。來源是本 App 的 product/version-history publication，限定開發者描述／版本段落，排除評論、推薦 App、遙測；不是付款 API 配置或原生 App 實測，也不是本輪點開瀏覽器版本彈窗。發行文字未列一般支付方式。
- 從開發者實際 Support 链接 GET `https://www.emperorcinemas.com/en/general/faqs`，HTTP 302 指向 `https://www.emperorcinemas.com/?wapid=ECML_WEB_PROD_S_MPS`。目的首頁不在本輪公開文檔 allowlist，**未請求**；沒有取得新 FAQ 正文。首次與一次有界核對均保存，不把 finalUrl／Location 混寫，也不覆蓋前輪成功 FAQ。
- Android 官方 `com.emperor.cinemas` 英文頁 HTTP 200，Updated on 2026-05-26，What's new 仍只有 UI/UX、CINEMER 等。院方官網／支援電郵仍匹配；已有私隱政策不重讀。
- 5 次 Bing、1 次 Google 發現查詢未得到可用新政策；有無關结果及 HTTP 200 空正文，不能當「不存在政策」證據。未跟隨搜索 wrapper 或繞過挑戰。
- 報告及來源：`probe/emperor-payment-round4-conclusion.md`、`public.json`／`store-review.json`／`followup.json`／`support.json`／`more.json`（均為 emperor-payment-round4- 前綴），附原始 HTML、requested/final URL、每跳狀態及未請求目的地。

### Cinema City

- 官方 iOS 中英頁、Android 英文頁與兩個商店開發者列表，實際 GET 取得。iOS 最新顯示 1.1.3（3 Aug／8月3日；不補未展示年份），已讀公開版本記錄；Android 更新日 2026-07-28。發行說明為修復／性能优化，沒有支付清單。
- 商店支持語言是 App 語言資料，不是條款解釋優先政策。開發者列表沒有額外支付說明。平台「付款和訂閱」、評論、推薦 App 不採納。
- Android 實際私隱链接 `https://www.cinemacity.com.hk/cc/agreement/en/privacy-agreement.htm?wapid=CICI_WEB_PROD_S_MPS` HTTP 200，但 body 仍空白，不算成功讀到政策。前輪雙語 CC Wallet 補差限制及英文優先條款仍不足以確認一般支付方式，未機械重讀。
- 4 次有界搜索只有回退框架或非目標／無關結果，未取得可信新 FAQ／活動文檔。未請求首頁或任何售票／seat／payment 入口。
- 報告：`probe/cc-payment-round4-findings.md`；`public.json`、10 個 page HTML 及 `validation.json`（均帶 cc-payment-round4- 前綴）。

### 高先

- 新讀 `/news`、沿其實際 anchor 的 TGIF 新聞詳情、`/aboutUs`，HTTP 200。新聞列表只是票尾優惠；詳情僅導航／頁尾，不視為政策正文。關於頁確認香港院方身份與聯絡資料，未見新 App／支付清單。
- 四次 Bing 定向檢索的可讀內容主要為搜索導航；第三方動態 API 被阻斷，可見结果可能不完整。Google Play 搜索的 Golden Screen Cinemas Sdn Bhd 為海外不同院線，排除；沒有建立香港高先獨立 App 身份鏈，不代表沒有 App。
- **完全未訪問 `ticket.hkmovie6.com`**，沒有開場次／非會員 popup 或重走第三輪 transaction/create 阻點；第三方通用方式、SDK、續會現金不外推一般高先支付。
- 實際允許的 first-party xhr/fetch 只有公開 `/gsc-blog/` 分類／文章讀取；沒有把第一方所有 API 抽象保證為安全。報告：`probe/gs-payment-round4-summary.md`、`live.json`／`audit.json`，均帶 gs-payment-round4- 前綴。

### Lumen

- 真實首頁「中文」控制的既有 JS 只切換語言 cookie 並 reload；本輪實際 GET 讀到中文首頁、一般條款、私隱政策、包場／團體訂票頁。未放行語言 POST／重放 API。來源為中文頁 footer 實際 anchors，均 HTTP 200、requested/final 相同。
- 中文條款只要求核對交易金額；末尾「學生八達通」是學生身份證明**排除項**，不是接受八達通支付。中文私隱只談 SSL、銀行審批結算、取票刷卡，不能確認品牌。包場頁只列電郵查詢安排，未填聯絡資料或送出查詢。
- 「Rule／戲院守則」的實際 href 與 `TermsAndConditions` 相同，不存在本輪另讀一份 Rule 政策的聲稱。
- 五次 Bing 發現查詢中，四次取得框架／無關內容；最後含 payment 的搜索 URL 被本地敏感規則阻斷，沒有服務端 HTTP 回應。其 finalUrl 是錯誤後殘留觀察，不是成功重定向或搜索结果。沒有可信官方 App 商店候選，不猜 App ID。
- 本輪 **0 `/Ticketing/` 請求**；初始 GET 的服務端作用仍未排除，沒有訪問新／舊售票入口，亦不查歷史訂單或取消狀態。
- 報告：`probe/lumen-payment-round4-conclusion.md`；`capture.json`、成功頁 HTML、`validate.cjs`／`validation.json`，均帶 lumen-payment-round4- 前綴。

### 第四輪安全、驗證及未讀範圍

- 英皇／Cinema City 採顯式 HTML-only GET、逐跳審核且不執行返回的 script；文本由隔離 Edge 離線提取，首個 page 之前阻斷全部網絡。高先／Lumen 的聯網瀏覽器首導航之前已設 context-wide interception、serviceWorkers:block，非 GET／HEAD／OPTIONS 及交易入口均阻斷；高先實際 first-party 動態讀取另按捕獲 URL 離線核對。GET 方法本身不是安全或無狀態的保證。
- 四家沒有登入、數量、個人資料、選位、占座、建單、條款接受、繼續購票、付款、取消或歷史訂單檢查。所有售票／seat／transaction／付款頁及其下游幫助均未讀；商店核查不是安裝或原生 App 實測。這些只針對第四輪，不替歷史調查補保證。
- 本輪 JSON 離線檢查通過：英皇 11 次公開 GET attempts（含 Support 的兩次 302）、每語言25版本；Cinema City 10 文檔／13 GET；高先 8 文檔／734 allowed／459 blocked、0 ticket-host；Lumen 10 捕獲項（含1本地阻斷錯誤）、中文文檔及0 Ticketing。blocked／失敗／HTTP 回應分開，不把空殼當政策。
- `node --check`：四家新捕獲腳本、英皇版本整理、Lumen 驗證及兩個綜合離線脚本通過；`node probe/check-payment-round4.cjs` 通過，結果 `probe/payment-round4-validation.json`。`probe/payment-round4-inspect.json` 是已有記錄的離線摘錄，不是追加現場讀取。
- 支付模块／測試 SHA256 與第三輪基線相同；Git blob hash 亦與第四輪開始相同：`272d16ceb61cd6429b371bfb230bb4b3baa760c0`／`20ca54e90e670e96de665aaa36e4e62d7107e8cf`。保留既有其他工作區修改。
- `npx tsx --test scripts/test-cinema-payments.ts` 本輪重新執行，4項通過；`git diff --check` 通過。沒有重跑 TypeScript、build、靜態構建斷言或完整 UI；下節結果仍歸第一、二輪。
- 本輪只新增取證／驗證文件及本審計段，不修改应用／測試，未提交、未部署。未找到的獨立 FAQ、未發布版本與未知官方 App 身份仍是證據缺口，不宣稱全站／全部 App 政策已讀。
- 第四輪獨立 reviewer 只讀復核結論 **OK**：來源身份、版本文字範圍、302 未跟隨、200 空正文、本地阻斷與殘留 finalUrl、安全界線及驗證輪次均與記錄相符。reviewer 沒有編輯、聯網、執行腳本／測試或購票流程；hash／測試結果按既有記錄核對，不算追加現場實測。

## 用戶補充官方付款頁截圖及渠道確認（2026-09-27；其後於第四輪完成）

用戶先提供四家方式说明及 Cinema City／高先／Lumen 三張付款頁截圖；经询问，明确确认「这些均来自各院线官方支付页面」，并确认同一渠道为「网页购票（电脑与手机网页）」。本轮没有登录或操作购票流程。该用户明示的来源与渠道确认，是本次更新支付字段的依据，不是本助手独立现场验证。

| 院线 | 记录的网页付款方式 |
|---|---|
| 英皇 | Visa、Mastercard、UnionPay、美国运通、AlipayHK、WeChat Pay HK、Apple Pay |
| Cinema City（图一） | Visa、Mastercard、UnionPay、JCB、支付宝、支付宝香港、八达通 |
| 高先电影院（图二） | Visa、Mastercard、PayMe |
| Lumen Cinema（图三） | Visa、Mastercard、UnionPay、AlipayHK、支付宝、WeChat Pay |

Cinema City 卡组织、双支付宝及八达通根据截图标识辨识；用户随后确认应把卡片品牌记为 Visa、Mastercard、UnionPay、JCB。其余截图方式根据可读文字／标志记录。对应 key 为：`visa`、`mastercard`、`unionpay`、`american_express`、`alipayhk`、`wechat_pay_hk`（英皇）、`wechat_pay`（Lumen）、`apple_pay`、`jcb`、`alipay`、`octopus`、`payme`。

- 已将 `lib/cinema-payments.ts` 中四家对应的香港官方网页购票方式设为 `verified: true`，记录以上清单；说明只适用于电脑及手机网页网购，不外推官方 App、票房、自助售票机。英皇澳门场地另以戏院级覆写保持未确认。
- 截图没有显示来源 URL／域名栏；无法从随附图片独立定位实际付款页，也没有本轮重开／重走支付流程。`source` 暂使用各院线官网首页作为院线身份链接，不应误读为具体付款页 URL。用户来源确认、截图原始附件身份、截图辨识方式及此限制记录于 `probe/payment-user-provided-policy-evidence-2026-09-27.json`。
- 英皇证据明确按香港网页购票范围登记；专案另有澳门英皇场地，不能由香港付款页推断澳门支持相同方式。因此 `emperor-57011` 以戏院级覆写维持 `methods: []`、`verified: false`；场次与戏院输出均按个别 `paymentInfo.verified`，不只按院线级状态。
- 英皇没有随附独立截图；清单由用户直接提供，并在同一明确来源确认中指认为英皇官方付款页。报告不声称已独立读到英皇付款页面。
- 本次后续测试新增四家方式／确认状态 assertions、每种方式的可读筛选标签断言及英皇香港／澳门边界测试。Cinema City、Lumen 的方式记录在静态戏院列表核对；现有静态电影页没有输出其场次记录，因此不声称在这些电影页实际看到 JCB／Lumen 支付标签。

## 程式更新及驗證（第一、二輪）

- `lib/cinema-payments.ts`：新光黃埔改為已確認五種方式；補 PayPal 類型與標籤；補寫其他院線本次核查註記。
- 第二輪只更新四家核查備註及官方 App 來源的採納說明；沒有新增支付 key、方法或已確認院線，其他既有確認政策不變。
- `scripts/test-cinema-payments.ts`：新光原文清單、PayPal 標籤及篩選集合、未確認院線、未知院線兜底測試。本輪未改測試內容，重新執行通過。
- 測試命令：`npx tsx --test scripts/test-cinema-payments.ts`（4 項通過）。
- 型別：`npx tsc --noEmit --pretty false`（通過）。
- 建置：`npm run build`（第二輪重新執行通過，262 個靜態頁面）。
- 靜態整合：`node probe/check-payment-build.cjs`（通過，既有新光支付資料及 PayPal 篩選項仍正確）。
- `git diff --check`（通過）；支付模块仍為 untracked，不能單憑 tracked diff 判斷其內容。
- 第二輪獨立 reviewer 只讀复核結論 OK；沒有聯網、執行流程或測試，不算额外现场验证。
- 未部署。沒有覆蓋既有 `ShowtimeExplorer.tsx`、`lib/data.ts`、`lib/compact.ts`、package 檔修改。

## 用户补充付款资料后的实现核验（2026-09-28）

- 将 `wechat_pay_hk` 独立为 WeChat Pay HK key 与标签，保留 Lumen 的 `wechat_pay`（微信支付）。`probe/check-payment-round4.cjs` 已增加香港／澳门证据边界断言。
- 专案包含澳门英皇 `emperor-57011`。香港付款页证据不外推：新增戏院级空清单覆写；`lib/data.ts` 的戏院与场次付款字段按 `paymentMethodsOf(cinemaId, source).verified` 输出。静态检查器逐对象解析 `/cinema` 输出及电影页 compact cinema 字典，校验澳门记录空方法／未确认。
- `probe/check-payment-build.cjs` 另在存在于本次场次资料的电影静态页上，验证 PayMe 与 WeChat Pay HK 的可读筛选项。该输出确实出现这两个筛选标签；Cinema City／Lumen 本次没有出现在这些电影场次数据中，因此 JCB／Lumen 标签只由模块筛选集合测试覆盖，不宣称在静态电影页观察到。
- 2026-09-28 本轮最终执行：`npm run build` 成功，生成 262 个静态页面；构建后 `node probe/check-payment-build.cjs` 通过（戏院索引 5 案例、澳门英皇场次 7 页／累计 32 行、214 个电影静态导出及筛选标签）；`node probe/check-payment-round4.cjs` 离线一致性检查通过；`npx tsx --test scripts/test-cinema-payments.ts` 5 项通过；`npx tsc --noEmit --pretty false` 通过；`git diff --check` 通过。随后为更精确的澳门场次检查器重写 `check-payment-build.cjs`，以旧 `out/` 重跑通过；此次重写后未重新执行 `npm run build`，应用代码未再修改。
- reviewer 在不运行命令的只读复核中指出旧版静态检查器用固定长度字符串切片检查记录过宽；现已改为解析个别 JSON 对象及 compact 数据。另已逐对象手工检查澳门戏院索引，并通过新版检查器确认澳门戏院付款字段与场次页 compact 字典均未验证。reviewer 未复验修正版运行结果。
- 上述结果是截至该次构建／本地静态产物的验证，不代表部署。未提交、未部署；工作区中其他应用及抓取脚本更动均保留。
