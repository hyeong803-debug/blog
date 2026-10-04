#!/usr/bin/env node
// 네이버 블로그 임시저장 자동 입력 — 발행은 절대 하지 않는다 (installPublishGuard).
// 사용:
//   node scripts/naver_draft.js drafts/<이름>.json --dry-run   # 저장 클릭만 생략 (셀렉터 수정 중엔 항상 먼저)
//   node scripts/naver_draft.js drafts/<이름>.json             # 승인된 초안 임시저장
// 옵션: --keep (끝나도 브라우저 유지)  --force-save (사전 대조 불일치여도 저장 — 디버깅 전용)
//
// 입력 순서: 본문 전체 → (지도) → 제목은 맨 마지막 → 첫 줄 보정 → 태그(발행 패널, 가드 하에) → 사전 대조 → 저장 → 사후 이중검증
'use strict';

const fs = require('fs');
const path = require('path');
const C = require('./lib/common');
const D = require('./lib/draft_io');
const { sleep } = C;

// ─────────────────────────────────────────────────────────────
// 셀렉터 — [실측] = 검증된 값(추측으로 바꾸지 말 것) / [추정] = probe_selectors.js 로 실측 후 확정할 것
// ─────────────────────────────────────────────────────────────
const S = {
  title: '.se-title-text', // [실측]
  bodyP: '.se-section-text p.se-text-paragraph', // [실측] 본문은 반드시 이 범위로 한정 (제목 오염 방지)
  component: '.se-component', // [실측]
  imageBtn: 'button.se-image-toolbar-button', // [실측] 클릭 시 파일선택창
  quoteBtn: '.se-insert-quotation-default-toolbar-button', // [실측]
  dividerBtn: '.se-insert-horizontal-line-default-toolbar-button', // [실측]
  formatBtn: '.se-text-format-toolbar-button', // [실측] 문단서식 드롭다운
  fontSizeBtn: '[class*="se-font-size-code-toolbar-button"], [class*="se-font-size-code-toobar-button"]', // [실측] (오타형 클래스 대비 둘 다)
  fontSize19: 'button[class*="fs19"]', // [실측] "fs19" 옵션
  videoBtn: 'button.se-video-toolbar-button', // [추정]
  videoPopup: '.se-popup-video-upload', // [실측]
  videoAppend: 'button.nvu_btn_append.nvu_local', // [실측] "동영상 추가"
  videoTitle: '.se-popup-video-upload input[placeholder*="제목"]', // [실측]
  videoSubmit: '.se-popup-video-upload button.nvu_btn_submit', // [추정] 완료 버튼 (폴백: "완료"/"확인" 텍스트)
  videoClose: 'button.nvu_btn_close', // [실측]
  mapBtn: 'button.se-map-toolbar-button', // [추정]
  placePopup: '.se-popup-placesMap, [class*="se-popup-place"], [class*="placesMap"]', // [추정]
  placeInput: 'input[placeholder*="장소"], input[placeholder*="검색"], input[type="text"]', // [추정] placePopup 내부
  placeItem: 'li', // [추정] placePopup 내부 결과 항목
  placeClose: '.se-popup-close-button, button[class*="close"]', // [추정] 팝업 닫기 버튼 (Escape 로 안 닫힘 [실측])
  imageCaption: '.se-caption p.se-text-paragraph, .se-module-text.se-caption p', // [추정]
  canvasBottom: '.se-canvas-bottom', // [추정] 문서 끝 클릭 영역 (컴포넌트 뒤 새 문단)
  saveBtn: 'button[class*="save_btn"]', // [실측] save_btn 뒤 해시
  publishOpenBtn: 'button[class*="publish_btn"]', // [추정] 우상단 "발행"(패널 열기) — 진짜 발행 버튼 아님
  tagInput: 'input#tag-input', // [실측]
};

const argv = process.argv.slice(2);
const DRY = argv.includes('--dry-run');
const KEEP = argv.includes('--keep');
const FORCE = argv.includes('--force-save');
const draftArg = argv.find((a) => !a.startsWith('--'));

const result = {
  title: null, body: null, firstLine: null, images: null, captions: null, subtitles: null,
  quotes: null, dividers: null, video: null, place: null, tags: null, save: null, verify: null,
};
const manual = []; // "! 수동 필요" 항목

// ─────────────────────────── 입력 헬퍼 ───────────────────────────
const EMOJI_RE = /(\p{Extended_Pictographic}(?:️|‍\p{Extended_Pictographic})*️?|[\u{1F1E6}-\u{1F1FF}]{2})/gu;

