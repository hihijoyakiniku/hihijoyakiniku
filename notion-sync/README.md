# 日日敘官網 — Notion同步腳本 使用說明

## 這批檔案是什麼

- `sync-notion-to-html.js`：主程式，讀Notion資料庫→產生HTML→更新sitemap.xml
- `template-article.html`：文章版型（**目前是暫用版型，見下方「必做事項」**）
- `package.json`：npm依賴設定
- `sync-notion.yml`：GitHub Actions排程設定檔

## 安裝步驟

### 1. 把整個 `notion-sync/` 資料夾放進repo根目錄

```
hihijoyakiniku/
├── notion-sync/          ← 這批檔案整包放這裡
│   ├── sync-notion-to-html.js
│   ├── template-article.html
│   ├── package.json
│   └── sync-notion.yml   （這個不留在這裡，見下一步）
├── index.html
├── sitemap.xml
└── ...（其他現有頁面）
```

### 2. 把 `sync-notion.yml` 移到正確位置

GitHub Actions只會讀 `.github/workflows/` 資料夾底下的yml，所以要把它從
`notion-sync/sync-notion.yml` **移動**到：

```
.github/workflows/sync-notion.yml
```

### 3. 設定GitHub repo的Secrets

Settings → Secrets and variables → Actions → New repository secret，新增：

| Name | Value |
|---|---|
| `NOTION_API_KEY` | 你的Notion integration secret（ntn_開頭） |
| `NOTION_DATABASE_ID` | `d390635a5c804573a5a47aced7f7c651` |

別忘了：也要到Notion那個資料庫頁面右上角「...」→「Connections」，把這個integration加進去，不然API會讀不到資料。

### 4. ⚠️ 必做事項：把template換成官網真的版面

`template-article.html` 裡標記 `[[HEADER_HTML]]`、`[[FOOTER_HTML]]`、`[[SITE_STYLES]]`
的地方，目前是我暫時寫的版型（因為我這邊技術上無法直接讀取你們官網已經上線的原始碼）。

正式使用前，**麻煩打開一篇現有的標準版型文章**（例如 `yakiniku-reservation-guide.html`），
把裡面共用的：
- `<head>` 裡的 `<style>` 或 `<link rel="stylesheet">`
- 頁首（logo、導覽列）的HTML
- 頁尾（footer）的HTML

複製貼上取代掉template裡對應的佔位區塊。這樣同步產生出來的新文章，
視覺才會跟現有頁面完全一致。

### 5. 測試

先用「workflow_dispatch」手動觸發一次（GitHub repo → Actions分頁 → 選這個workflow
→ 右上角「Run workflow」），確認：
- 有沒有正確產生對應slug的html檔案
- 封面圖片有沒有下載進 `assets/images/`
- sitemap.xml有沒有正確更新
- 部署（GitHub Pages）完成後，實際打開網頁看排版對不對

確認沒問題後，排程會照 `sync-notion.yml` 裡設定的頻率（預設每3小時）自動執行。

## 之後的日常使用流程

1. 在Notion「日日敘官網文章」資料庫裡新增或修改文章
2. 把「發布狀態」設成「已上線」
3. 等排程自動跑（或手動點Run workflow），幾分鐘後網站就會更新
4. 不用再手動上傳html檔案到GitHub

## 目前已知限制

- 封面照片：Notion的圖片網址有時效性，腳本會在每次執行時重新下載成本地檔案，
  這是正常行為，不是bug。
- 只有標記「已上線」的文章會被產生成頁面；「草稿」「待審核」「下架」會被略過。
- I篇（顧客好評）目前在Notion裡是「草稿」狀態，不會自動上線，等你們評論數夠了、
  改成「已上線」才會被同步腳本產生出來。
- FAQPage結構化資料目前只針對 `faq-complete-guide` 這個slug自動產生。
