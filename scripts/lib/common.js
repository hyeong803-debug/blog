// 공통 유틸 — 브라우저 실행, 에디터 프레임 탐색, 발행 차단 가드, 로그
// ⚠️ installPublishGuard 는 절대 규칙 2(발행 금지)의 코드 보장이다. 어떤 경우에도 제거하지 말 것.
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
// 블로그별 로그인 세션 (블로그 1개 = 네이버 아이디 1개). insurance → naver-profile/, shop → naver-profile-shop/
const BLOGS = ['insurance', 'shop'];
function profileDir(blog = 'insurance') {
  if (process.env.PW_PROFILE_DIR) return process.env.PW_PROFILE_DIR;
  if (!BLOGS.includes(blog)) throw new Error(`알 수 없는 블로그: ${blog} (${BLOGS.join(' | ')})`);
  return path.join(ROOT, blog === 'insurance' ? 'naver-profile' : `naver-profile-${blog}`);
}
/** CLI 인자 --blog <이름> */
function blogArg(argv = process.argv) {
  const i = argv.indexOf('--blog');
  return i > -1 ? argv[i + 1] : 'insurance';
}
const PROFILE_DIR = profileDir('insurance');
const LOG_DIR = path.join(ROOT, 'logs');
const WRITE_URL = process.env.NAVER_WRITE_URL || 'https://blog.naver.com/GoBlogWrite.naver'; // env 는 오프라인 모의 테스트 전용
const VIEWPORT = { width: 1680, height: 1050 }; // 1600x1000 이상 필수 (1400 이하 → 속성 툴바 잘림)

// 진짜 발행 버튼 (발행 패널 안의 최종 "발행")
const PUBLISH_BTN_SELECTOR = 'button[data-testid="seOnePublishBtn"]';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function timestamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

function makeLogger(name) {
  ensureDir(LOG_DIR);
  const file = path.join(LOG_DIR, `${name}-${timestamp()}.log`);
  const log = (...args) => {
    const line = `[${new Date().toLocaleTimeString('ko-KR', { hour12: false })}] ${args.join(' ')}`;
    console.log(line);
    fs.appendFileSync(file, line + '\n');
  };
  log.file = file;
  return log;
}

/**
 * 영구 프로필로 Chromium 실행 (세션 유지). 비밀번호는 저장/입력하지 않는다.
 * PW_CHROMIUM_PATH 환경변수가 있으면 해당 실행 파일 사용.
 */
async function launchContext({ headless = process.env.PW_HEADLESS === '1', blog = 'insurance' } = {}) {
  const { chromium } = require('playwright');
  const dir = ensureDir(profileDir(blog));
  const opts = {
    headless,
    viewport: VIEWPORT,
    locale: 'ko-KR',
    args: [`--window-size=${VIEWPORT.width},${VIEWPORT.height + 120}`],
  };
  if (process.env.PW_CHROMIUM_PATH) opts.executablePath = process.env.PW_CHROMIUM_PATH;
  const context = await chromium.launchPersistentContext(dir, opts);
  return context;
}

/**
 * 발행 차단 가드 — 브라우저 안에서 실행되는 함수 (addInitScript / evaluate 양쪽에서 사용).
 * 캡처 단계에서 window 에 리스너를 걸어, 진짜 발행 버튼으로 향하는
 * 모든 포인터/클릭/키보드 이벤트를 페이지 스크립트보다 먼저 가로채 폐기한다.
 */
function publishGuardSource(selector) {
  if (window.__publishGuardInstalled) return 'already';
  const isPublish = (ev) => {
    const path = typeof ev.composedPath === 'function' ? ev.composedPath() : [ev.target];
    for (const n of path) {
      if (n && n.nodeType === 1 && typeof n.matches === 'function') {
        if (n.matches(selector) || (n.closest && n.closest(selector))) return true;
      }
    }
    return false;
  };
  const block = (ev) => {
    if (ev.type === 'keydown' && ev.key !== 'Enter' && ev.key !== ' ') return;
    if (!isPublish(ev)) return;
    ev.preventDefault();
    ev.stopImmediatePropagation();
    ev.stopPropagation();
    window.__publishBlockedCount = (window.__publishBlockedCount || 0) + 1;
    try { console.warn('[PUBLISH-GUARD] 발행 버튼 클릭 차단됨 (' + ev.type + ')'); } catch (e) {}
  };
  for (const t of ['pointerdown', 'pointerup', 'mousedown', 'mouseup', 'click', 'dblclick', 'auxclick', 'touchstart', 'touchend', 'keydown', 'keyup', 'submit']) {
    window.addEventListener(t, block, { capture: true });
  }
  window.__publishGuardInstalled = true;
  return 'installed';
}