/** 한글은 insertText (type 금지: IME 꼬임). 이모지는 별도 호출로 분리 (함께 넣으면 뒤 텍스트 유실) */
async function insertLine(page, line) {
  const parts = String(line).split(EMOJI_RE).filter((p) => p !== '');
  for (const part of parts) {
    await page.keyboard.insertText(part);
    await sleep(EMOJI_RE.test(part) ? 120 : 40);
    EMOJI_RE.lastIndex = 0;
  }
}

async function enter(page, n = 1) {
  for (let i = 0; i < n; i++) {
    await page.keyboard.press('Enter');
    await sleep(80);
  }
}

async function visibleFirst(locator) {
  const n = await locator.count();
  for (let i = 0; i < n; i++) {
    const el = locator.nth(i);
    if (await el.isVisible().catch(() => false)) return el;
  }
  return null;
}

async function safeClick(locator, opts = {}) {
  await C.assertNotPublishButton(locator);
  await locator.click(opts);
}

/** 마지막 컴포넌트 정보 */
async function lastComponentInfo(frame) {
  return frame.evaluate((sel) => {
    const comps = [...document.querySelectorAll(sel)].filter((c) => !/se-documentTitle/.test(c.className));
    const last = comps[comps.length - 1];
    if (!last) return null;
    const ps = last.querySelectorAll('.se-section-text p.se-text-paragraph');
    const lastP = ps[ps.length - 1];
    return { cls: last.className, isText: /\bse-text\b/.test(last.className) && !!lastP, lastPText: lastP ? lastP.innerText.trim() : null, count: comps.length };
  }, S.component);
}

/** 캐럿을 문서 끝 본문 문단에 놓는다. needEmpty=true 면 빈 문단을 보장 */
async function caretToEnd(frame, page, log, needEmpty = false) {
  let info = await lastComponentInfo(frame);
  if (!info || !info.isText) {
    // 컴포넌트(사진/인용구/구분선/동영상) 뒤 → 새 본문 문단 만들기
    const bottom = frame.locator(S.canvasBottom).first();
    if (await bottom.isVisible().catch(() => false)) {
      await safeClick(bottom);
    } else {
      const comps = frame.locator(S.component);
      const last = comps.nth((await comps.count()) - 1);
      await safeClick(last);
      await page.keyboard.press('ArrowDown');
      await enter(page);
    }
    await sleep(300);
    info = await lastComponentInfo(frame);
    if (!info || !info.isText) log('  ⚠ 컴포넌트 뒤 본문 문단 생성 확인 실패 — probe 로 canvasBottom 실측 필요');
  }
  const lastP = frame.locator(`${S.component}:not(.se-documentTitle)`).last().locator(S.bodyP).last();
  if (await lastP.count()) {
    await safeClick(lastP);
    await page.keyboard.press('End');
    await sleep(80);
  }
  if (needEmpty && info && info.lastPText) await enter(page);
}

// ─────────────────────────── 블록별 입력 ───────────────────────────
async function writeText(page, text) {
  const lines = String(text).split('\n');
  for (let i = 0; i < lines.length; i++) {
    if (lines[i]) await insertLine(page, lines[i]);
    if (i < lines.length - 1) await enter(page);
  }
}

async function readFormatLabel(frame) {
  return (await frame.locator(S.formatBtn).first().innerText().catch(() => '')).trim();
}

async function chooseFormat(frame, name) {
  await safeClick(frame.locator(S.formatBtn).first());
  await sleep(300);
  const opts = frame.locator('button, li').filter({ hasText: new RegExp(`^\\s*${name}\\s*$`) });
  const n = await opts.count();
  for (let i = 0; i < n; i++) {
    const o = opts.nth(i);
    const isToolbar = await o.evaluate((el, sel) => !!el.closest(sel), S.formatBtn).catch(() => true);
    if (!isToolbar && (await o.isVisible().catch(() => false))) {
      await safeClick(o);
      await sleep(300);
      return true;
    }
  }
  return false;
}

async function chooseFontSize19(frame) {
  const btn = await visibleFirst(frame.locator(S.fontSizeBtn));
  if (!btn) return false;
  await safeClick(btn);
  await sleep(300);
  let opt = await visibleFirst(frame.locator(S.fontSize19));
  if (!opt) opt = await visibleFirst(frame.locator('button').filter({ hasText: /^\s*19\s*$/ }));
  if (!opt) return false;
  await safeClick(opt);
  await sleep(250);
  return true;
}

