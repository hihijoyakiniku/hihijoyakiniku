/**
 * 日日敘官網 — Notion → HTML 同步腳本
 * ------------------------------------------------
 * 用途：讀取「日日敘官網文章」Notion資料庫，把 發布狀態=已上線 的文章
 *      產生成官網HTML檔案，並更新 sitemap.xml。
 *
 * 執行環境：GitHub Actions（見同目錄 sync-notion.yml）
 * 需要的環境變數：
 *   NOTION_API_KEY      - Notion integration secret
 *   NOTION_DATABASE_ID  - 「日日敘官網文章」資料庫的ID
 *
 * ⚠️ 使用前必看：
 * 1. template-article.html 裡的頁首／頁尾／CSS是暫用版型，
 *    請換成官網現有頁面的真實HTML（詳見template檔案裡的說明註解）。
 * 2. 這支腳本只負責「產生檔案」，不會自動 git commit / push，
 *    commit push交給 GitHub Actions workflow處理。
 */

import { Client } from "@notionhq/client";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, ".."); // 假設本資料夾放在 repo 根目錄下的 notion-sync/
const SITE_BASE_URL = "https://hihijoyakiniku.github.io/hihijoyakiniku/";
const IMAGES_DIR = path.join(REPO_ROOT, "assets", "images");
const SITEMAP_PATH = path.join(REPO_ROOT, "sitemap.xml");
const TEMPLATE_PATH = path.join(__dirname, "template-article.html");

const notion = new Client({ auth: process.env.NOTION_API_KEY });
const DATABASE_ID = process.env.NOTION_DATABASE_ID;

if (!process.env.NOTION_API_KEY || !DATABASE_ID) {
  console.error("缺少 NOTION_API_KEY 或 NOTION_DATABASE_ID 環境變數，中止執行。");
  process.exit(1);
}

// ---------- 小工具：讀取Notion屬性 ----------

function getTitle(prop) {
  return (prop?.title || []).map((t) => t.plain_text).join("");
}
function getRichText(prop) {
  return (prop?.rich_text || []).map((t) => t.plain_text).join("");
}
function getSelect(prop) {
  return prop?.select?.name || "";
}
function getMultiSelect(prop) {
  return (prop?.multi_select || []).map((o) => o.name);
}
function getUrl(prop) {
  return prop?.url || "";
}
function getDate(prop) {
  return prop?.date?.start || "";
}
function getFirstFileUrl(prop) {
  const files = prop?.files || [];
  if (files.length === 0) return "";
  const f = files[0];
  return f.type === "external" ? f.external.url : f.file.url;
}

// ---------- 小工具：Notion區塊 → HTML ----------

function richTextToHtml(richTextArray = []) {
  return richTextArray
    .map((rt) => {
      let text = escapeHtml(rt.plain_text);
      if (rt.annotations?.bold) text = `<strong>${text}</strong>`;
      if (rt.annotations?.italic) text = `<em>${text}</em>`;
      if (rt.annotations?.code) text = `<code>${text}</code>`;
      if (rt.href) text = `<a href="${rt.href}">${text}</a>`;
      return text;
    })
    .join("");
}

