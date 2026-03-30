/**
 * 晋江文学城月榜爬虫
 * 
 * 数据源: https://www.jjwxc.net/topten.php?orderstr=5&t=0
 * 晋江是传统 HTML 渲染，可以直接用 HTTP 请求 + HTML 解析
 * 
 * 抓取字段: 排名、书名、作者、文章属性（分类标签）、积分、状态
 * 详情页补充: 简介、字数、标签、封面
 */

const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');

// ========== 配置 ==========
const DATA_DIR = path.join(__dirname, '..', 'data', 'jjwxc');
const TARGET_COUNT = 50;
const RANK_URL = 'https://www.jjwxc.net/topten.php?orderstr=5&t=0';
const REQUEST_DELAY = 800;
const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
  'Accept-Charset': 'utf-8, gbk;q=0.7, gb2312;q=0.7',
};

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

function httpGet(url, encoding = 'gbk') {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith('https') ? https : http;
    lib.get(url, { headers: HEADERS, timeout: 20000 }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        let redirect = res.headers.location;
        if (redirect.startsWith('/')) {
          const parsed = new URL(url);
          redirect = `${parsed.protocol}//${parsed.host}${redirect}`;
        }
        return httpGet(redirect, encoding).then(resolve).catch(reject);
      }
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => {
        const buffer = Buffer.concat(chunks);
        // 晋江使用 GBK 编码
        if (encoding === 'gbk') {
          try {
            const { TextDecoder } = require('util');
            const decoder = new TextDecoder('gbk');
            resolve({ status: res.statusCode, data: decoder.decode(buffer) });
          } catch(e) {
            // fallback: 如果 TextDecoder 不支持 gbk，尝试 utf-8
            resolve({ status: res.statusCode, data: buffer.toString('utf-8') });
          }
        } else {
          resolve({ status: res.statusCode, data: buffer.toString('utf-8') });
        }
      });
    }).on('error', reject).on('timeout', () => reject(new Error('timeout')));
  });
}

// ========== 解析月榜列表页 ==========
function parseRankPage(html) {
  const books = [];
  
  // 晋江月榜的表格结构：每行是一条记录
  // 格式: 排名 | 作者 | 作品标题 | 文章属性 | 积分 | 更新时间
  
  // 提取表格行
  const tableMatch = html.match(/<table[^>]*class="cytable"[^>]*>([\s\S]*?)<\/table>/i) 
    || html.match(/<table[^>]*>([\s\S]*?)<\/table>/gi);
  
  // 尝试按行匹配（晋江的格式比较特殊）
  // 每条记录包含: 排名, 作者链接, 作品标题链接, 属性, 积分, 更新时间
  
  // 方法1: 匹配 tr 行
  const rows = html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi);
  let rank = 0;
  
  for (const row of rows) {
    const rowHtml = row[1];
    
    // 跳过表头行
    if (rowHtml.includes('<th') || rowHtml.includes('排名') && rowHtml.includes('作品')) continue;
    
    const cells = [];
    const cellMatches = rowHtml.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi);
    for (const cell of cellMatches) {
      cells.push(cell[1].trim());
    }
    
    if (cells.length < 4) continue;
    
    rank++;
    if (rank > TARGET_COUNT) break;
    
    // 解析各字段
    // 排名
    const rankNum = parseInt(cells[0]?.replace(/<[^>]*>/g, '').trim()) || rank;
    
    // 作者
    const authorMatch = cells[1]?.match(/<a[^>]*>(.*?)<\/a>/);
    const author = authorMatch ? authorMatch[1].trim() : cells[1]?.replace(/<[^>]*>/g, '').trim() || '';
    const authorLinkMatch = cells[1]?.match(/href="([^"]*)"/);
    const authorUrl = authorLinkMatch ? authorLinkMatch[1] : '';
    
    // 作品标题
    const titleMatch = cells[2]?.match(/<a[^>]*href="([^"]*)"[^>]*>(.*?)<\/a>/);
    const bookName = titleMatch ? titleMatch[2].replace(/<[^>]*>/g, '').trim() : cells[2]?.replace(/<[^>]*>/g, '').trim() || '';
    const bookUrl = titleMatch ? titleMatch[1] : '';
    
    // 提取 novelid
    let bookId = '';
    if (bookUrl) {
      const idMatch = bookUrl.match(/novelid=(\d+)/) || bookUrl.match(/\/(\d+)/);
      if (idMatch) bookId = idMatch[1];
    }
    
    // 文章属性 (原创-纯爱-近代现代-游戏)
    const attrText = cells[3]?.replace(/<[^>]*>/g, '').trim() || '';
    const attrParts = attrText.split('-').map(s => s.trim()).filter(Boolean);
    
    // 积分
    const scoreText = cells[4]?.replace(/<[^>]*>/g, '').replace(/,/g, '').trim() || '0';
    const score = parseInt(scoreText) || 0;
    
    // 更新时间
    const updateTime = cells[5]?.replace(/<[^>]*>/g, '').trim() || '';
    
    // 分类解析
    // attrParts 通常是: [性质, 类型, 时代, 题材]
    // 例: ["原创", "纯爱", "近代现代", "游戏"]
    const nature = attrParts[0] || '';     // 原创/衍生
    const genre = attrParts[1] || '';       // 纯爱/言情/百合/无CP
    const era = attrParts[2] || '';         // 近代现代/架空历史/古色古香/幻想未来
    const theme = attrParts[3] || '';       // 游戏/科幻/武侠 等
    
    // 标签体系
    const allTags = attrParts.filter(Boolean);
    const primaryTag = theme || genre || era || nature || '未分类';
    const secondaryTags = allTags.filter(t => t !== primaryTag);
    
    // 频道判断（晋江的频道概念不同于起点/番茄）
    let channel = '未知';
    if (genre === '纯爱') channel = '纯爱';
    else if (genre === '言情') channel = '言情';
    else if (genre === '百合') channel = '百合';
    else if (genre === '无CP') channel = '无CP';
    else channel = genre || '未知';
    
    if (bookName) {
      books.push({
        rank: rankNum,
        book_id: bookId,
        book_name: bookName,
        author,
        channel,          // 晋江用 channel 表示 纯爱/言情/百合/无CP
        nature,           // 原创/衍生
        genre,            // 纯爱/言情
        era,              // 时代设定
        theme,            // 题材
        primary_tag: primaryTag,
        secondary_tags: secondaryTags,
        all_tags: allTags,
        score,
        score_display: formatScore(score),
        abstract: '',     // 需要从详情页获取
        status: '未知',
        update_time: updateTime,
        thumb_url: '',
        book_url: bookUrl.startsWith('http') ? bookUrl : `https://www.jjwxc.net/${bookUrl}`,
        author_url: authorUrl.startsWith('http') ? authorUrl : (authorUrl ? `https://www.jjwxc.net/${authorUrl}` : ''),
        rank_change: null,
      });
    }
  }
  
  return books;
}