/** 소제목: 볼드 토글 금지. 순서 = 서식(소제목) → 크기(19) → 텍스트 → Enter → "본문" 복귀 → 라벨 재검증 */
async function writeSubtitle(frame, page, text, log) {
  const okFmt = await chooseFormat(frame, '소제목');
  const okSize = okFmt && (await chooseFontSize19(frame));
  await insertLine(page, text);
  const label = await readFormatLabel(frame);
  const applied = okFmt && label.includes('소제목');
  await enter(page);
  const back = await chooseFormat(frame, '본문');
  const backLabel = await readFormatLabel(frame);
  if (!back || !backLabel.includes('본문')) log(`  ⚠ 본문 서식 복귀 확인 실패 (라벨: "${backLabel}")`);
  if (!okSize) log('  ⚠ 소제목 글자 크기 19 적용 실패 — 기본 크기로 남음');
  return applied;
}

async function writeQuote(frame, page, text, log) {
  await safeClick(frame.locator(S.quoteBtn).first());
  await sleep(500);
  await writeText(page, text);
  await sleep(200);
  const ok = await frame.evaluate((t) => {
    const n = (s) => s.replace(/\s/g, '');
    return [...document.querySelectorAll('.se-component.se-quotation')].some((q) => n(q.innerText).includes(n(t)));
  }, text);
  if (!ok) log('  ⚠ 인용구 안에 텍스트 확인 실패');
  return ok;
}

async function writeDivider(frame) {
  const before = await frame.locator('.se-component.se-horizontalLine').count();
  await safeClick(frame.locator(S.dividerBtn).first());
  await sleep(500);
  return (await frame.locator('.se-component.se-horizontalLine').count()) > before;
}

async function writeImage(frame, page, block, log) {
  const abs = path.resolve(C.ROOT, block.path);
  const before = await frame.locator('.se-component.se-image').count();
  const [chooser] = await Promise.all([
    page.waitForEvent('filechooser', { timeout: 15000 }),
    safeClick(frame.locator(S.imageBtn).first()),
  ]);
  await chooser.setFiles(abs);
  const deadline = Date.now() + 90000;
  while (Date.now() < deadline && (await frame.locator('.se-component.se-image').count()) <= before) await sleep(500);
  const ok = (await frame.locator('.se-component.se-image').count()) > before;
  if (!ok) { log(`  ✗ 사진 업로드 확인 실패: ${block.path}`); return { ok, caption: !block.caption }; }
  await sleep(800);
  let captionOk = !block.caption;
  if (block.caption) {
    const cap = frame.locator('.se-component.se-image').last().locator(S.imageCaption).first();
    if (await cap.count()) {
      await safeClick(cap);
      await insertLine(page, block.caption);
      await sleep(200);
      captionOk = D.norm(await frame.locator('.se-component.se-image').last().innerText()).includes(D.norm(block.caption));
    }
    if (!captionOk) log(`  ⚠ 캡션 입력 확인 실패: ${block.path}`);
  }
  return { ok, caption: captionOk };
}

/** 팝업을 확실히 닫는다: 닫기 버튼 → 그래도 남으면 DOM 강제 제거 (dim 잔류 시 이후 클릭 전부 실패) */
async function closePopupHard(frame, popupSel, closeSel, log) {
  const popup = frame.locator(popupSel).first();
  if (await popup.isVisible().catch(() => false)) {
    const close2 = (await visibleFirst(popup.locator(closeSel))) || (await visibleFirst(frame.locator(closeSel)));
    if (close2) await close2.click().catch(() => {});
    await sleep(700);
  }
  if ((await popup.isVisible().catch(() => false)) || (await C.hasDim(frame))) {
    await frame.evaluate((sel) => {
      document.querySelectorAll(sel).forEach((el) => el.remove());
      document.querySelectorAll('.se-popup-dim, [class*="se-popup-dim"]').forEach((el) => el.remove());
    }, popupSel);
    log && log('  · 팝업 닫기 실패 → DOM 강제 제거 폴백');
    await sleep(300);
  }
  return !(await popup.isVisible().catch(() => false)) && !(await C.hasDim(frame));
}

