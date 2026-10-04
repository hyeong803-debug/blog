#!/usr/bin/env node
// HTML/CSS → PNG 카드 렌더러. 스마트에디터 ONE 에는 HTML 편집이 없으므로,
// 비교표·요약·장단점·점수 같은 "디자인 요소"는 HTML 로 그려 이미지로 넣는다.
// 사용: node scripts/render_cards.js drafts/<이름>.json
//   → card 블록마다 drafts/<이름>.cards/NN-<template>.png 생성 후, 초안의 card.path 를 채워 저장.
// ⚠️ 이미지는 검색엔진이 읽지 못한다 → 카드의 핵심 내용은 반드시 본문 텍스트에도 있어야 한다 (lint_shop 이 검사).
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const BRAND_FILE = path.join(ROOT, 'data', 'shop', 'brand.json');
const WIDTH = 900;

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function brand() {
  const def = { primary: '#1f6feb', accent: '#ff6b35', ink: '#1b1f24', sub: '#5b6573', bg: '#ffffff', soft: '#f3f6fb', good: '#12a150', bad: '#e5484d', blogName: '' };
  try { return { ...def, ...JSON.parse(fs.readFileSync(BRAND_FILE, 'utf8')) }; } catch { return def; }
}

function shell(B, inner, d) {
  return `<!doctype html><html><head><meta charset="utf-8">
<link rel="stylesheet" href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/static/pretendard.min.css">
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{background:transparent;word-break:keep-all;font-family:"Pretendard","Apple SD Gothic Neo","Noto Sans KR","Noto Sans CJK KR","Malgun Gothic","WenQuanYi Zen Hei",sans-serif;color:${B.ink};-webkit-font-smoothing:antialiased}
#card{width:${WIDTH}px;background:${B.bg};border-radius:28px;padding:44px 48px 36px;border:2px solid #e6ebf2}
.eyebrow{display:inline-block;font-size:18px;font-weight:700;color:${B.primary};background:${B.soft};padding:7px 14px;border-radius:999px;margin-bottom:14px}
h1{font-size:36px;line-height:1.3;font-weight:800;letter-spacing:-0.5px;margin-bottom:26px}
.foot{margin-top:24px;font-size:16px;color:${B.sub};display:flex;justify-content:space-between;gap:16px}
.row{display:flex;gap:18px;align-items:flex-start;padding:20px 0;border-top:1px solid #edf0f5}
.row:first-of-type{border-top:0}
.tag{flex:0 0 250px;word-break:keep-all;font-size:20px;font-weight:700;color:${B.sub};padding-top:4px}
.pick{font-size:27px;font-weight:800;color:${B.ink}}
.why{font-size:20px;color:${B.sub};margin-top:6px;line-height:1.45}
table{width:100%;border-collapse:separate;border-spacing:0;font-size:20px}
th,td{padding:16px 12px;text-align:center;border-bottom:1px solid #edf0f5;line-height:1.35}
th{font-size:21px;font-weight:800;background:${B.soft}}
th:first-child{border-radius:14px 0 0 0}th:last-child{border-radius:0 14px 0 0}
td:first-child,th:first-child{text-align:left;color:${B.sub};font-weight:700;width:22%}
.hl{background:#fff6f1}
th.hl{background:${B.accent};color:#fff}
.badge{display:inline-block;font-size:15px;font-weight:800;background:${B.accent};color:#fff;border-radius:8px;padding:3px 8px;margin-left:6px;vertical-align:middle}
.cols{display:flex;gap:20px}
.col{flex:1;border-radius:20px;padding:24px 24px 18px;background:${B.soft}}
.col h2{font-size:24px;font-weight:800;margin-bottom:14px}
.col.good h2{color:${B.good}}.col.bad h2{color:${B.bad}}
.col li{list-style:none;font-size:20px;line-height:1.45;padding:7px 0 7px 30px;position:relative}
.col.good li:before{content:"✓";position:absolute;left:0;color:${B.good};font-weight:900}
.col.bad li:before{content:"!";position:absolute;left:6px;color:${B.bad};font-weight:900}
.num{flex:0 0 52px;height:52px;border-radius:16px;background:${B.primary};color:#fff;font-size:26px;font-weight:800;display:flex;align-items:center;justify-content:center}
.bar{height:22px;border-radius:999px;background:#edf0f5;overflow:hidden;flex:1}
.fill{height:100%;border-radius:999px}
.stat{display:flex;align-items:center;gap:16px;padding:12px 0}
.stat .lb{flex:0 0 260px;font-size:21px;font-weight:700}
.stat .ct{flex:0 0 120px;text-align:right;font-size:20px;font-weight:800;color:${B.sub}}
.cta{display:flex;align-items:center;justify-content:center;gap:14px;background:${B.accent};color:#fff;border-radius:22px;padding:30px;font-size:34px;font-weight:900;letter-spacing:-0.5px}
.cta small{display:block;font-size:19px;font-weight:600;opacity:.92;margin-top:6px;text-align:center}
</style></head><body><div id="card">${inner}
<div class="foot"><span>${esc(d.note || '')}</span><span>${esc(B.blogName || '')}</span></div></div></body></html>`;
}