/**
 * 가드 설치: (1) 이후 로드되는 모든 문서/프레임에 initScript 로, (2) 이미 열린 모든 프레임에 즉시.
 * 반드시 에디터 로드 직후, 어떤 클릭보다 먼저 호출한다.
 */
async function installPublishGuard(context, page) {
  if (!context.__guardInit) {
    await context.addInitScript(publishGuardSource, PUBLISH_BTN_SELECTOR);
    context.__guardInit = true;
  }
  const results = [];
  for (const f of page.frames()) {
    try {
      results.push(await f.evaluate(publishGuardSource, PUBLISH_BTN_SELECTOR));
    } catch (e) {
      results.push('err:' + e.message.split('\n')[0]);
    }
  }
  return results;
}

/** 에디터 프레임 안에 가드가 실제로 설치됐는지 검증 (했다 ≠ 됐다) */
async function verifyPublishGuard(frame) {
  return frame.evaluate(() => window.__publishGuardInstalled === true);
}

/** 코드 레벨 이중 안전장치: 자동화 코드가 발행 버튼을 직접 클릭하려 하면 즉시 중단 */
async function assertNotPublishButton(locator) {
  const bad = await locator.evaluate((el, sel) => !!(el.matches(sel) || el.closest(sel)), PUBLISH_BTN_SELECTOR).catch(() => false);
  if (bad) throw new Error('[PUBLISH-GUARD] 자동화가 진짜 발행 버튼을 클릭하려 함 — 중단');
}

/** 에디터 프레임: iframe#mainFrame 안. 프레임이 없으면 페이지 자체가 에디터. */
async function getEditorFrame(page, timeout = 30000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const handle = await page.$('iframe#mainFrame');
    if (handle) {
      const f = await handle.contentFrame();
      if (f) {
        const ok = await f.$('.se-content, .se-title-text, .se-component').catch(() => null);
        if (ok) return f;
      }
    } else if (await page.$('.se-content, .se-title-text').catch(() => null)) {
      return page.mainFrame();
    }
    await sleep(500);
  }
  throw new Error('에디터 프레임을 찾지 못함 (iframe#mainFrame / .se-content). probe_selectors.js 로 실측하세요.');
}

/** 로그인 여부: 로그인 페이지로 리다이렉트되면 false */
function isLoginUrl(url) {
  return /nid\.naver\.com/.test(url);
}

/** 진입 팝업 정리: "작성 중인 글" → 새로 쓰기(.se-popup-button-cancel), 도움말 패널 닫기 */
async function dismissEntryPopups(frame, log) {
  for (let i = 0; i < 3; i++) {
    const cancel = frame.locator('.se-popup-button-cancel').first();
    if (await cancel.isVisible().catch(() => false)) {
      await cancel.click();
      log && log('· "작성 중인 글" 팝업 → 새로 쓰기');
      await sleep(800);
    }
    const help = frame.locator('.se-help-panel-close-button').first();
    if (await help.isVisible().catch(() => false)) {
      await help.click();
      log && log('· 도움말 패널 닫기');
      await sleep(500);
    }
  }
}

/** dim 레이어 잔류 확인 (팝업 미닫힘 → 이후 클릭 전부 intercepts pointer events) */
async function hasDim(frame) {
  return frame.evaluate(() => {
    const dims = [...document.querySelectorAll('.se-popup-dim, [class*="dim"]')].filter((el) => {
      const s = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      return s.display !== 'none' && s.visibility !== 'hidden' && r.width > 300 && r.height > 300 && /dim/i.test(el.className || '');
    });
    return dims.length;
  }).catch(() => 0);
}

module.exports = {
  ROOT,
  PROFILE_DIR,
  BLOGS,
  profileDir,
  blogArg,
  LOG_DIR,
  WRITE_URL,
  VIEWPORT,
  PUBLISH_BTN_SELECTOR,
  sleep,
  ensureDir,
  timestamp,
  makeLogger,
  launchContext,
  publishGuardSource,
  installPublishGuard,
  verifyPublishGuard,
  assertNotPublishButton,
  getEditorFrame,
  isLoginUrl,
  dismissEntryPopups,
  hasDim,
};