function formatScore(n) {
  if (!n) return '0';
  if (n >= 1000000000) return (n / 1000000000).toFixed(1) + 'G';
  if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M';
  if (n >= 1000) return (n / 1000).toFixed(1) + 'K';
  return String(n);
}

// ========== 从详情页获取简介、字数、封面 ==========
async function fetchBookDetail(bookUrl, bookId) {
  try {
    const url = bookUrl || `https://www.jjwxc.net/onebook.php?novelid=${bookId}`;
    const res = await httpGet(url, 'gbk');
    const html = res.data;
    const info = {};
    
    // 简介
    const introMatch = html.match(/<div[^>]*id="novelintro"[^>]*>([\s\S]*?)<\/div>/i);
    if (introMatch) {
      info.intro = introMatch[1]
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<[^>]*>/g, '')
        .replace(/&nbsp;/g, ' ')
        .trim()
        .split('\n')
        .map(s => s.trim())
        .filter(Boolean)
        .join(' ')
        .slice(0, 300);
    }
    
    // 字数
    const wordMatch = html.match(/字数[：:]\s*([\d,]+)/);
    if (wordMatch) {
      info.wordCount = wordMatch[1].replace(/,/g, '');
    }
    
    // 封面图
    const coverMatch = html.match(/<img[^>]*class="noveldefaultimage"[^>]*src="([^"]*)"/)
      || html.match(/novelimage[^>]*src="([^"]*)"/);
    if (coverMatch) {
      let coverUrl = coverMatch[1];
      if (coverUrl.startsWith('//')) coverUrl = 'https:' + coverUrl;
      info.thumbUrl = coverUrl;
    }
    
    // 状态
    if (html.includes('完结') || html.includes('[已完成]')) {
      info.status = '完结';
    } else if (html.includes('连载') || html.includes('[连载中]')) {
      info.status = '连载中';
    }
    
    // 额外标签（详情页可能有更多标签）
    const tagMatches = html.matchAll(/<a[^>]*class="[^"]*bluetip[^"]*"[^>]*>([^<]+)<\/a>/gi);
    const extraTags = [];
    for (const m of tagMatches) {
      const t = m[1].trim();
      if (t && t.length < 10) extraTags.push(t);
    }
    if (extraTags.length > 0) info.extraTags = extraTags;
    
    return info;
  } catch(e) {
    console.log(`    [WARN] 详情页失败: ${e.message}`);
    return null;
  }
}

