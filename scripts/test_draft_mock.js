#!/usr/bin/env node
// naver_draft.js 로직 회귀 테스트 — 로컬 가짜 에디터로 끝까지 실행 (네이버 접속 없음).
// ⚠️ 가짜 에디터는 실제 SmartEditor DOM 과 다르다. 이 테스트 통과 = "스크립트 흐름에 런타임 버그 없음"이지
//    "네이버에서 동작함"이 아니다. 실제 셀렉터 검증은 probe_selectors.js + --dry-run 으로.
// 사용: node scripts/test_draft_mock.js
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const sharp = require('sharp');

const ROOT = path.resolve(__dirname, '..');
const PHOTO_DIR = path.join(ROOT, 'input', 'photos', '_mocktest');
const DRAFT = path.join(ROOT, 'drafts', '_mocktest.json');
const PROFILE = path.join(ROOT, 'logs', '_mock-profile');

const TOP = `<!doctype html><meta charset="utf-8"><body style="margin:0"><iframe id="mainFrame" name="mainFrame" src="/editor" style="width:1600px;height:1000px;border:0"></iframe>`;
const EDITOR = `<!doctype html><meta charset="utf-8">
<style>p{min-height:1em;margin:0}.se-component{border:1px dashed #ccc;margin:4px}#panel{display:none}#fmtopts,#sizeopts{display:none}</style>
<div class="toolbar">
  <button class="se-image-toolbar-button">사진</button>
  <button class="se-insert-quotation-default-toolbar-button">인용구</button>
  <button class="se-insert-horizontal-line-default-toolbar-button">구분선</button>
  <button class="se-text-format-toolbar-button"><span id="fmtlabel">본문</span></button>
  <div id="fmtopts"><button class="opt">본문</button><button class="opt">소제목</button></div>
  <button class="se-font-size-code-toolbar-button"><span id="sizelabel">15</span></button>
  <div id="sizeopts"><button class="se-toolbar-option-font-size-code-fs15">15</button><button class="se-toolbar-option-font-size-code-fs19">19</button></div>
  <button class="save_btn__a1b2">저장</button>
  <button class="publish_btn__c3d4">발행</button>
  <input type="file" id="file" style="display:none">
</div>
<div id="panel"><div class="tag_box"><span id="chips"></span><input id="tag-input"></div><button data-testid="seOnePublishBtn">발행</button></div>
<div class="se-content"><div class="se-components-wrap" id="wrap">
  <div class="se-component se-documentTitle"><div class="se-title-text" contenteditable="true"><p class="se-text-paragraph"></p></div></div>
</div><div class="se-canvas-bottom" style="height:40px">.</div></div>
<script>
window.published=0; window.saved=0; window.subtitles=[];
const wrap=document.getElementById('wrap');
function textComp(){const c=document.createElement('div');c.className='se-component se-text';
  c.innerHTML='<div class="se-section se-section-text"><div class="se-module se-module-text" contenteditable="true"><p class="se-text-paragraph"></p></div></div>';wrap.appendChild(c);return c;}
textComp();
function focusP(p){p.focus&&p.focus();const r=document.createRange();r.selectNodeContents(p);r.collapse(false);const s=getSelection();s.removeAllRanges();s.addRange(r);p.closest('[contenteditable]').focus();}
document.querySelector('.se-canvas-bottom').onclick=()=>{const c=textComp();focusP(c.querySelector('p'));};
document.querySelector('.se-image-toolbar-button').onclick=()=>document.getElementById('file').click();
document.getElementById('file').onchange=(e)=>{const c=document.createElement('div');c.className='se-component se-image';
  c.innerHTML='<img alt="'+e.target.files[0].name+'"><div class="se-module se-module-text se-caption" contenteditable="true"><p class="se-text-paragraph"></p></div>';
  setTimeout(()=>wrap.appendChild(c),300);e.target.value='';};
document.querySelector('.se-insert-quotation-default-toolbar-button').onclick=()=>{const c=document.createElement('div');c.className='se-component se-quotation';
  c.innerHTML='<div class="se-section se-section-quotation"><div contenteditable="true"><p class="se-text-paragraph"></p></div></div>';wrap.appendChild(c);focusP(c.querySelector('p'));};
document.querySelector('.se-insert-horizontal-line-default-toolbar-button').onclick=()=>{const c=document.createElement('div');c.className='se-component se-horizontalLine';c.innerHTML='<hr>';wrap.appendChild(c);};
document.querySelector('.se-text-format-toolbar-button').onclick=()=>{document.getElementById('fmtopts').style.display='block';};
document.querySelectorAll('#fmtopts .opt').forEach(b=>b.onclick=()=>{document.getElementById('fmtlabel').textContent=b.textContent;document.getElementById('fmtopts').style.display='none';
  const s=getSelection();const p=s.anchorNode&&(s.anchorNode.nodeType===1?s.anchorNode:s.anchorNode.parentElement).closest('p');if(p&&b.textContent==='소제목')p.dataset.fmt='subtitle';});
document.querySelector('.se-font-size-code-toolbar-button').onclick=()=>{document.getElementById('sizeopts').style.display='block';};
document.querySelectorAll('#sizeopts button').forEach(b=>b.onclick=()=>{document.getElementById('sizelabel').textContent=b.textContent;document.getElementById('sizeopts').style.display='none';});
document.querySelector('.save_btn__a1b2').onclick=()=>{window.saved++;};
document.querySelector('.publish_btn__c3d4').onclick=()=>{document.getElementById('panel').style.display='block';};
document.querySelector('[data-testid="seOnePublishBtn"]').onclick=()=>{window.published++;};
document.getElementById('tag-input').addEventListener('keydown',e=>{if(e.key==='Enter'&&e.target.value.trim()){const s=document.createElement('span');s.textContent='#'+e.target.value.trim()+' ';document.getElementById('chips').appendChild(s);e.target.value='';}});
document.addEventListener('keydown',e=>{if(e.key==='Escape')document.getElementById('panel').style.display='none';});
</script>`;