async function writeVideo(frame, page, v, log) {
  const before = await frame.locator('.se-component.se-video').count();
  const btn = await visibleFirst(frame.locator(S.videoBtn));
  if (!btn) { log('  ✗ 동영상 툴바 버튼 없음 (probe 필요)'); return false; }
  await safeClick(btn);
  await frame.locator(S.videoPopup).first().waitFor({ state: 'visible', timeout: 15000 });
  const [chooser] = await Promise.all([
    page.waitForEvent('filechooser', { timeout: 15000 }),
    frame.locator(S.videoAppend).first().click(),
  ]);
  await chooser.setFiles(path.resolve(C.ROOT, v.path));
  log(`  · 동영상 업로드 중… (수 분 걸릴 수 있음) 제목: ${v.title}`);
  const titleInput = frame.locator(S.videoTitle).first();
  await titleInput.waitFor({ state: 'visible', timeout: 120000 });
  await titleInput.click();
  await titleInput.fill('');
  await titleInput.click();
  await page.keyboard.insertText(v.title);

  // 완료 버튼이 활성화될 때까지 (최대 10분)
  const deadline = Date.now() + 10 * 60 * 1000;
  let submit = null;
  while (Date.now() < deadline) {
    submit = (await visibleFirst(frame.locator(S.videoSubmit))) ||
      (await visibleFirst(frame.locator(`${S.videoPopup} button`).filter({ hasText: /^\s*(완료|확인|등록)\s*$/ })));
    if (submit && (await submit.isEnabled().catch(() => false))) break;
    submit = null;
    await sleep(2000);
  }
  if (submit) await safeClick(submit);
  else log('  ✗ 동영상 완료 버튼 활성화 대기 시간 초과');

  const vd = Date.now() + 60000;
  while (Date.now() < vd && (await frame.locator('.se-component.se-video').count()) <= before) await sleep(1000);
  await closePopupHard(frame, S.videoPopup, S.videoClose, log);
  return (await frame.locator('.se-component.se-video').count()) > before;
}

async function writePlace(frame, page, place, log) {
  const btn = await visibleFirst(frame.locator(S.mapBtn));
  if (!btn) { log('  ✗ 지도 툴바 버튼 없음 (probe 필요)'); return 'fail'; }
  await safeClick(btn);
  await sleep(1200);
  const popup = await visibleFirst(frame.locator(S.placePopup));
  if (!popup) { log('  ✗ 장소 팝업 확인 실패'); return 'fail'; }
  const input = await visibleFirst(popup.locator(S.placeInput));
  if (!input) { await closePopupHard(frame, S.placePopup, S.placeClose, log); return 'fail'; }
  await input.click();
  await page.keyboard.insertText(place.query);
  await page.keyboard.press('Enter');
  await sleep(2000);

  const items = popup.locator(S.placeItem);
  const names = await items.evaluateAll((els) => els.map((e) => (e.innerText || '').split('\n')[0].trim()));
  const valid = names.map((n, i) => ({ n, i })).filter((x) => x.n);
  if (!valid.length) {
    log(`  ! 지도 검색 0건: "${place.query}" → 수동 첨부 필요`);
    await closePopupHard(frame, S.placePopup, S.placeClose, log);
    return 'zero';
  }
  // 선택 우선순위: 공백 제거 정확 일치 > 부분 포함 > 첫 결과
  const target = D.norm(place.name || place.query);
  const pick = valid.find((x) => D.norm(x.n) === target) || valid.find((x) => D.norm(x.n).includes(target) || target.includes(D.norm(x.n))) || valid[0];
  log(`  · 장소 선택: "${pick.n}" (${valid.length}건 중)`);
  const item = items.nth(pick.i);
  await item.hover(); // "추가" 버튼은 hover 전 not visible
  await sleep(300);
  const add = item.locator('button').filter({ hasText: '추가' }).first();
  try {
    await add.click({ timeout: 3000 });
  } catch {
    await add.evaluate((el) => el.click()).catch(() => {}); // 폴백: DOM 직접 click
  }
  await sleep(500);
  const confirm = await visibleFirst(popup.locator('button').filter({ hasText: /^\s*확인\s*$/ }));
  if (confirm && (await confirm.isEnabled())) {
    await safeClick(confirm);
    await sleep(1000);
  } else log('  ⚠ 장소 "확인" 버튼 비활성 — "추가" 실패 가능');
  await closePopupHard(frame, S.placePopup, S.placeClose, log); // Escape 로 안 닫힘 → 닫기 버튼
  const ok = await frame.evaluate(() => !!document.querySelector('.se-component.se-placesMap, .se-component[class*="map"], .se-component[class*="place"]'));
  return ok ? 'ok' : 'fail';
}

// ─────────────────────────── 제목 / 첫 줄 / 태그 ───────────────────────────
async function readTitle(frame) {
  return (await frame.locator(S.title).first().innerText().catch(() => '')).trim();
}

