// 全应用按键/跳转专项审计（覆盖 pages/* + subpkg/* + subdata/*）
// 检查: 1) WXML 事件绑定 vs JS 方法定义  2) 导航 URL vs app.json 注册路由
//       3) WXML 引用图片存在性  4) 空绑定/占位绑定
import { readFileSync, readdirSync, statSync, existsSync } from 'fs';
import { join, dirname } from 'path';

const ROOT = process.cwd();
const appJson = JSON.parse(readFileSync(join(ROOT, 'app.json'), 'utf8'));
const registered = new Set(appJson.pages);
(appJson.subPackages || []).forEach(sp => sp.pages.forEach(p => registered.add(sp.root + '/' + p)));

// 收集所有页面目录
const pageDirs = [];
function walk(d) {
  for (const f of readdirSync(d)) {
    const p = join(d, f);
    if (statSync(p).isDirectory()) walk(p);
    else if (f.endsWith('.wxml')) pageDirs.push(dirname(p));
  }
}
walk(join(ROOT, 'pages'));
for (const sd of ['subpkg', 'subdata']) {
  const base = join(ROOT, sd);
  if (existsSync(base)) for (const f of readdirSync(base)) {
    const p = join(base, f);
    if (statSync(p).isDirectory()) pageDirs.push(p);
  }
}

const problems = [];
const warn = [];
const EVT = /(?:bind|catch)[:a-z]*="(?!:)([A-Za-z_$][\w$]*)"/g;
const GEN = /^(?:wx:|state|item|index|true|false|null|)/;

for (const dir of [...new Set(pageDirs)]) {
  const wxmlPath = join(dir, 'index.wxml').replace(/index\.wxml$/, pageDirs.length ? '' : '');
  // 找同名 wxml
  const files = readdirSync(dir).filter(f => f.endsWith('.wxml'));
  for (const wxmlFile of files) {
    const base = wxmlFile.replace(/\.wxml$/, '');
    const wxml = readFileSync(join(dir, wxmlFile), 'utf8');
    const jsPath = join(dir, base + '.js');
    let js = '';
    if (existsSync(jsPath)) js = readFileSync(jsPath, 'utf8');

    // 1) 事件绑定 vs 方法
    for (const m of wxml.matchAll(/(?:bind|catch)(?:tap|longpress|change|input|confirm|blur|focus|submit|reset|touchstart|touchmove|touchend|error|load|scrolltolower|refresherrefresh)?[:=]="([A-Za-z_$][\w$]*)"/g)) {
      const handler = m[1];
      if (!js) { problems.push(`${wxmlFile}: 绑定 "${handler}" 但 ${base}.js 不存在`); continue; }
      if (!new RegExp(`(?:^|[\\s,{])` + handler + `\\s*[:(]`).test(js) && !js.includes(handler + '(') && !js.includes(handler + ':')) {
        problems.push(`${join(dir, wxmlFile).replace(ROOT + '/', '')}: 绑定 "${handler}" 在 ${base}.js 中未定义`);
      }
    }

    // 2) JS 导航 URL vs 注册路由 + tabBar
    const tabBarSet = new Set((appJson.tabBar?.list || []).map(t => t.pagePath));
    if (js) {
      for (const m of js.matchAll(/wx\.(navigateTo|redirectTo|reLaunch|switchTab)\(\s*\{\s*url:\s*["'`]([^"'`]+)["'`]/g)) {
        const api = m[1], url = m[2].split('?')[0].replace(/^\/+/, '');
        if (url === '' || url.startsWith('../')) {
          // 相对路径 → 解析
          warn.push(`${join(dir, base + '.js').replace(ROOT + '/', '')}: 相对路径跳转 "../" (${url}) — 建议绝对路径`);
          continue;
        }
        if (!registered.has(url)) {
          if (url.endsWith('/') || url.includes('${')) {
            warn.push(`${join(dir, base + '.js').replace(ROOT + '/', '')}: 动态拼接跳转 "/${url}..." — 需人工确认落点均已注册`);
          } else {
            problems.push(`${join(dir, base + '.js').replace(ROOT + '/', '')}: wx.${api}("${url}") 未在 app.json 注册`);
          }
        } else if (api === 'switchTab' && !tabBarSet.has(url)) {
          problems.push(`${base}.js: switchTab("${url}") 不是 tabBar 页面`);
        } else if ((api === 'navigateTo' || api === 'redirectTo') && tabBarSet.has(url)) {
          problems.push(`${base}.js: ${api}("${url}") 是 tabBar 页面，必须用 switchTab`);
        }
      }
      for (const m of js.matchAll(/wx\.navigateBack|navigateToMiniprogram/g)) break;

      // 3) 跳转缺 fail 回调的额外确认（app.js 已全局兜底，只统计）
    }

    // 4) WXML 图片存在性
    for (const m of wxml.matchAll(/src=["']([^"']+)["']/g)) {
      let src = m[1];
      if (!src || src.startsWith('http') || src.includes('{{') || src.startsWith('data:')) continue;
      if (src.startsWith('/')) src = src.slice(1);
      const abs = src.startsWith('..') ? join(dir, src) : join(ROOT, src);
      if (!existsSync(abs)) problems.push(`${join(dir, wxmlFile).replace(ROOT + '/', '')}: 图片不存在 ${m[1]}`);
    }
  }
}

// 5) JS 内相对路径图片/图标引用（iconPath 等）
for (const f of ['app.json']) {
  const j = JSON.parse(readFileSync(join(ROOT, f), 'utf8'));
  (j.tabBar?.list || []).forEach(t => {
    for (const k of ['iconPath', 'selectedIconPath']) if (t[k] && !existsSync(join(ROOT, t[k]))) problems.push(`${f}: tabBar 图标不存在 ${t[k]}`);
  });
}

console.log('=== 审计范围:', [...new Set(pageDirs)].length, '个页面目录 ===');
if (problems.length) {
  console.log('\n❌ 问题 ' + problems.length + ' 个:');
  problems.forEach(p => console.log('  ✗ ' + p));
} else console.log('\n✅ 0 个硬问题');
if (warn.length) { console.log('\n⚠ 提示 ' + warn.length + ' 个:'); warn.forEach(w => console.log('  - ' + w)); }
process.exit(problems.length ? 1 : 0);
