/**
 * 起点中文网每日畅销榜爬虫 (Playwright 版)
 * 
 * 数据源: https://www.qidian.com/rank/hotsales/
 * 起点使用 JS 动态渲染，需要 Playwright 加载完整页面
 * 
 * 抓取字段: 排名、书名、作者、分类/标签、简介、字数、状态、封面
 */

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

// ========== 配置 ==========
const DATA_DIR = path.join(__dirname, '..', 'data', 'qidian');
const TARGET_COUNT = 50;
const BASE_URL = 'https://www.qidian.com/rank/hotsales/';

// ========== 工具函数 ==========
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function ensureDir(dir) { if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true }); }

function getNowBJT() {
  const now = new Date();
  return new Date(now.getTime() + (now.getTimezoneOffset() + 480) * 60000);
}
function fmtDate(d) {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}
function fmtDateTime(d) {
  return `${fmtDate(d)} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}:${String(d.getSeconds()).padStart(2,'0')}`;
}

// ========== 抓取畅销榜列表页 ==========
async function scrapeRankPage(page, pageNum) {
  const url = pageNum === 1 ? BASE_URL : `${BASE_URL}page${pageNum}/`;
  console.log(`  加载页面: ${url}`);
  
  await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForSelector('.book-img-text, .rank-body, .book-list', { timeout: 15000 }).catch(() => {});
  await sleep(2000); // 额外等待动态内容
  
  // 提取排行榜数据
  const books = await page.evaluate(() => {
    const items = [];
    
    // 尝试多种选择器适配起点的页面结构
    const bookElements = document.querySelectorAll('.book-img-text ul li, .rank-body .rank-list li, .book-list .book-item');
    
    bookElements.forEach((el, idx) => {
      try {
        // 书名
        const nameEl = el.querySelector('.book-mid-info h2 a, .book-info .book-name a, h2 a, .name a');
        const bookName = nameEl ? nameEl.textContent.trim() : '';
        const bookUrl = nameEl ? nameEl.href : '';
        
        // 提取 book_id
        let bookId = '';
        if (bookUrl) {
          const match = bookUrl.match(/\/book\/(\d+)/) || bookUrl.match(/\/(\d+)/);
          if (match) bookId = match[1];
        }
        
        // 作者
        const authorEl = el.querySelector('.author .name, .author a, .book-mid-info .author a.name');
        const author = authorEl ? authorEl.textContent.trim() : '';
        
        // 分类/标签
        const tagEls = el.querySelectorAll('.author a:not(.name), .tag, .book-mid-info .author a');
        const tags = [];
        tagEls.forEach(t => {
          const txt = t.textContent.trim();
          if (txt && txt !== author && !['|'].includes(txt)) tags.push(txt);
        });
        
        // 也尝试从 type 标签获取
        const typeEl = el.querySelector('.author .type, .tag-list .type, .book-mid-info .author span');
        if (typeEl) {
          const t = typeEl.textContent.trim();
          if (t && !tags.includes(t)) tags.unshift(t);
        }
        
        // 简介
        const introEl = el.querySelector('.intro, .book-mid-info .intro, .desc');
        const intro = introEl ? introEl.textContent.trim() : '';
        
        // 字数
        const wordEl = el.querySelector('.total .word-count, .update span, .book-mid-info p.update span');
        const wordCount = wordEl ? wordEl.textContent.trim() : '';
        
        // 状态
        const statusEl = el.querySelector('.author span, .book-mid-info .author span');
        let status = '连载中';
        if (statusEl) {
          const st = statusEl.textContent.trim();
          if (['完本', '完结'].includes(st)) status = '完结';
        }
        
        // 封面
        const imgEl = el.querySelector('.book-img-box img, .book-img img, img');
        let thumbUrl = '';
        if (imgEl) {
          thumbUrl = imgEl.src || imgEl.getAttribute('data-src') || '';
          if (thumbUrl.startsWith('//')) thumbUrl = 'https:' + thumbUrl;
        }
        
        if (bookName) {
          items.push({
            bookName, bookId, author, tags, intro, wordCount, status, thumbUrl, bookUrl,
          });
        }
      } catch(e) {}
    });
    
    return items;
  });
  
  return books;
}

