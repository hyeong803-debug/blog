#!/usr/bin/env node
// 발행 차단 가드 자가 테스트 — 네이버에 접속하지 않고, 가짜 에디터 페이지(iframe#mainFrame 구조)로 검증한다.
// 사용: node scripts/test_guard.js   (headless)
'use strict';

const { chromium } = require('playwright');
const C = require('./lib/common');

const TOP = `<!doctype html><html><body><iframe id="mainFrame" name="mainFrame" src="https://blog.naver.com/mock-editor" style="width:1200px;height:800px"></iframe></body></html>`;
const EDITOR = `<!doctype html><html><body>
<div class="se-content"><div class="se-title-text"><p class="se-text-paragraph"></p></div></div>
<button class="publish_btn__abc" id="open">발행</button>
<div id="panel"></div>
<script>
  window.published = 0; window.opened = 0;
  document.getElementById('open').addEventListener('click', () => {
    window.opened++;
    // 패널은 나중에 동적으로 생성됨 (실제 에디터처럼)
    document.getElementById('panel').innerHTML = '<input id="tag-input"><button data-testid="seOnePublishBtn" class="confirm_btn"><span>발행</span></button>';
    document.querySelector('[data-testid="seOnePublishBtn"]').addEventListener('click', () => window.published++);
  });
  // 페이지 쪽 캡처 리스너도 가드보다 늦게 등록됨
  window.addEventListener('click', (e) => { if (e.target.closest('[data-testid="seOnePublishBtn"]')) window.published++; }, true);
</script></body></html>`;

(async () => {
  const opts = { headless: true };
  if (process.env.PW_CHROMIUM_PATH) opts.executablePath = process.env.PW_CHROMIUM_PATH;
  const browser = await chromium.launch(opts);
  const context = await browser.newContext({ viewport: C.VIEWPORT });
  await context.route('https://blog.naver.com/**', (route) => {
    const html = route.request().url().includes('mock-editor') ? EDITOR : TOP;
    route.fulfill({ contentType: 'text/html; charset=utf-8', body: html });
  });
  const page = await context.newPage();
  await C.installPublishGuard(context, page);
  await page.goto('https://blog.naver.com/GoBlogWrite.naver');
  const frame = await C.getEditorFrame(page, 10000);
  await C.installPublishGuard(context, page);

  const checks = [];
  const check = (name, cond) => { checks.push([name, !!cond]); };

  check('에디터 프레임 = iframe#mainFrame', frame !== page.mainFrame());
  check('가드 설치 확인 (프레임 내부)', await C.verifyPublishGuard(frame));

  await frame.click('#open'); // 패널 열기 버튼은 정상 동작해야 함
  check('패널 열기 버튼은 정상 동작', (await frame.evaluate(() => window.opened)) === 1);

  const pub = frame.locator(C.PUBLISH_BTN_SELECTOR);
  await pub.click({ force: true }).catch(() => {});
  await pub.locator('span').click({ force: true }).catch(() => {});
  await pub.evaluate((el) => el.click());
  await pub.focus();
  await page.keyboard.press('Enter');
  await page.keyboard.press(' ');
  await pub.dispatchEvent('click');
  check('발행 버튼 실제 클릭 6종 모두 차단 (published === 0)', (await frame.evaluate(() => window.published)) === 0);
  check('차단 횟수 기록됨', (await frame.evaluate(() => window.__publishBlockedCount || 0)) > 0);

  let threw = false;
  try { await C.assertNotPublishButton(pub); } catch { threw = true; }
  check('자동화 코드의 발행 버튼 클릭 시도 → 예외로 중단', threw);

  // 새로고침 후에도 initScript 로 재설치되는지
  await page.reload();
  const f2 = await C.getEditorFrame(page, 10000);
  check('새로고침 후에도 가드 자동 재설치', await C.verifyPublishGuard(f2));

  await browser.close();
  let fail = 0;
  for (const [n, ok] of checks) {
    console.log(`${ok ? '✓' : '✗'} ${n}`);
    if (!ok) fail++;
  }
  console.log(fail ? `\n✗ 가드 테스트 실패 ${fail}건` : '\n✓ 발행 차단 가드 테스트 전부 통과');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