const T = {
  // 상황별 결론: { title, rows: [{ situation, pick, why }] }
  summary: (d) => `<span class="eyebrow">${esc(d.eyebrow || '바쁘면 이것만')}</span><h1>${esc(d.title)}</h1>
    ${(d.rows || []).map((r) => `<div class="row"><div class="tag">${esc(r.situation)}</div><div><div class="pick">${esc(r.pick)}</div><div class="why">${esc(r.why || '')}</div></div></div>`).join('')}`,

  // 비교표: { title, products: ["A","B","C"], highlight: 1, badge: "추천", rows: [{ label, values: [...] }] }
  compare: (d) => `<span class="eyebrow">${esc(d.eyebrow || '한눈에 비교')}</span><h1>${esc(d.title)}</h1>
    <table><thead><tr><th></th>${(d.products || []).map((p, i) => `<th class="${i === d.highlight ? 'hl' : ''}">${esc(p)}${i === d.highlight && d.badge ? `<br><span class="badge">${esc(d.badge)}</span>` : ''}</th>`).join('')}</tr></thead>
    <tbody>${(d.rows || []).map((r) => `<tr><td>${esc(r.label)}</td>${(r.values || []).map((v, i) => `<td class="${i === d.highlight ? 'hl' : ''}">${esc(v)}</td>`).join('')}</tr>`).join('')}</tbody></table>`,

  // 장단점(구매자 후기 요약): { title, pros: [], cons: [] }
  proscons: (d) => `<span class="eyebrow">${esc(d.eyebrow || '구매자 후기 요약')}</span><h1>${esc(d.title)}</h1>
    <div class="cols"><div class="col good"><h2>${esc(d.prosTitle || '좋다는 후기')}</h2><ul>${(d.pros || []).map((x) => `<li>${esc(x)}</li>`).join('')}</ul></div>
    <div class="col bad"><h2>${esc(d.consTitle || '아쉽다는 후기')}</h2><ul>${(d.cons || []).map((x) => `<li>${esc(x)}</li>`).join('')}</ul></div></div>`,

  // 고르는 기준: { title, items: [{ head, desc }] }
  criteria: (d) => `<span class="eyebrow">${esc(d.eyebrow || '사기 전에 체크')}</span><h1>${esc(d.title)}</h1>
    ${(d.items || []).map((it, i) => `<div class="row"><div class="num">${i + 1}</div><div><div class="pick" style="font-size:25px">${esc(it.head)}</div><div class="why">${esc(it.desc || '')}</div></div></div>`).join('')}`,

  // 후기 통계: { title, total, stats: [{ label, count, tone: "pos"|"neg" }] }
  reviewstats: (d) => {
    const B = brand();
    const max = Math.max(1, ...(d.stats || []).map((s) => s.count));
    return `<span class="eyebrow">${esc(d.eyebrow || `후기 ${d.total ?? ''}개 분석`)}</span><h1>${esc(d.title)}</h1>
    ${(d.stats || []).map((s) => `<div class="stat"><div class="lb">${esc(s.label)}</div><div class="bar"><div class="fill" style="width:${(s.count / max) * 100}%;background:${s.tone === 'neg' ? B.bad : B.good}"></div></div><div class="ct">${esc(s.count)}건</div></div>`).join('')}`;
  },

  // 점수(주관 평가 — 근거 명시): { title, items: [{ label, score, max }] }
  score: (d) => {
    const B = brand();
    return `<span class="eyebrow">${esc(d.eyebrow || '후기 기반 평가')}</span><h1>${esc(d.title)}</h1>
    ${(d.items || []).map((s) => `<div class="stat"><div class="lb">${esc(s.label)}</div><div class="bar"><div class="fill" style="width:${(s.score / (s.max || 5)) * 100}%;background:${B.primary}"></div></div><div class="ct">${esc(s.score)} / ${esc(s.max || 5)}</div></div>`).join('')}`;
  },

  // CTA 배너 (바로 아래에 링크 카드를 둔다): { text, sub }
  cta: (d) => `<div class="cta"><div>${esc(d.text || '가격·후기 확인하기')} →<small>${esc(d.sub || '아래 링크에서 확인하세요')}</small></div></div>`,
};