// ========== 主函数 ==========
async function main() {
  const now = getNowBJT();
  console.log('='.repeat(60));
  console.log(`晋江文学城月榜爬虫 - ${fmtDateTime(now)}`);
  console.log('='.repeat(60));

  ensureDir(DATA_DIR);
  ensureDir(path.join(DATA_DIR, 'history'));

  // 阶段一：抓取月榜列表
  console.log('\n📊 阶段一：抓取月榜列表');
  let res;
  try {
    res = await httpGet(RANK_URL, 'gbk');
  } catch(e) {
    console.error('  获取榜单失败:', e.message);
    process.exit(1);
  }
  
  const listBooks = parseRankPage(res.data);
  console.log(`  解析到 ${listBooks.length} 本`);
  
  if (listBooks.length === 0) {
    console.log('  [ERROR] 未能解析到任何书籍数据！');
    console.log('  尝试保存原始 HTML 用于调试...');
    fs.writeFileSync(path.join(DATA_DIR, 'debug_rank_page.html'), res.data, 'utf-8');
    
    // 如果有历史数据就不报错
    const latestPath = path.join(DATA_DIR, 'latest.json');
    if (fs.existsSync(latestPath)) {
      console.log('  已有历史数据，跳过本次');
      process.exit(0);
    }
    process.exit(1);
  }

  // 阶段二：获取详情
  console.log(`\n📖 阶段二：获取 ${listBooks.length} 本书详情`);
  
  for (let i = 0; i < listBooks.length; i++) {
    const book = listBooks[i];
    process.stdout.write(`  [${i+1}/${listBooks.length}] ${book.book_name} `);
    
    if (book.book_id) {
      const detail = await fetchBookDetail(book.book_url, book.book_id);
      if (detail) {
        if (detail.intro) book.abstract = detail.intro;
        if (detail.wordCount) book.word_count = detail.wordCount;
        if (detail.thumbUrl) book.thumb_url = detail.thumbUrl;
        if (detail.status && book.status === '未知') book.status = detail.status;
        if (detail.extraTags?.length > 0) {
          for (const t of detail.extraTags) {
            if (!book.all_tags.includes(t)) {
              book.all_tags.push(t);
              book.secondary_tags.push(t);
            }
          }
        }
        process.stdout.write('✓');
      } else {
        process.stdout.write('✗');
      }
    }
    
    console.log(` [${book.primary_tag}]`);
    if (i < listBooks.length - 1) await sleep(REQUEST_DELAY);
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
    for (const b of listBooks) {
      if (b.book_id in prevMap) {
        b.rank_change = prevMap[b.book_id] - b.rank;
      } else {
        b.rank_change = 'new';
      }
    }
    console.log('  已对比历史数据');
  } else {
    for (const b of listBooks) b.rank_change = 'new';
    console.log('  无历史数据，全部标记为新');
  }

  // 统计
  const tagStats = {};
  for (const b of listBooks) { tagStats[b.primary_tag] = (tagStats[b.primary_tag] || 0) + 1; }
  const channelStats = {};
  for (const b of listBooks) { channelStats[b.channel] = (channelStats[b.channel] || 0) + 1; }

  const result = {
    update_time: fmtDateTime(now),
    update_date: fmtDate(now),
    total_count: listBooks.length,
    source: '晋江文学城·积分月榜',
    source_url: RANK_URL,
    platform: 'jjwxc',
    platform_name: '晋江文学城',
    tag_stats: tagStats,
    gender_stats: channelStats,  // 晋江用 channel 代替 gender
    books: listBooks,
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
  console.log(`🎉 完成！共 ${listBooks.length} 本`);
  console.log(`   频道分布: ${JSON.stringify(channelStats)}`);
  console.log(`   主标签分布: ${JSON.stringify(tagStats)}`);
  console.log(`   数据: ${latestPath}`);
}

main().catch(e => {
  console.error('致命错误:', e);
  const latestPath = path.join(__dirname, '..', 'data', 'jjwxc', 'latest.json');
  if (fs.existsSync(latestPath)) {
    console.log('⚠️ 本次运行失败，但已有历史数据可用，退出码 0');
    process.exit(0);
  } else {
    process.exit(1);
  }
});
