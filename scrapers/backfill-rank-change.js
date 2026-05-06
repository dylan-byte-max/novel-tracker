/**
 * 回溯脚本：基于"严格新书"定义重新计算所有历史数据的 rank_change
 *
 * 严格新书定义：在该日之前的所有历史榜单中都没出现过的 book_id
 * 用法：node scrapers/backfill-rank-change.js [--dry-run]
 */

const fs = require('fs');
const path = require('path');

const DRY = process.argv.includes('--dry-run');
const ROOT = path.join(__dirname, '..', 'data');
const PLATFORMS = ['fanqie', 'qidian', 'jjwxc'];

function loadJson(p) {
  try { return JSON.parse(fs.readFileSync(p, 'utf-8')); } catch (e) { return null; }
}

function saveJson(p, obj) {
  fs.writeFileSync(p, JSON.stringify(obj, null, 2), 'utf-8');
}

for (const platform of PLATFORMS) {
  const histDir = path.join(ROOT, platform, 'history');
  if (!fs.existsSync(histDir)) {
    console.log(`[${platform}] 无 history 目录，跳过`);
    continue;
  }

  const files = fs.readdirSync(histDir).filter(f => f.endsWith('.json')).sort(); // 按日期升序
  console.log(`\n${'='.repeat(60)}`);
  console.log(`[${platform}] 共 ${files.length} 天历史数据`);
  console.log(`${'='.repeat(60)}`);

  // everSeen = 在"当前处理日"之前出现过的所有 book_id
  const everSeen = new Set();
  let totalReclassifiedFromNew = 0; // 原 'new' 被改成 null
  let totalKeptAsNew = 0;            // 原 'new' 仍是 new
  const sampleChanges = [];

  for (const file of files) {
    const dateStr = file.replace('.json', '');
    const filePath = path.join(histDir, file);
    const data = loadJson(filePath);
    if (!data?.books) {
      console.log(`  ${dateStr}: 解析失败，跳过`);
      continue;
    }

    // 取昨天 latest 用来重新计算具体涨跌幅
    // 这里用前一天的 history 文件
    const idx = files.indexOf(file);
    let prevMap = null;
    if (idx > 0) {
      const prevFile = files[idx - 1];
      const prevData = loadJson(path.join(histDir, prevFile));
      if (prevData?.books) {
        prevMap = {};
        for (const b of prevData.books) {
          if (b.book_id) prevMap[String(b.book_id)] = b.rank;
        }
      }
    }

    // 重新分类
    let strictNew = 0, returning = 0, ranked = 0, reclass = 0, keptNew = 0;
    for (const b of data.books) {
      const id = b.book_id ? String(b.book_id) : null;
      const oldVal = b.rank_change;
      let newVal;
      if (!id) {
        newVal = null;
      } else if (!everSeen.has(id)) {
        newVal = 'new';
        strictNew++;
      } else if (prevMap && id in prevMap) {
        newVal = prevMap[id] - b.rank;
        ranked++;
      } else {
        newVal = null;
        returning++;
      }

      // 统计变更
      if (oldVal === 'new' && newVal !== 'new') {
        reclass++;
        if (sampleChanges.length < 10) {
          sampleChanges.push({ platform, date: dateStr, name: b.book_name, oldVal, newVal });
        }
      } else if (oldVal === 'new' && newVal === 'new') {
        keptNew++;
      }
      b.rank_change = newVal;
    }

    totalReclassifiedFromNew += reclass;
    totalKeptAsNew += keptNew;

    console.log(`  ${dateStr}: 严格新书 ${strictNew} | 已存在(无昨日记录) ${returning} | 昨日有记录(算涨跌) ${ranked} | 修正掉 ${reclass} 个伪new`);

    // 把当日所有 book_id 加入 everSeen（为下一日做准备）
    for (const b of data.books) {
      if (b.book_id) everSeen.add(String(b.book_id));
    }

    // 写回（除非 dry-run）
    if (!DRY) {
      saveJson(filePath, data);
    }
  }

  console.log(`\n[${platform}] 汇总: 修正掉伪new ${totalReclassifiedFromNew} 条 | 保留为真·新书 ${totalKeptAsNew} 条`);

  // 同步更新 latest.json（让今日页面立即生效）
  const latestPath = path.join(ROOT, platform, 'latest.json');
  const todayFile = files[files.length - 1];
  const todayData = loadJson(path.join(histDir, todayFile));
  if (todayData && !DRY) {
    saveJson(latestPath, todayData);
    console.log(`[${platform}] latest.json 已同步为 ${todayFile.replace('.json','')} 的修正版`);
  }
}

console.log('\n=== 示例修正（前 10 条） ===');
// 由于循环已结束，从打印中取样不便。改为外部 console.log 中已展示
console.log(DRY ? '\n[DRY-RUN] 未实际写入文件。去掉 --dry-run 来执行。' : '\n✅ 回溯完成。');
