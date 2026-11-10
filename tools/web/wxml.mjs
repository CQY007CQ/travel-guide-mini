// tools/web/wxml.mjs —— WXML → 浏览器渲染函数编译器
//
// 为什么要编译而不是手抄：小程序有 17 个页面、约 135KB WXML。手抄一遍等于把
// 界面维护成两份，必然漂移。这里把 WXML 直接编译成 h() 调用，小程序改完 WXML
// 只要重跑构建，网页端自动跟上 —— 这才是「和小程序共同推进」。
//
// 支持的语法（与项目实际用法一一对应）：
//   {{expr}} 插值（文本 / 属性 / class 混合拼接）
//   wx:if / wx:elif / wx:else        条件链
//   wx:for / wx:for-item / wx:for-index / wx:key   循环
//   bind*/catch* 事件（tap→click、input、change、confirm、longpress、scrolltolower…）
//   <block> 无容器分组、data-* 数据集
// 组件映射：view→div, text→span, image→img, scroll-view→div, picker→select/input,
//   switch/checkbox/radio→input, canvas→canvas, map→占位（网页端无地图 SDK）
//
// 输出：__TPL[页面路径] = function(__h, __c, __t, __d) { with(__d){ return ... } }

const VOID_TAGS = new Set(["img", "input", "br", "hr"]);

/** 组件 → HTML 标签 */
const TAG_MAP = {
  view: "div", text: "span", image: "img", block: null,
  "scroll-view": "div", "swiper": "div", "swiper-item": "div",
  navigator: "a", label: "label", form: "form",
  button: "button", input: "input", textarea: "textarea",
  picker: "select", switch: "input", checkbox: "input", radio: "input",
  slider: "input", "rich-text": "div", canvas: "canvas", map: "div",
  video: "video", "cover-view": "div", "cover-image": "img", slot: null,
};

/** 事件名 → 浏览器事件类型 */
const EVT_MAP = {
  tap: "click", input: "input", change: "change", confirm: "keydown",
  blur: "blur", focus: "focus", longpress: "contextmenu", longtap: "contextmenu",
  scroll: "scroll", scrolltolower: "scroll", touchstart: "touchstart",
  touchmove: "touchmove", touchend: "touchend", touchcancel: "touchcancel",
  submit: "submit", reset: "reset",
  // 原生 map 组件事件：网页端不是 addEventListener 派发，由 runtime 的 SVG 示意图
  // 点击委托读 __ev["on:markertap"] 还原 markerId（见 runtime.js __h 的 the-map 分支）
  markertap: "markertap", callouttap: "callouttap",
};

/* ────────────────────────────── 解析 ────────────────────────────── */

/**
 * 把 WXML 源码解析成节点树。
 * 节点：{type:"el", tag, attrs:[{name,value}], children:[]} / {type:"text", text}
 */
