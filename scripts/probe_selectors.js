#!/usr/bin/env node
// 셀렉터 진단용 DOM 덤프 — 읽기 전용. 글 내용을 입력하거나 저장하지 않는다.
// 사용:
//   node scripts/probe_selectors.js [--blog shop]         # 에디터 기본 덤프
//   node scripts/probe_selectors.js --open ".se-map-toolbar-button"   # 팝업을 열어 그 DOM 까지 덤프(문서 내용은 바꾸지 않음)
//   node scripts/probe_selectors.js --find "추가"          # 해당 텍스트를 가진 요소 위치/클래스 덤프
// 결과: logs/probe-<시각>.json / .html
'use strict';

const fs = require('fs');
const path = require('path');
const {
  launchContext, WRITE_URL, LOG_DIR, sleep, ensureDir, timestamp, isLoginUrl,
  installPublishGuard, verifyPublishGuard, getEditorFrame, dismissEntryPopups, PUBLISH_BTN_SELECTOR,
} = require('./lib/common');

const KNOWN = {
  title: '.se-title-text',
  bodyParagraph: '.se-section-text p.se-text-paragraph',
  draftPopupCancel: '.se-popup-button-cancel',
  helpClose: '.se-help-panel-close-button',
  imageBtn: 'button.se-image-toolbar-button',
  videoBtn: 'button.se-video-toolbar-button',
  mapBtn: 'button.se-map-toolbar-button',
  quoteBtn: '.se-insert-quotation-default-toolbar-button',
  dividerBtn: '.se-insert-horizontal-line-default-toolbar-button',
  formatBtn: '.se-text-format-toolbar-button',
  fontSizeBtn: '[class*="se-font-size-code-toolbar-button"], [class*="se-font-size-code-toobar-button"]',
  saveBtn: 'button[class*="save_btn"]',
  publishOpenBtn: 'button[class*="publish_btn"]',
  publishFinalBtn: PUBLISH_BTN_SELECTOR,
  tagInput: 'input#tag-input',
  videoPopup: '.se-popup-video-upload',
  videoAppend: 'button.nvu_btn_append.nvu_local',
  videoClose: 'button.nvu_btn_close',
};

function arg(name) {
  const i = process.argv.indexOf(name);
  return i > -1 ? process.argv[i + 1] : null;
}

(async () => {
  ensureDir(LOG_DIR);
  const openSel = arg('--open');
  const findText = arg('--find');
  const context = await launchContext({ blog: require('./lib/common').blogArg() });
  const page = context.pages()[0] || (await context.newPage());
  await installPublishGuard(context, page);
  await page.goto(WRITE_URL, { waitUntil: 'domcontentloaded' });
  await sleep(3000);
  if (isLoginUrl(page.url())) {
    console.error('✗ 로그인 필요 — /setup-login (node scripts/naver_login.js) 먼저 실행');
    await context.close();
    process.exit(1);
  }
  const frame = await getEditorFrame(page);
  await installPublishGuard(context, page);
  console.log('가드 설치 확인:', await verifyPublishGuard(frame));
  await dismissEntryPopups(frame, console.log);

  if (openSel) {
    const btn = frame.locator(openSel).first();
    if (await btn.count()) {
      await btn.click().catch((e) => console.log('open 클릭 실패:', e.message.split('\n')[0]));
      await sleep(2000);
    } else console.log('open 대상 없음:', openSel);
  }

  const dump = await frame.evaluate(({ KNOWN, findText }) => {
    const desc = (el) => {
      const r = el.getBoundingClientRect();
      return {
        tag: el.tagName.toLowerCase(),
        id: el.id || undefined,
        cls: (typeof el.className === 'string' ? el.className : '') || undefined,
        testid: el.getAttribute('data-testid') || undefined,
        name: el.getAttribute('name') || undefined,
        type: el.getAttribute('type') || undefined,
        placeholder: el.getAttribute('placeholder') || undefined,
        aria: el.getAttribute('aria-label') || undefined,
        text: (el.innerText || el.value || '').trim().slice(0, 40) || undefined,
        visible: r.width > 0 && r.height > 0,
        disabled: el.disabled || undefined,
      };
    };
    const known = {};
    for (const [k, sel] of Object.entries(KNOWN)) {
      const els = [...document.querySelectorAll(sel)];
      known[k] = { selector: sel, count: els.length, first: els[0] ? desc(els[0]) : null };
    }
    const buttons = [...document.querySelectorAll('button')].map(desc);
    const inputs = [...document.querySelectorAll('input, textarea, [contenteditable="true"]')].map(desc);
    const popups = [...document.querySelectorAll('[class*="se-popup"], [class*="layer"], [role="dialog"]')]
      .filter((el) => el.getBoundingClientRect().width > 0)
      .map(desc);
    const components = [...document.querySelectorAll('.se-component')].map((el) => ({
      cls: el.className, text: (el.innerText || '').trim().slice(0, 60),
    }));
    const found = findText
      ? [...document.querySelectorAll('body *')]
          .filter((el) => el.children.length === 0 && (el.innerText || '').includes(findText))
          .map((el) => ({ ...desc(el), parent: desc(el.parentElement) }))
      : undefined;
    return { url: location.href, known, buttons, inputs, popups, components, found };
  }, { KNOWN, findText });

  const top = await page.evaluate(() =>
    [...document.querySelectorAll('iframe')].map((f) => ({ id: f.id, name: f.name, src: f.src }))
  );
  dump.topFrames = top;

  const ts = timestamp();
  const jsonPath = path.join(LOG_DIR, `probe-${ts}.json`);
  const htmlPath = path.join(LOG_DIR, `probe-${ts}.html`);
  fs.writeFileSync(jsonPath, JSON.stringify(dump, null, 2));
  fs.writeFileSync(htmlPath, await frame.content());

  console.log('\n=== 알려진 셀렉터 실측 ===');
  for (const [k, v] of Object.entries(dump.known)) {
    console.log(`${v.count ? '✓' : '✗'} ${k.padEnd(16)} ${String(v.count).padStart(3)}개  ${v.selector}`);
  }
  console.log(`\n덤프: ${path.relative(process.cwd(), jsonPath)}\nHTML: ${path.relative(process.cwd(), htmlPath)}`);
  console.log('※ 읽기 전용. 아무것도 저장하지 않고 종료합니다. (창을 열어두려면 --keep)');
  if (!process.argv.includes('--keep')) await context.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
