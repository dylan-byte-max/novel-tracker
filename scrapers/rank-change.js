// 计算今日榜单的 rank_change 字段
// 严格新书定义：在所有历史榜单（data/<platform>/history/*.json）中都没出现过的 book_id 才标 'new'
// 历史出现过、但昨天不在 Top50：rank_change = null（不是新书，也无法精确算涨跌）
// 历史出现过、且昨天在 Top50：rank_change = 昨天rank - 今天rank（数字，正数表示上涨）

const fs = require('fs');
const path = require('path');

/**
 * @param {Array<{book_id, rank, rank_change}>} todayBooks  当日榜单（会被原地修改 rank_change）
 * @param {string} dataDir  data/<platform> 目录
 * @param {string} todayDateStr  今日日期 YYYY-MM-DD（用于排除自身）
 * @param {string} bookKey  用于标识唯一书的字段名，默认 'book_id'
 */
function computeRankChange(todayBooks, dataDir, todayDateStr, bookKey = 'book_id') {
  // 1) 收集全 history 中出现过的所有 book_id（排除今天自身）
  const historyDir = path.join(dataDir, 'history');
  const everSeen = new Set();
  if (fs.existsSync(historyDir)) {
    const files = fs.readdirSync(historyDir).filter(f => f.endsWith('.json'));
    for (const f of files) {
      const dateStr = f.replace('.json', '');
      if (dateStr === todayDateStr) continue;     // 排除今天本身
      try {
        const d = JSON.parse(fs.readFileSync(path.join(historyDir, f), 'utf-8'));
        for (const b of d.books || []) {
          if (b[bookKey]) everSeen.add(String(b[bookKey]));
        }
      } catch (e) {
        console.warn(`  跳过损坏文件 ${f}: ${e.message}`);
      }
    }
  }

  // 2) 读昨天的 latest.json 用于算具体涨跌幅
  const latestPath = path.join(dataDir, 'latest.json');
  let prevMap = null;
  if (fs.existsSync(latestPath)) {
    try {
      const prevData = JSON.parse(fs.readFileSync(latestPath, 'utf-8'));
      // 排除"模拟"假数据（兼容老 qidian.js 的判断）
      if (prevData?.books && !prevData.books[0]?.book_name?.includes('模拟')) {
        prevMap = {};
        for (const b of prevData.books) {
          if (b[bookKey]) prevMap[String(b[bookKey])] = b.rank;
        }
      }
    } catch (e) {}
  }

  // 3) 给每本书计算 rank_change
  let strictNew = 0, returning = 0, ranked = 0;
  for (const b of todayBooks) {
    const id = b[bookKey] ? String(b[bookKey]) : null;
    if (!id) {
      b.rank_change = null;
      continue;
    }
    if (!everSeen.has(id)) {
      // 严格新书：历史从未出现过
      b.rank_change = 'new';
      strictNew++;
    } else if (prevMap && id in prevMap) {
      // 昨天也在 Top50，算涨跌
      b.rank_change = prevMap[id] - b.rank;
      ranked++;
    } else {
      // 历史出现过、但昨天不在 → 视为已存在，无法精确算涨跌
      b.rank_change = null;
      returning++;
    }
  }

  console.log(`  rank_change 统计: 严格新书 ${strictNew} / 昨日存在 ${ranked} / 回归(历史曾上榜) ${returning}`);
  console.log(`  历史比对范围: ${everSeen.size} 个 book_id (来自 history/)`);
  return { strictNew, returning, ranked };
}

module.exports = { computeRankChange };