export function parse(src) {
  let i = 0;
  const root = { type: "el", tag: "#root", attrs: [], children: [] };
  const stack = [root];
  const top = () => stack[stack.length - 1];

  while (i < src.length) {
    // 注释
    if (src.startsWith("<!--", i)) {
      const j = src.indexOf("-->", i + 4);
      i = j < 0 ? src.length : j + 3;
      continue;
    }
    // 结束标签
    if (src[i] === "<" && src[i + 1] === "/") {
      const j = src.indexOf(">", i);
      const tag = src.slice(i + 2, j).trim();
      // 弹栈到同名标签
      for (let k = stack.length - 1; k > 0; k--) {
        if (stack[k].tag === tag) { stack.length = k; break; }
      }
      i = j + 1;
      continue;
    }
    // 开始标签
    if (src[i] === "<") {
      let j = i + 1, quote = null;
      // 找到标签结束的 >（跳过引号内的 >）
      for (; j < src.length; j++) {
        const c = src[j];
        if (quote) { if (c === quote) quote = null; continue; }
        if (c === '"' || c === "'") { quote = c; continue; }
        if (c === ">") break;
      }
      const raw = src.slice(i + 1, j);
      const selfClose = /\/\s*$/.test(raw);
      const body = raw.replace(/\/\s*$/, "");
      const m = body.match(/^([a-zA-Z][\w:-]*)/);
      if (!m) { i = j + 1; continue; }
      const tag = m[1];
      const attrs = parseAttrs(body.slice(tag.length));
      const el = { type: "el", tag, attrs, children: [] };
      top().children.push(el);
      if (!selfClose && !VOID_TAGS.has(TAG_MAP[tag] || tag)) stack.push(el);
      i = j + 1;
      continue;
    }
    // 文本
    const next = src.indexOf("<", i);
    const text = next < 0 ? src.slice(i) : src.slice(i, next);
    if (text) {
      // 连续空白折叠成一个空格（WXML 里换行缩进不应产生空文本节点）
      const t = text.replace(/\s+/g, " ");
      if (t.trim() || /\{\{/.test(t)) top().children.push({ type: "text", text: t });
    }
    i = next < 0 ? src.length : next;
  }
  return root.children;
}

function parseAttrs(s) {
  const out = [];
  const re = /([a-zA-Z_:@][\w:.-]*)(?:\s*=\s*"([^"]*)"|\s*=\s*'([^']*)')?/g;
  let m;
  while ((m = re.exec(s))) {
    out.push({ name: m[1], value: m[2] !== undefined ? m[2] : (m[3] !== undefined ? m[3] : "") });
  }
  return out;
}

/* ────────────────────────────── 表达式 ────────────────────────────── */

/**
 * 把含 {{}} 的字符串编译成 JS 表达式。
 * "a{{b}}c" → ("a"+((b))+"c")；纯 "{{x}}" → ((x))
 */
function compileMixed(raw, forText) {
  if (raw == null) return '""';
  const parts = [];
  let i = 0;
  while (i < raw.length) {
    const s = raw.indexOf("{{", i);
    if (s < 0) { parts.push(JSON.stringify(raw.slice(i))); break; }
    if (s > i) parts.push(JSON.stringify(raw.slice(i, s)));
    const e = raw.indexOf("}}", s + 2);
    if (e < 0) { parts.push(JSON.stringify(raw.slice(s))); break; }
    const expr = raw.slice(s + 2, e).trim();
    parts.push("(" + (safeMembers(expr) || '""') + ")");
    i = e + 2;
  }
  if (!parts.length) return '""';
  if (parts.length === 1) return parts[0];
  return "(" + parts.join("+") + ")";
}

/**
 * 成员访问转安全访问：a.b.c → __m(a,"b","c")
 *
 * 为什么必须做：WXML 的表达式求值是容错的 —— {{list.length}} 在 list 为 undefined
 * 时返回 undefined；而编译成 JS 后是 TypeError: Cannot read properties of undefined。
 * 实测 17 个页面里 index/plan/more 都会踩到。__m 逐级判空，语义与 WXML 对齐。
 *
 * 保守起见只转换「纯点访问链」，且后面不跟 ( （函数调用）：a.b() 保持原样，
 * 因为 __m(a,"b")() 会丢掉 this。
 * 字符串字面量内部不处理（先按引号切分）。
 */
const CHAIN_RE = /(^|[^\w$.'"`])([A-Za-z_$][\w$]*)((?:\.[A-Za-z_$][\w$]*)+)(?!\s*\()/g;
function safeMembers(expr) {
  if (!expr) return expr;
  const segs = expr.split(/('(?:\\.|[^'\\])*'|"(?:\\.|[^"\\])*"|`(?:\\.|[^`\\])*`)/);
  return segs.map((s, i) => (i % 2 === 1 ? s : rewriteChains(s))).join("");
}

/**
 * 扫描表达式，把「标识符 + .prop / [expr] 链」改写为 __m(root, ...path)。
 * 用扫描器而不是正则：下标里可能嵌套括号（obj[list[0]]），正则处理不了。
 * 链后面紧跟 ( 时不改写（函数调用会丢 this）。
 */
function rewriteChains(s) {
  let out = "";
  let i = 0;
  const isIdStart = (c) => /[A-Za-z_$]/.test(c || "");
  const isIdBody = (c) => /[\w$]/.test(c || "");
  while (i < s.length) {
    const c = s[i];
    if (!isIdStart(c)) { out += c; i++; continue; }
    // 前一个输出字符是 . 说明这是别人的属性名，跳过
    if (out.endsWith(".")) { out += c; i++; continue; }
    let j = i;
    while (j < s.length && isIdBody(s[j])) j++;
    const root = s.slice(i, j);
    const keys = [];
    let k = j, broken = false;
    while (k < s.length) {
      if (s[k] === "." && isIdStart(s[k + 1])) {
        let m = k + 1;
        while (m < s.length && isIdBody(s[m])) m++;
        keys.push(JSON.stringify(s.slice(k + 1, m)));
        k = m;
        continue;
      }
      if (s[k] === "[") {
        let depth = 1, m = k + 1;
        while (m < s.length && depth > 0) {
          if (s[m] === "[") depth++;
          else if (s[m] === "]") { depth--; if (depth === 0) break; }
          m++;
        }
        if (depth !== 0) { broken = true; break; }
        keys.push("(" + s.slice(k + 1, m).trim() + ")");
        k = m + 1;
        continue;
      }
      break;
    }
    if (broken || !keys.length || s[k] === "(") { out += root; i = j; continue; }
    out += "__m(" + root + "," + keys.join(",") + ")";
    i = k;
  }
  return out;
}

/** 属性值里是否含插值 */
const hasMustache = (v) => typeof v === "string" && v.indexOf("{{") >= 0;

/* ────────────────────────────── 编译 ────────────────────────────── */

const ATTR_SKIP = new Set(["wx:if", "wx:elif", "wx:else", "wx:for", "wx:for-item", "wx:for-index", "wx:key"]);

/**
 * 编译节点数组 → JS 表达式（返回节点或节点数组）。
 */
function compileChildren(nodes) {
  const out = [];
  let i = 0;
  while (i < nodes.length) {
    const n = nodes[i];
    const attrs = n.type === "el" ? attrMap(n.attrs) : {};

    // 条件链：wx:if … wx:elif … wx:else
    if (attrs["wx:if"] !== undefined) {
      const chain = [];
      chain.push({ cond: attrs["wx:if"], node: n });
      let k = i + 1;
      while (k < nodes.length && nodes[k].type === "el") {
        const a = attrMap(nodes[k].attrs);
        if (a["wx:elif"] !== undefined) { chain.push({ cond: a["wx:elif"], node: nodes[k] }); k++; continue; }
        if (a["wx:else"] !== undefined) { chain.push({ cond: null, node: nodes[k] }); k++; }
        break;
      }
      out.push(buildChain(chain));
      i = k;
      continue;
    }
    out.push(compileNode(n));
    i++;
  }
  if (!out.length) return "null";
  return "__c(" + out.join(",") + ")";
}

/** wx:if / elif / else → 嵌套三元 */
function buildChain(chain) {
  let expr = "null";
  for (let k = chain.length - 1; k >= 0; k--) {
    const { cond, node } = chain[k];
    const body = compileNode(node);
    expr = cond === null ? body : "(" + compileMixed(cond) + ") ? " + body + " : " + expr;
  }
  return expr;
}

function attrMap(attrs) {
  const m = {};
  for (const a of attrs) m[a.name] = a.value;
  return m;
}

/** 单个元素 → JS 表达式 */
function compileNode(n) {
  if (n.type === "text") {
    const t = n.text;
    if (!hasMustache(t)) return JSON.stringify(t);
    return "__t(" + compileMixed(t) + ")";
  }
  const attrs = attrMap(n.attrs);

  // wx:for 优先于其他属性
  if (attrs["wx:for"] !== undefined) {
    const listExpr = compileMixed(attrs["wx:for"]);
    const itemName = attrs["wx:for-item"] || "item";
    const idxName = attrs["wx:for-index"] || "index";
    // 复制一份去掉 wx:for*，避免递归时再次展开
    const clone = { type: "el", tag: n.tag, attrs: n.attrs.filter((a) => !/^wx:(for|if|elif|else|key)/.test(a.name)), children: n.children };
    // 循环体内再次取条件属性
    const inner = compileNode(clone);
    return "(__c(" + listExpr + ")||[]).map(function(" + itemName + "," + idxName + "){ return " + inner + "; })";
  }

  const htmlTag = TAG_MAP[n.tag] === undefined ? "div" : TAG_MAP[n.tag];

  // <block> / <slot> 等无容器标签：只渲染子节点
  if (htmlTag === null) return compileChildren(n.children);

  const props = {};
  const events = {};
  const dataset = {};
  const extra = [];

  for (const a of n.attrs) {
    const name = a.name;
    if (ATTR_SKIP.has(name)) continue;

    // 事件绑定
    const evm = name.match(/^(bind|catch|capture-bind|capture-catch|mut-bind):?(.+)$/);
    if (evm) {
      const kind = evm[1];
      const evt = evm[2];
      const handler = a.value.trim();
      if (!/^[A-Za-z_$][\w$]*$/.test(handler)) continue;
      const domEvt = EVT_MAP[evt] || evt;
      const key = (kind.indexOf("catch") >= 0 ? "catch:" : "on:") + domEvt;
      events[key] = handler;
      continue;
    }

    // data-* 数据集
    if (/^data-/.test(name)) {
      const k = name.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase());
      dataset[k] = hasMustache(a.value) ? compileMixed(a.value) : JSON.stringify(a.value);
      continue;
    }

    if (name === "class") { props.class = compileMixed(a.value); continue; }
    if (name === "style") { props.style = compileMixed(a.value); continue; }
    if (name === "src") { props.src = hasMustache(a.value) ? compileMixed(a.value) : JSON.stringify(a.value); continue; }
    if (name === "id") { props.id = compileMixed(a.value); continue; }

    // 其余属性：布尔属性若含插值则条件设置
    const key = attrName(name, htmlTag);
    if (key === null) continue;
    if (hasMustache(a.value)) {
      extra.push([key, compileMixed(a.value)]);
    } else if (a.value === "" || a.value === name) {
      props[key] = "true";
    } else {
      props[key] = JSON.stringify(a.value);
    }
  }

  const propPairs = Object.entries(props).map(([k, v]) => JSON.stringify(k) + ":" + v);
  for (const [k, v] of extra) propPairs.push(JSON.stringify(k) + ":" + v);
  if (Object.keys(dataset).length) {
    propPairs.push('"__ds":{' + Object.entries(dataset).map(([k, v]) => JSON.stringify(k) + ":" + v).join(",") + "}");
  }
  if (Object.keys(events).length) {
    propPairs.push('"__ev":{' + Object.entries(events).map(([k, v]) => JSON.stringify(k) + ":" + JSON.stringify(v)).join(",") + "}");
  }

  // <navigator url="/xxx"> → <a href="#/xxx">：网页端不必依赖 JS 才能跳转，
  // 且搜索引擎/新标签页打开都能落到正确的 hash 路由。
  if (n.tag === "navigator" && attrs.url !== undefined) {
    propPairs.push('"href":("#/"+String(' + compileMixed(String(attrs.url)) + ').replace(/^\\//,""))');
  }

  const children = n.children.length ? compileChildren(n.children) : "null";
  let call = "__h(" + JSON.stringify(htmlTag === undefined ? "div" : htmlTag) + ",{" + propPairs.join(",") + "}," + children + ")";
  // picker 特殊：把 range / value / start / end 的真实表达式交给运行时的 __pick，
  // 由它生成 option 或原生 date input（旧版传的是 "{{depart}}" 字面量 + 空 select）。
  if (n.tag === "picker") {
    const mode = attrs.mode || "selector";
    const expr = (k, dflt) => (attrs[k] !== undefined ? compileMixed(String(attrs[k])) : dflt);
    call = "__pick(" + JSON.stringify(mode) + "," + expr("value", '""') + "," + call + "," +
      expr("range", "null") + "," + JSON.stringify(attrs["range-key"] || "") + "," +
      expr("start", "null") + "," + expr("end", "null") + ")";
  }
  return call;
}

/** 属性名映射：WXML 属性 → HTML 属性 / 组件行为 */
function attrName(name, htmlTag) {
  if (name === "placeholder" || name === "value" || name === "disabled" || name === "maxlength") return name;
  if (name === "placeholder-class" || name === "hover-class" || name === "hover-start-time"
    || name === "hover-stay-time" || name === "open-type" || name === "scroll-y" || name === "scroll-x"
    || name === "enable-flex" || name === "show-scrollbar" || name === "refresher-enabled"
    || name === "scroll-top" || name === "scroll-into-view" || name === "mode" || name === "type"
    || name === "password" || name === "cursor-spacing" || name === "auto-height" || name === "adjust-position"
    || name === "confirm-type" || name === "confirm-hold" || name === "show-confirm-bar"
    || name === "selection-start" || name === "selection-end" || name === "range" || name === "range-key"
    || name === "start" || name === "end" || name === "checked" || name === "color" || name === "lazy-load"
    || name === "thumb-mode" || name === "show-menu-by-longpress") {
    // 这些属性浏览器不认识，但部分需要保留语义（placeholder/value/disabled/checked/type）
    if (name === "placeholder" || name === "value" || name === "disabled" || name === "checked"
      || name === "type" || name === "maxlength" || name === "range" || name === "start" || name === "end") return name;
    return null;
  }
  if (name === "alt") return "alt";
  return name;
}

/* ────────────────────────────── 对外 ────────────────────────────── */

/**
 * 编译整页 WXML → 可执行函数源码。
 * @returns {string} function(__h,__c,__t,__d){...}
 */
export function compilePage(src, pagePath) {
  const nodes = parse(src);
  const body = compileChildren(nodes);
  return "function(__h,__c,__t,__pick,__d){\nwith(__d){\nreturn " + body + ";\n}\n}";
}