async function main() {
  fs.mkdirSync(PHOTO_DIR, { recursive: true });
  const example = JSON.parse(fs.readFileSync(path.join(ROOT, 'drafts', 'example.json'), 'utf8'));
  for (const b of example.blocks) {
    if (b.type !== 'image') continue;
    const p = path.join(PHOTO_DIR, path.basename(b.path));
    await sharp({ create: { width: 64, height: 48, channels: 3, background: '#88aacc' } }).jpeg().toFile(p);
    b.path = path.relative(ROOT, p);
  }
  fs.writeFileSync(DRAFT, JSON.stringify(example, null, 2));

  const server = http.createServer((req, res) => {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(req.url.startsWith('/editor') ? EDITOR : TOP);
  });
  await new Promise((r) => server.listen(0, r));
  const url = `http://127.0.0.1:${server.address().port}/write`;

  const run = (extra) => new Promise((resolve) => {
    const { spawn } = require('child_process');
    const p = spawn(process.execPath, [path.join(__dirname, 'naver_draft.js'), path.relative(ROOT, DRAFT), ...extra], {
      cwd: ROOT, env: { ...process.env, NAVER_WRITE_URL: url, PW_HEADLESS: '1', PW_PROFILE_DIR: PROFILE },
    });
    let out = '';
    p.stdout.on('data', (d) => (out += d));
    p.stderr.on('data', (d) => (out += d));
    p.on('close', (code) => resolve({ code, out }));
  });

  const dry = await run(['--dry-run']);
  const real = await run([]);
  server.close();

  const ok = [];
  ok.push(['dry-run 종료코드 0', dry.code === 0]);
  ok.push(['dry-run 은 저장 생략 표시', /dry-run: 저장 생략/.test(dry.out)]);
  ok.push(['실행 종료코드 0', real.code === 0]);
  ok.push(['임시저장 + 전문 대조 통과', /임시저장 \+ 전문 대조 통과/.test(real.out)]);
  ok.push(['발행 가드 활성 로그', /발행 차단 가드 활성/.test(real.out)]);
  ok.push(['태그 7개 확인', /태그 7개 확인/.test(real.out)]);
  let postDump = '';
  try { postDump = fs.readFileSync(path.join(ROOT, 'drafts', '_mocktest.verify', 'post-dump.txt'), 'utf8'); } catch {}
  ok.push(['이모지 뒤 텍스트 유실 없음', postDump.includes('끝납니다 🙂') && postDump.includes('함께 봐드립니다 📞')]);

  let fail = 0;
  for (const [n, v] of ok) { console.log(`${v ? '✓' : '✗'} ${n}`); if (!v) fail++; }
  if (fail || process.argv.includes('-v')) console.log('\n--- 실행 로그 ---\n' + real.out);

  // 정리
  fs.rmSync(PHOTO_DIR, { recursive: true, force: true });
  fs.rmSync(DRAFT, { force: true });
  fs.rmSync(path.join(ROOT, 'drafts', '_mocktest.manual.txt'), { force: true });
  if (!process.argv.includes('--keep-dump')) fs.rmSync(path.join(ROOT, 'drafts', '_mocktest.verify'), { recursive: true, force: true });
  fs.rmSync(PROFILE, { recursive: true, force: true });
  console.log(fail ? `\n✗ 모의 실행 테스트 실패 ${fail}건` : '\n✓ 모의 실행 테스트 통과 (실제 네이버 DOM 검증은 아님)');
  process.exit(fail ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