async function clearTitle(frame, page) {
  await frame.evaluate((sel) => {
    const el = document.querySelector(sel + ' p.se-text-paragraph') || document.querySelector(sel);
    const r = document.createRange();
    r.selectNodeContents(el);
    const s = window.getSelection();
    s.removeAllRanges();
    s.addRange(r);
  }, S.title);
  await page.keyboard.press('Backspace');
  await sleep(200);
}

async function writeTitle(frame, page, title, log) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    await safeClick(frame.locator(S.title).first());
    await sleep(200);
    if (attempt > 1) await clearTitle(frame, page);
    await insertLine(page, title);
    await sleep(400);
    const got = await readTitle(frame);
    if (D.norm(got) === D.norm(title)) return true;
    log(`  ⚠ 제목 불일치(${attempt}회차): "${got}" → 전체 삭제 후 재입력`);
    await clearTitle(frame, page);
  }
  return false;
}

async function bodyText(frame) {
  return frame.evaluate((sel) =>
    [...document.querySelectorAll(sel)].filter((c) => !/se-documentTitle/.test(c.className)).map((c) => c.innerText).join('\n'), S.component);
}

async function fixFirstLine(frame, page, draft, log) {
  const first = String(draft.blocks.find((b) => b.type === 'text').text).split('\n').find((l) => l.trim());
  const head = D.norm(first).slice(0, 12);
  if (D.norm(await bodyText(frame)).includes(head)) return true;
  log(`  ⚠ 본문 첫 줄 누락 감지 → 맨 앞 보정 삽입: "${first.slice(0, 20)}…"`);
  await safeClick(frame.locator(S.bodyP).first());
  await page.keyboard.press('ControlOrMeta+ArrowUp').catch(() => {});
  await page.keyboard.press('Home');
  await insertLine(page, first);
  await enter(page);
  return D.norm(await bodyText(frame)).includes(head);
}

async function findIn(page, frame, sel) {
  return (await visibleFirst(frame.locator(sel))) || (await visibleFirst(page.locator(sel)));
}

async function readTags(scope) {
  return scope.evaluate((sel) => {
    const input = document.querySelector(sel);
    if (!input) return null;
    let box = input.parentElement;
    for (let i = 0; i < 6 && box; i++) {
      if ((box.innerText || '').includes('#')) break;
      box = box.parentElement;
    }
    const txt = box ? box.innerText : '';
    return txt.split('#').slice(1).map((t) => t.split('\n')[0].trim()).filter(Boolean);
  }, S.tagInput);
}

/** 태그: 발행 패널 열기(가드 하에) → input#tag-input 에 태그마다 입력+Enter → 검증 → Escape 로 패널만 닫기 */
async function writeTags(frame, page, tags, log) {
  const open = await findIn(page, frame, S.publishOpenBtn);
  if (!open) { log('  ✗ 발행 패널 열기 버튼 없음 (probe 필요)'); return { ok: false, got: [] }; }
  await safeClick(open); // assertNotPublishButton 포함 — 진짜 발행 버튼이면 즉시 중단
  await sleep(1200);
  const scope = (await frame.$(S.tagInput)) ? frame : page;
  const input = scope.locator(S.tagInput).first();
  await input.waitFor({ state: 'visible', timeout: 10000 });
  const existing = (await readTags(scope)) || [];
  for (const t of tags) {
    if (existing.map(D.norm).includes(D.norm(t))) continue;
    await input.click();
    await page.keyboard.insertText(t);
    await sleep(150);
    await page.keyboard.press('Enter');
    await sleep(350);
  }
  const got = (await readTags(scope)) || [];
  const missing = tags.filter((t) => !got.map(D.norm).includes(D.norm(t)));
  await page.keyboard.press('Escape');
  await sleep(600);
  if (await input.isVisible().catch(() => false)) {
    await page.keyboard.press('Escape');
    await sleep(600);
  }
  if (await input.isVisible().catch(() => false)) log('  ⚠ 발행 패널이 아직 열려 있음 (가드는 활성 상태)');
  return { ok: missing.length === 0, got, missing };
}