function escapeHtml(str = "") {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

async function blocksToHtml(blockId) {
  let html = "";
  let cursor = undefined;
  let listBuffer = []; // 暫存連續的bulleted_list_item

  const flushList = () => {
    if (listBuffer.length > 0) {
      html += `<ul>${listBuffer.map((li) => `<li>${li}</li>`).join("")}</ul>\n`;
      listBuffer = [];
    }
  };

  do {
    const res = await notion.blocks.children.list({
      block_id: blockId,
      start_cursor: cursor,
      page_size: 100,
    });

    for (const block of res.results) {
      const type = block.type;

      if (type === "bulleted_list_item") {
        listBuffer.push(richTextToHtml(block.bulleted_list_item.rich_text));
        continue;
      } else {
        flushList();
      }

      if (type === "heading_1") {
        html += `<h2>${richTextToHtml(block.heading_1.rich_text)}</h2>\n`;
      } else if (type === "heading_2") {
        html += `<h2>${richTextToHtml(block.heading_2.rich_text)}</h2>\n`;
      } else if (type === "heading_3") {
        html += `<h3>${richTextToHtml(block.heading_3.rich_text)}</h3>\n`;
      } else if (type === "paragraph") {
        const text = richTextToHtml(block.paragraph.rich_text);
        if (text.trim()) html += `<p>${text}</p>\n`;
      } else if (type === "quote") {
        html += `<blockquote>${richTextToHtml(block.quote.rich_text)}</blockquote>\n`;
      } else if (type === "divider") {
        html += `<hr/>\n`;
      }
      // 其他區塊型別（如table、image）視需要再擴充
    }

    cursor = res.has_more ? res.next_cursor : undefined;
  } while (cursor);

  flushList();
  return html;
}

// ---------- 下載封面圖片 ----------

async function downloadCoverImage(url, slug) {
  if (!url) return "";
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`下載失敗: ${res.status}`);
    const buffer = Buffer.from(await res.arrayBuffer());

    // 從URL猜副檔名，猜不到就預設jpg
    const extMatch = url.match(/\.(jpg|jpeg|png|webp)(\?|$)/i);
    const ext = extMatch ? extMatch[1].toLowerCase() : "jpg";
    const filename = `${slug}-cover.${ext}`;

    if (!fs.existsSync(IMAGES_DIR)) fs.mkdirSync(IMAGES_DIR, { recursive: true });
    fs.writeFileSync(path.join(IMAGES_DIR, filename), buffer);

    return `assets/images/${filename}`;
  } catch (err) {
    console.warn(`⚠️ 封面圖片下載失敗（${slug}）：${err.message}`);
    return "";
  }
}

// ---------- FAQ JSON-LD（僅faq-complete-guide用） ----------

function buildFaqJsonLd(contentHtml) {
  // 從 <h2>問題</h2><p>答案</p> pattern抓出FAQ
  const matches = [...contentHtml.matchAll(/<h2>(.*?)<\/h2>\s*<p>(.*?)<\/p>/g)];
  if (matches.length === 0) return "";

  const faqEntities = matches.map((m) => ({
    "@type": "Question",
    name: stripTags(m[1]),
    acceptedAnswer: { "@type": "Answer", text: stripTags(m[2]) },
  }));

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: faqEntities,
  };

  return `<script type="application/ld+json">${JSON.stringify(jsonLd)}</script>`;
}

function stripTags(str) {
  return str.replace(/<[^>]+>/g, "");
}

// ---------- 主流程 ----------