(async () => {
  const draftPath = process.argv[2];
  if (!draftPath) { console.error('사용: node scripts/render_cards.js drafts/<이름>.json'); process.exit(1); }
  const abs = path.resolve(ROOT, draftPath);
  const draft = JSON.parse(fs.readFileSync(abs, 'utf8'));
  const name = path.basename(abs).replace(/\.json$/, '');
  const outDir = path.join(ROOT, 'drafts', `${name}.cards`);
  fs.mkdirSync(outDir, { recursive: true });
  const B = brand();

  const { chromium } = require('playwright');
  const opts = { headless: true };
  if (process.env.PW_CHROMIUM_PATH) opts.executablePath = process.env.PW_CHROMIUM_PATH;
  const browser = await chromium.launch(opts);
  const page = await browser.newPage({ viewport: { width: WIDTH + 40, height: 800 }, deviceScaleFactor: 2 });

  let n = 0;
  for (let i = 0; i < draft.blocks.length; i++) {
    const b = draft.blocks[i];
    if (b.type !== 'card') continue;
    const tpl = T[b.template];
    if (!tpl) { console.error(`✗ blocks[${i}] 알 수 없는 template: ${b.template} (${Object.keys(T).join(', ')})`); process.exitCode = 1; continue; }
    const html = shell(B, tpl(b.data || {}), b.data || {});
    await page.setContent(html, { waitUntil: 'networkidle', timeout: 8000 }).catch(() => page.setContent(html)); // 오프라인이면 시스템 폰트
    await page.evaluate(() => document.fonts && document.fonts.ready);
    const file = path.join(outDir, `${String(i).padStart(2, '0')}-${b.template}.png`);
    await page.locator('#card').screenshot({ path: file, omitBackground: true });
    b.path = path.relative(ROOT, file);
    n++;
    console.log(`✓ ${b.path}`);
  }
  await browser.close();
  fs.writeFileSync(abs, JSON.stringify(draft, null, 2) + '\n');
  console.log(`\n카드 ${n}장 렌더 → ${path.relative(ROOT, outDir)}/ (초안 card.path 갱신됨)`);
  console.log('※ 렌더된 PNG 를 Read 로 열어 글자 잘림·줄바꿈·색을 확인할 것.');
})().catch((e) => { console.error(e); process.exit(1); });