// ─────────────────────────── 검증 ───────────────────────────
async function dumpEditor(frame) {
  return frame.evaluate(({ compSel, titleSel }) => {
    const typeOf = (cls) => {
      if (/se-documentTitle/.test(cls)) return 'title';
      if (/se-image|se-imageStrip|se-imageGroup/.test(cls)) return 'image';
      if (/se-quotation/.test(cls)) return 'quote';
      if (/se-horizontalLine/.test(cls)) return 'divider';
      if (/se-video/.test(cls)) return 'video';
      if (/se-placesMap|se-map|place/i.test(cls)) return 'place';
      if (/se-sectionTitle/.test(cls)) return 'subtitle';
      if (/\bse-text\b/.test(cls)) return 'text';
      return 'other';
    };
    const title = (document.querySelector(titleSel)?.innerText || '').trim();
    const comps = [...document.querySelectorAll(compSel)].map((c) => ({ type: typeOf(c.className), cls: c.className, text: (c.innerText || '').trim() }));
    return { title, comps: comps.filter((c) => c.type !== 'title') };
  }, { compSel: S.component, titleSel: S.title });
}

function compare(draft, dump) {
  const issues = [];
  const exp = D.expectations(draft);
  if (D.norm(dump.title) !== D.norm(draft.title)) issues.push(`제목 불일치: "${dump.title}"`);
  const hay = D.norm(dump.comps.map((c) => c.text).join('\n'));
  let pos = 0;
  for (const t of exp.texts) {
    const i = hay.indexOf(D.norm(t), pos);
    if (i < 0) {
      issues.push(hay.includes(D.norm(t)) ? `순서 어긋남: "${t.slice(0, 30)}"` : `본문 누락: "${t.slice(0, 30)}"`);
    } else pos = i + D.norm(t).length;
  }
  const actualTypes = dump.comps.map((c) => c.type).filter((t) => t !== 'text' && t !== 'subtitle' && t !== 'other');
  let k = 0;
  for (const t of actualTypes) if (t === exp.types[k]) k++;
  if (k < exp.types.length) issues.push(`컴포넌트 순서/개수 불일치: 기대 [${exp.types.join(',')}] / 실제 [${actualTypes.join(',')}]`);
  return issues;
}

async function verifyAndSave(frame, page, draft, outDir, stage, log) {
  const dump = await dumpEditor(frame);
  const issues = compare(draft, dump);
  fs.writeFileSync(path.join(outDir, `${stage}-dump.json`), JSON.stringify(dump, null, 2));
  fs.writeFileSync(path.join(outDir, `${stage}-dump.txt`), [`[제목] ${dump.title}`, '', ...dump.comps.map((c) => `[${c.type}] ${c.text}`)].join('\n'));
  await page.screenshot({ path: path.join(outDir, `${stage}-screenshot.png`) }).catch(() => {});
  log(`  · ${stage} 덤프: ${path.relative(C.ROOT, outDir)}/${stage}-dump.txt`);
  return issues;
}

function bumpFailCount(name) {
  const f = path.join(C.LOG_DIR, 'fail-count.json');
  let m = {};
  try { m = JSON.parse(fs.readFileSync(f, 'utf8')); } catch {}
  m[name] = (m[name] || 0) + 1;
  C.ensureDir(C.LOG_DIR);
  fs.writeFileSync(f, JSON.stringify(m, null, 2));
  return m[name];
}

function printReport(log) {
  const mark = (v) => (v === true ? '✓' : v === null ? '-' : v === 'skip' ? '- (해당 없음)' : '! 수동 필요');
  log('');
  log('════════════ 자동 처리 결과 ════════════');
  log(`제목            ${mark(result.title)}`);
  log(`본문 첫 줄       ${mark(result.firstLine)}`);
  log(`사진            ${result.images ? `${result.images.ok}/${result.images.total}` : '-'} ${result.images ? mark(result.images.ok === result.images.total) : ''}`);
  log(`사진 캡션        ${result.captions ? `${result.captions.ok}/${result.captions.total}` : '-'} ${result.captions ? mark(result.captions.ok === result.captions.total) : ''}`);
  log(`소제목 서식      ${result.subtitles ? `${result.subtitles.ok}/${result.subtitles.total}` : '-'} ${result.subtitles ? mark(result.subtitles.ok === result.subtitles.total) : ''}`);
  log(`인용구          ${result.quotes ? `${result.quotes.ok}/${result.quotes.total}` : '-'}`);
  log(`구분선          ${result.dividers ? `${result.dividers.ok}/${result.dividers.total}` : '-'}`);
  log(`동영상          ${mark(result.video)}`);
  log(`지도            ${mark(result.place)}`);
  log(`태그            ${mark(result.tags)}`);
  log(`임시저장         ${result.save === 'dry' ? '- (dry-run: 저장 생략)' : mark(result.save)}`);
  log(`전문 대조        ${mark(result.verify)}`);
  log('════════════════════════════════════════');
  if (manual.length) {
    log('수동 처리 필요:');
    manual.forEach((m) => log('  ! ' + m));
  }
}