// ========== 获取单本书详情（更丰富的标签和简介） ==========
async function scrapeBookDetail(page, bookUrl, bookId) {
  try {
    const detailUrl = bookUrl || `https://www.qidian.com/book/${bookId}/`;
    await page.goto(detailUrl, { waitUntil: 'networkidle', timeout: 20000 });
    await sleep(1500);
    
    const detail = await page.evaluate(() => {
      const info = {};
      
      // 完整标签
      const tagEls = document.querySelectorAll('.book-info .tag a, .tag-wrap .tag, .book-detail-info .tag a, .book-cell .tag a');
      const tags = [];
      tagEls.forEach(el => {
        const t = el.textContent.trim();
        if (t && t.length < 15) tags.push(t);
      });
      info.tags = tags;
      
      // 分类信息（通常在面包屑或书籍信息区）
      const crumbEls = document.querySelectorAll('.book-info .tag-wrap a, .crumbs a, .bread-crumbs a');
      const crumbs = [];
      crumbEls.forEach(el => {
        const t = el.textContent.trim();
        if (t && t !== '起点中文网' && t !== '排行榜') crumbs.push(t);
      });
      info.crumbs = crumbs;
      
      // 简介
      const introEl = document.querySelector('.book-info-detail .book-desc, .book-intro p, .intro .content, .book-content-wrap .book-intro');
      info.intro = introEl ? introEl.textContent.trim() : '';
      
      // 字数
      const dataEls = document.querySelectorAll('.book-info .book-state span, .count-detail .num, .book-data em');
      const dataTexts = [];
      dataEls.forEach(el => dataTexts.push(el.textContent.trim()));
      info.dataTexts = dataTexts;
      
      // 频道（男频/女频）
      const channelEl = document.querySelector('.book-info .tag a:first-child, .channel');
      info.channel = channelEl ? channelEl.textContent.trim() : '';
      
      return info;
    });
    
    return detail;
  } catch(e) {
    console.log(`    [WARN] 详情页失败: ${e.message}`);
    return null;
  }
}

