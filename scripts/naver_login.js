#!/usr/bin/env node
// 네이버 로그인 1회 — 사용자가 열린 브라우저에서 직접 로그인한다.
// 이 스크립트는 아이디/비밀번호를 입력하거나 저장하지 않는다. 세션 쿠키만 naver-profile/ 에 남는다.
// 사용: node scripts/naver_login.js
'use strict';

const { launchContext, WRITE_URL, isLoginUrl, sleep, makeLogger, installPublishGuard } = require('./lib/common');

(async () => {
  const log = makeLogger('login');
  const context = await launchContext();
  const page = context.pages()[0] || (await context.newPage());
  await installPublishGuard(context, page);

  await page.goto('https://nid.naver.com/nidlogin.login?url=' + encodeURIComponent(WRITE_URL));
  log('브라우저에서 직접 로그인해 주세요. (최대 5분 대기)');
  log('※ "로그인 상태 유지"를 체크하면 세션이 오래 유지됩니다. 비밀번호는 이 툴이 저장하지 않습니다.');

  const deadline = Date.now() + 5 * 60 * 1000;
  let ok = false;
  while (Date.now() < deadline) {
    const cookies = await context.cookies('https://naver.com');
    const hasAuth = cookies.some((c) => c.name === 'NID_AUT');
    if (hasAuth && !isLoginUrl(page.url())) { ok = true; break; }
    await sleep(1500);
  }

  if (!ok) {
    log('✗ 로그인이 확인되지 않았습니다. 다시 실행해 주세요.');
    await context.close();
    process.exit(1);
  }

  // 검증: 글쓰기 페이지가 로그인 페이지로 튕기지 않는지 실제로 확인
  await page.goto(WRITE_URL, { waitUntil: 'domcontentloaded' });
  await sleep(4000);
  if (isLoginUrl(page.url())) {
    log('✗ 글쓰기 페이지 접근 시 로그인 페이지로 이동됨 — 세션 저장 실패');
    await context.close();
    process.exit(1);
  }
  log('✓ 로그인 세션 저장 완료 (naver-profile/). 이 폴더는 절대 외부에 공유하지 마세요.');
  await context.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