// ─────────────────────────── 메인 ───────────────────────────
(async () => {
  if (!draftArg) {
    console.error('사용: node scripts/naver_draft.js drafts/<이름>.json [--dry-run] [--keep]');
    process.exit(1);
  }
  const draft = D.loadDraft(draftArg);
  const log = C.makeLogger(`draft-${draft.__name}`);
  const { err, warn } = D.validateStructure(draft);
  warn.forEach((w) => log('⚠ ' + w));
  if (err.length) {
    err.forEach((e) => log('✗ ' + e));
    process.exit(1);
  }
  const tags = D.cleanTags(draft.tags);
  const plan = D.insertionPlan(draft);
  const outDir = C.ensureDir(path.join(C.ROOT, 'drafts', `${draft.__name}.verify`));
  fs.writeFileSync(path.join(C.ROOT, 'drafts', `${draft.__name}.manual.txt`), D.manualManuscript(draft));

  log(`초안: ${draft.title}  (${DRY ? 'DRY-RUN: 저장 생략' : '임시저장'})`);
  const context = await C.launchContext();
  const page = context.pages()[0] || (await context.newPage());
  page.on('console', (m) => { if (m.text().includes('[PUBLISH-GUARD]')) log('🛡 ' + m.text()); });
  await C.installPublishGuard(context, page); // 첫 내비게이션 전: initScript 등록

  let failed = false;
  try {
    await page.goto(C.WRITE_URL, { waitUntil: 'domcontentloaded' });
    await sleep(3000);
    if (C.isLoginUrl(page.url())) throw new Error('로그인 필요 — /setup-login 먼저 실행');
    const frame = await C.getEditorFrame(page);
    await C.installPublishGuard(context, page); // 에디터 로드 직후 즉시 재확인 설치
    if (!(await C.verifyPublishGuard(frame))) throw new Error('발행 차단 가드 설치 확인 실패 — 안전을 위해 중단');
    log('🛡 발행 차단 가드 활성 (button[data-testid="seOnePublishBtn"])');
    await C.dismissEntryPopups(frame, log);

    // 본문 시작점: 본문 첫 문단 (셀렉터 범위 한정 — 제목 오염 방지)
    await safeClick(frame.locator(S.bodyP).first());

    const cnt = { img: 0, imgOk: 0, cap: 0, capOk: 0, sub: 0, subOk: 0, q: 0, qOk: 0, d: 0, dOk: 0 };
    for (let i = 0; i < plan.length; i++) {
      const b = plan[i];
      const next = plan[i + 1];
      log(`[${i + 1}/${plan.length}] ${b.type}${b.text ? ': ' + String(b.text).split('\n')[0].slice(0, 24) : b.path ? ': ' + b.path : ''}`);
      if (await C.hasDim(frame)) await closePopupHard(frame, '.se-popup', '.se-popup-close-button', log);

      if (b.type === 'text') {
        if (i > 0) await caretToEnd(frame, page, log, true);
        await writeText(page, b.text);
        await enter(page); // 블록 끝
        if (next && next.type === 'text') await enter(page); // 다음도 text 일 때만 한 번 더 (붙어 렌더링 방지)
      } else if (b.type === 'subtitle') {
        cnt.sub++;
        await caretToEnd(frame, page, log, true);
        if (await writeSubtitle(frame, page, b.text, log)) cnt.subOk++;
      } else if (b.type === 'image') {
        cnt.img++;
        if (b.caption) cnt.cap++;
        await caretToEnd(frame, page, log);
        const r = await writeImage(frame, page, b, log);
        if (r.ok) cnt.imgOk++;
        if (b.caption && r.caption) cnt.capOk++;
      } else if (b.type === 'quote') {
        cnt.q++;
        await caretToEnd(frame, page, log);
        if (await writeQuote(frame, page, b.text, log)) cnt.qOk++;
      } else if (b.type === 'divider') {
        cnt.d++;
        await caretToEnd(frame, page, log);
        if (await writeDivider(frame)) cnt.dOk++;
      } else if (b.type === 'video') {
        await caretToEnd(frame, page, log);
        result.video = await writeVideo(frame, page, b, log).catch((e) => { log('  ✗ 동영상: ' + e.message.split('\n')[0]); return false; });
        if (!result.video) manual.push(`동영상 첨부 (${b.path}, 제목: ${b.title}) — 첫 본문 문단 바로 아래`);
      } else if (b.type === 'place') {
        await caretToEnd(frame, page, log);
        const r = await writePlace(frame, page, b, log).catch((e) => { log('  ✗ 지도: ' + e.message.split('\n')[0]); return 'fail'; });
        result.place = r === 'ok';
        if (r === 'zero') manual.push(`지도: 검색 결과 0건 ("${b.query}") — 글 맨 끝에 장소 직접 첨부`);
        else if (r !== 'ok') manual.push(`지도 첨부 실패 ("${b.query}") — 글 맨 끝에 직접 첨부`);
      }
    }
    if (!draft.video) result.video = 'skip';
    if (!draft.place) result.place = 'skip';
    result.images = { ok: cnt.imgOk, total: cnt.img };
    result.captions = { ok: cnt.capOk, total: cnt.cap };
    result.subtitles = { ok: cnt.subOk, total: cnt.sub };
    result.quotes = { ok: cnt.qOk, total: cnt.q };
    result.dividers = { ok: cnt.dOk, total: cnt.d };
    if (cnt.subOk < cnt.sub) manual.push(`소제목 서식 ${cnt.sub - cnt.subOk}개 미적용 — 문단서식 "소제목"·크기 19 직접 적용`);
    if (cnt.capOk < cnt.cap) manual.push(`사진 캡션 ${cnt.cap - cnt.capOk}개 미입력`);

    // 제목은 맨 마지막 (제목 직후 본문 입력 시 레이스 컨디션으로 섞임)
    log('제목 입력 (본문 완료 후)');
    result.title = await writeTitle(frame, page, draft.title, log);
    if (!result.title) manual.push('제목 직접 확인/수정');
    result.firstLine = await fixFirstLine(frame, page, draft, log);

    // 태그 (발행 패널 — 가드 하에서만)
    if (tags.length) {
      if (!(await C.verifyPublishGuard(frame))) throw new Error('태그 입력 전 가드 재확인 실패 — 중단');
      const t = await writeTags(frame, page, tags, log).catch((e) => { log('  ✗ 태그: ' + e.message.split('\n')[0]); return { ok: false, got: [], missing: tags }; });
      result.tags = t.ok;
      log(`  · 태그 ${t.got.length}개 확인: ${t.got.map((x) => '#' + x).join(' ')}`);
      if (!t.ok) manual.push(`태그 직접 입력: ${(t.missing || tags).map((x) => '#' + x).join(' ')}`);
    } else result.tags = 'skip';

    // 사전 대조 (저장 전) — 불일치면 저장하지 않는다 (실패본이 "저장 글"에 쌓이는 것 방지)
    const pre = await verifyAndSave(frame, page, draft, outDir, 'pre', log);
    if (pre.length) {
      pre.forEach((x) => log('  ✗ ' + x));
      if (!FORCE) throw new Error(`저장 전 전문 대조 불일치 ${pre.length}건 — 저장하지 않음`);
    }

    if (DRY) {
      result.save = 'dry';
      result.verify = pre.length === 0;
    } else {
      const save = (await findIn(page, frame, S.saveBtn)) || (await visibleFirst(frame.locator('button').filter({ hasText: /^\s*저장\s*$/ })));
      if (!save) throw new Error('임시저장 버튼 없음 (probe 필요)');
      await safeClick(save);
      await sleep(3000);
      result.save = true;
      // 사후 이중 검증: (a) 스크린샷 + (b) 전문 텍스트 덤프 대조 (본검증)
      const post = await verifyAndSave(frame, page, draft, outDir, 'post', log);
      post.forEach((x) => log('  ✗ ' + x));
      result.verify = post.length === 0;
    }
    if (!result.verify) failed = true;
  } catch (e) {
    failed = true;
    log('✗ 중단: ' + e.message.split('\n')[0]);
    try {
      await page.screenshot({ path: path.join(outDir, 'error-screenshot.png') });
    } catch {}
  }

  printReport(log);
  if (failed) {
    const n = bumpFailCount(draft.__name);
    log(`✗ 검증 실패 (${n}회차). 성공으로 보고하지 말 것 — 원인 수정 후 --dry-run 으로 재시도.`);
    if (n >= 3) log(`→ 3회 실패: 수동 붙여넣기 원고 사용 — drafts/${draft.__name}.manual.txt`);
  } else {
    log(DRY ? '✓ DRY-RUN 통과 (저장은 하지 않음)' : '✓ 임시저장 + 전문 대조 통과');
  }
  log(`로그: ${path.relative(C.ROOT, log.file)}`);
  if (!KEEP) await context.close();
  process.exit(failed ? 2 : 0);
})();