// ========== 主函数 ==========
async function main() {
  const now = getNowBJT();
  console.log('='.repeat(60));
  console.log(`起点中文网畅销榜爬虫 - ${fmtDateTime(now)}`);
  console.log('='.repeat(60));

  ensureDir(DATA_DIR);
  ensureDir(path.join(DATA_DIR, 'history'));

  const browser = await chromium.launch({ 
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
    locale: 'zh-CN',
  });
  const page = await context.newPage();

  try {
    // 阶段一：抓取榜单列表
    console.log('\n📊 阶段一：抓取畅销榜列表');
    let allBooks = [];
    
    // 起点畅销榜每页约20本，需要抓3页
    for (let p = 1; p <= 3; p++) {
      const pageBooks = await scrapeRankPage(page, p);
      console.log(`  第${p}页: ${pageBooks.length} 本`);
      allBooks.push(...pageBooks);
      if (p < 3) await sleep(2000);
    }
    
    allBooks = allBooks.slice(0, TARGET_COUNT);
    console.log(`  共获取 ${allBooks.length} 本`);
    
    // 阶段二：逐本获取详情
    console.log(`\n📖 阶段二：获取 ${allBooks.length} 本书详情`);
    const books = [];
    
    for (let i = 0; i < allBooks.length; i++) {
      const raw = allBooks[i];
      process.stdout.write(`  [${i+1}/${allBooks.length}] ${raw.bookName} `);
      
      let detail = null;
      if (raw.bookUrl || raw.bookId) {
        detail = await scrapeBookDetail(page, raw.bookUrl, raw.bookId);
      }
      
      // 合并标签
      let allTags = [];
      if (detail?.tags?.length > 0) {
        allTags = detail.tags;
      } else if (raw.tags?.length > 0) {
        allTags = raw.tags;
      }
      
      // 过滤掉状态标签和非内容标签
      allTags = allTags.filter(t => 
        !['连载', '完本', '完结', '连载中', '签约', 'VIP', '免费'].includes(t) && 
        t.length < 10
      );
      
      const primaryTag = allTags[0] || '未分类';
      const secondaryTags = allTags.slice(1);
      
      // 频道判断
      let gender = '未知';
      const genderKeywords = {
        '男频': ['玄幻', '仙侠', '武侠', '科幻', '都市', '游戏', '军事', '历史', '体育', '悬疑', '轻小说'],
        '女频': ['古代言情', '现代言情', '幻想言情', '浪漫青春', '宫斗', '种田', '宅斗'],
      };
      if (detail?.channel) {
        if (/男/.test(detail.channel)) gender = '男频';
        else if (/女/.test(detail.channel)) gender = '女频';
      }
      if (gender === '未知') {
        for (const [g, kws] of Object.entries(genderKeywords)) {
          if (allTags.some(t => kws.some(k => t.includes(k)))) { gender = g; break; }
        }
      }

      const intro = detail?.intro || raw.intro || '暂无简介';
      const thumbUrl = raw.thumbUrl || '';
      const bookUrl = raw.bookUrl || `https://www.qidian.com/book/${raw.bookId}/`;
      
      console.log(`[${primaryTag}]`);
      
      books.push({
        rank: i + 1,
        book_id: raw.bookId,
        book_name: raw.bookName,
        author: raw.author,
        gender,
        primary_tag: primaryTag,
        secondary_tags: secondaryTags,
        all_tags: allTags,
        abstract: intro,
        status: raw.status || '连载中',
        word_count: raw.wordCount || '',
        thumb_url: thumbUrl,
        book_url: bookUrl,
        rank_change: null,
      });
      
      if (i < allBooks.length - 1) await sleep(1500);
    }

    // 阶段三：计算排名变化
    console.log('\n📈 阶段三：计算排名变化');
    const latestPath = path.join(DATA_DIR, 'latest.json');
    let prevData = null;
    if (fs.existsSync(latestPath)) {
      try { prevData = JSON.parse(fs.readFileSync(latestPath, 'utf-8')); } catch(e) {}
    }

    if (prevData?.books) {
      const prevMap = {};
      for (const b of prevData.books) prevMap[b.book_id] = b.rank;
      for (const b of books) {
        if (b.book_id in prevMap) {
          b.rank_change = prevMap[b.book_id] - b.rank;
        } else {
          b.rank_change = 'new';
        }
      }
      console.log('  已对比历史数据');
    } else {
      for (const b of books) b.rank_change = 'new';
      console.log('  无历史数据，全部标记为新');
    }

    // 统计
    const tagStats = {};
    for (const b of books) { tagStats[b.primary_tag] = (tagStats[b.primary_tag] || 0) + 1; }
    const genderStats = {};
    for (const b of books) { genderStats[b.gender] = (genderStats[b.gender] || 0) + 1; }

    const result = {
      update_time: fmtDateTime(now),
      update_date: fmtDate(now),
      total_count: books.length,
      source: '起点中文网·每日畅销榜',
      source_url: BASE_URL,
      platform: 'qidian',
      platform_name: '起点中文网',
      tag_stats: tagStats,
      gender_stats: genderStats,
      books,
    };

    fs.writeFileSync(latestPath, JSON.stringify(result, null, 2), 'utf-8');
    const histPath = path.join(DATA_DIR, 'history', `${fmtDate(now)}.json`);
    fs.writeFileSync(histPath, JSON.stringify(result, null, 2), 'utf-8');

    // 更新历史索引
    const idxPath = path.join(DATA_DIR, 'history_index.json');
    let idx = [];
    if (fs.existsSync(idxPath)) { try { idx = JSON.parse(fs.readFileSync(idxPath, 'utf-8')); } catch(e){} }
    const today = fmtDate(now);
    if (!idx.includes(today)) idx.unshift(today);
    idx = idx.slice(0, 90);
    fs.writeFileSync(idxPath, JSON.stringify(idx, null, 2), 'utf-8');

    console.log(`\n${'='.repeat(60)}`);
    console.log(`🎉 完成！共 ${books.length} 本`);
    console.log(`   性别分布: ${JSON.stringify(genderStats)}`);
    console.log(`   主标签分布: ${JSON.stringify(tagStats)}`);
    console.log(`   数据: ${latestPath}`);

  } finally {
    await browser.close();
  }
}

main().catch(e => {
  console.error('致命错误:', e);
  const latestPath = path.join(__dirname, '..', 'data', 'qidian', 'latest.json');
  if (fs.existsSync(latestPath)) {
    console.log('⚠️ 本次运行失败，但已有历史数据可用，退出码 0');
    process.exit(0);
  } else {
    process.exit(1);
  }
});