async function main() {
  console.log("開始從Notion讀取文章資料庫...");

  const template = fs.readFileSync(TEMPLATE_PATH, "utf-8");
  const publishedSlugs = []; // 給sitemap用

  let cursor = undefined;
  do {
    const res = await notion.databases.query({
      database_id: DATABASE_ID,
      start_cursor: cursor,
      page_size: 50,
    });

    for (const page of res.results) {
      const props = page.properties;
      const status = getSelect(props["發布狀態"]);
      const slug = getRichText(props["Slug"]).trim();
      const articleTitle = getTitle(props["文章標題"]);

      if (!slug) {
        console.warn(`⚠️ 跳過「${articleTitle}」：沒有設定Slug`);
        continue;
      }

      if (status !== "已上線") {
        console.log(`⏭️ 略過「${articleTitle}」（狀態：${status || "未設定"}）`);
        continue;
      }

      console.log(`📝 產生中：${articleTitle}（${slug}）`);

      const seoTitle = getRichText(props["SEO標題"]) || articleTitle;
      const metaDescription = getRichText(props["Meta描述"]);
      const breadcrumb = getRichText(props["麵包屑設定"]);
      const ctaText = getRichText(props["CTA文字"]) || "立即訂位";
      const ctaLink = getUrl(props["CTA連結"]) || "https://lin.ee/yXrMthL";
      const updateDate = getDate(props["更新日期"]) || new Date().toISOString().slice(0, 10);
      const coverSourceUrl = getFirstFileUrl(props["封面照片"]);

      const contentHtml = await blocksToHtml(page.id);
      const localCoverPath = await downloadCoverImage(coverSourceUrl, slug);
      const coverImageUrl = localCoverPath
        ? `${SITE_BASE_URL}${localCoverPath}`
        : `${SITE_BASE_URL}assets/images/default-cover.jpg`;

      const pageUrl = `${SITE_BASE_URL}${slug}.html`;
      const faqBlock = slug === "faq-complete-guide" ? buildFaqJsonLd(contentHtml) : "";

      let outputHtml = template
        .replaceAll("{{SEO_TITLE}}", escapeHtml(seoTitle))
        .replaceAll("{{META_DESCRIPTION}}", escapeHtml(metaDescription))
        .replaceAll("{{PAGE_URL}}", pageUrl)
        .replaceAll("{{COVER_IMAGE_URL}}", coverImageUrl)
        .replaceAll("{{ARTICLE_TITLE_JSON}}", JSON.stringify(articleTitle).slice(1, -1))
        .replaceAll("{{META_DESCRIPTION_JSON}}", JSON.stringify(metaDescription).slice(1, -1))
        .replaceAll("{{DATE_PUBLISHED}}", updateDate)
        .replaceAll("{{DATE_MODIFIED}}", updateDate)
        .replaceAll("{{FAQ_JSONLD_BLOCK}}", faqBlock)
        .replaceAll("{{BREADCRUMB}}", escapeHtml(breadcrumb))
        .replaceAll("{{ARTICLE_TITLE}}", escapeHtml(articleTitle))
        .replaceAll("{{CONTENT_HTML}}", contentHtml)
        .replaceAll("{{CTA_LINK}}", ctaLink)
        .replaceAll("{{CTA_TEXT}}", escapeHtml(ctaText));

      fs.writeFileSync(path.join(REPO_ROOT, `${slug}.html`), outputHtml, "utf-8");
      publishedSlugs.push({ slug, updateDate });
    }

    cursor = res.has_more ? res.next_cursor : undefined;
  } while (cursor);

  updateSitemap(publishedSlugs);

  console.log(`✅ 完成，共產生 ${publishedSlugs.length} 篇文章。`);
}

// ---------- 更新 sitemap.xml ----------

function updateSitemap(publishedSlugs) {
  let sitemap = "";
  if (fs.existsSync(SITEMAP_PATH)) {
    sitemap = fs.readFileSync(SITEMAP_PATH, "utf-8");
  } else {
    sitemap = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n</urlset>\n`;
  }

  // 移除舊的、屬於這批文章slug的 <url> 區塊，避免重複
  for (const { slug } of publishedSlugs) {
    const loc = `${SITE_BASE_URL}${slug}.html`;
    const escapedLoc = loc.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const blockRegex = new RegExp(`\\s*<url>\\s*<loc>${escapedLoc}</loc>[\\s\\S]*?</url>`, "g");
    sitemap = sitemap.replace(blockRegex, "");
  }

  // 組出新的 <url> 區塊，插入在 </urlset> 之前
  const newEntries = publishedSlugs
    .map(
      ({ slug, updateDate }) => `  <url>
    <loc>${SITE_BASE_URL}${slug}.html</loc>
    <lastmod>${updateDate}</lastmod>
    <priority>0.7</priority>
  </url>`
    )
    .join("\n");

  sitemap = sitemap.replace("</urlset>", `${newEntries}\n</urlset>`);
  fs.writeFileSync(SITEMAP_PATH, sitemap, "utf-8");
  console.log("🗺️ sitemap.xml 已更新。");
}

main().catch((err) => {
  console.error("❌ 同步過程發生錯誤：", err);
  process.exit(1);
});
