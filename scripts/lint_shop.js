#!/usr/bin/env node
// 쿠팡파트너스 구매가이드·비교글 자동 검수 (읽기 전용)
// 사용: node scripts/lint_shop.js drafts/<이름>.json      종료코드 0 = 통과(경고만), 1 = 오류
'use strict';

const D = require('./lib/draft_io');

const COUPANG_DISCLOSURE = '이 포스팅은 쿠팡 파트너스 활동의 일환으로, 이에 따른 일정액의 수수료를 제공받습니다.';

const draft = D.loadDraft(process.argv[2] || '');
const meta = draft.meta || {};
const blocks = draft.blocks;
const E = [];
const W = [];
const OK = [];

const textOf = (b) => (['text', 'subtitle', 'quote'].includes(b.type) ? String(b.text) : b.type === 'link' && b.mode === 'text' ? String(b.text) : (b.type === 'image' || b.type === 'card') ? String(b.caption || '') : '');
const body = blocks.map(textOf).join('\n');
const all = draft.title + '\n' + body;
const len = (s) => s.replace(/\n/g, '').length;
const countLoose = (hay, kw) => D.norm(hay).split(D.norm(kw)).length - 1;
const has = (w) => all.includes(w);

// 0. 구조
const { err, warn } = D.validateStructure(draft);
E.push(...err);
W.push(...warn);
if (meta.blog !== 'shop') E.push('meta.blog 가 "shop" 이 아님 — 쿠팡 글은 별도 블로그(shop) 세션으로만 저장');
if (!meta.persona) E.push('meta.persona 없음 — 이 키워드를 검색하는 1명을 정의');

// 1. 쿠팡파트너스 표기 (생략 불가 — 첫 블록 일반 text, 문구 그대로)
const first = blocks[0];
if (!first || first.type !== 'text' || !D.norm(first.text).includes(D.norm(COUPANG_DISCLOSURE))) {
  E.push(`첫 블록(일반 text)에 쿠팡 지정 문구 누락: "${COUPANG_DISCLOSURE}"`);
} else OK.push('쿠팡파트너스 표기 첫 블록');
if (!D.norm(blocks.slice(-4).map(textOf).join('\n')).includes(D.norm(COUPANG_DISCLOSURE))) W.push('글 끝(마지막 링크 근처)에도 표기 문구 1회 더 권장');

// 2. 정직성 — 써 보지 않은 제품을 써 본 것처럼 쓰지 않는다 (표시광고법 기만 광고)
const FIRST_PERSON = ['직접 써', '직접 사용', '써봤', '써 봤', '써보니', '써 보니', '사용해봤', '사용해 봤', '사용해보니', '사용해 보니', '제가 써', '제가 사용', '실사용', '사서 써', '구매해서 써', '한 달 써', '일주일 써', '찐후기', '찐 후기', '리얼 후기', '솔직 후기', '체험해 보니', '체험해보니'];
['내돈내산', '광고 아님', '광고아님', '협찬 아님', '협찬아님'].forEach((w) => { if (has(w)) E.push(`제휴 글 거짓 부인 표현(위법): "${w}"`); });
const usedSet = new Set(meta.usedPersonally || []);
FIRST_PERSON.forEach((w) => {
  if (has(w) && usedSet.size === 0) E.push(`실사용 표현 "${w}" — 직접 써 본 제품이 없음(meta.usedPersonally 비어 있음). 구매자 후기는 "구매자 후기에서는 ~" 처럼 남의 말로`);
});
if (usedSet.size) W.push(`실사용 주장 제품: ${[...usedSet].join(', ')} — 본인 실사진이 글에 있는지 확인`);

// 3. 후기 인용 근거 — 분석 후기 수 과장 금지
const reviewsN = Number(meta.reviewsAnalyzed || 0);
for (const m of all.matchAll(/후기\s*([\d,]+)\s*(개|건)/g)) {
  const n = Number(m[1].replace(/,/g, ''));
  if (!reviewsN) E.push(`"${m[0]}" 언급 — meta.reviewsAnalyzed(실제 읽은 후기 수) 없음`);
  else if (n > reviewsN) E.push(`"${m[0]}" > 실제 분석 ${reviewsN}개 — 과장 금지`);
}
for (const b of blocks.filter((x) => x.type === 'card' && x.template === 'reviewstats')) {
  if (reviewsN && Number(b.data?.total) > reviewsN) E.push(`후기 통계 카드 total ${b.data.total} > 실제 분석 ${reviewsN}`);
}
if (/(후기|리뷰)/.test(body) && !reviewsN) W.push('후기를 요약했다면 meta.reviewsAnalyzed 에 실제 읽은 개수 기록');

// 4. 링크 — 반드시 파트너스 링크
const links = blocks.filter((b) => b.type === 'link');
const products = meta.products || [];
links.forEach((b) => {
  if (/^https:\/\/(link\.coupang\.com\/|coupa\.ng\/)/.test(b.url)) return;
  if (/coupang\.com/.test(b.url)) E.push(`파트너스 링크 아님(수익 0): ${b.url} — 파트너스에서 생성한 link.coupang.com 링크 사용`);
  else W.push(`쿠팡 외 외부 링크: ${b.url}`);
});
(links.length ? OK : E).push(`제휴 링크 ${links.length}개`);
if (products.length) {
  if (links.length > products.length * 2 + 1) W.push(`링크 ${links.length}개 — 상품 ${products.length}개 대비 과다 (상품당 최대 2회 권장, 저품질 위험)`);
  products.forEach((p) => { if (!countLoose(body, p)) W.push(`상품 "${p}" 이 본문 텍스트에 없음`); });
} else W.push('meta.products (비교 상품명 목록) 없음');
if (products.length > 5) W.push(`비교 상품 ${products.length}개 — 3~5개 권장 (선택 과부하)`);

// 5. 과장·가짜 긴급성·가격
['품절 임박', '품절임박', '오늘만', '마감 임박', '마감임박', '한정 수량', '곧 가격 오름'].forEach((w) => { if (has(w)) E.push(`근거 없는 긴급성 표현: "${w}"`); });
['최저가', '역대급', '무조건', '업계 1위', '판매 1위', '100%', '완벽한'].forEach((w) => { if (has(w)) W.push(`과장 어휘: "${w}" — 근거 없으면 삭제`); });
if (/\d{1,3}(,\d{3})+\s*원/.test(body) && !meta.priceCheckedAt) E.push('가격 숫자 언급 — meta.priceCheckedAt(확인 일시) 필요, 본문에 "○월 ○일 기준" 표기');
if (/(치료|완치|질병 예방|효능|효과 입증|살 빠지)/.test(all)) W.push('건강·효능 표현 — 식품표시광고법·의료기기법 주의 (식품/생활용품에 질병 효능 표현 금지)');

// 6. 마케팅 구조 (구매가이드 공식)
const firstIdx = blocks.findIndex((b, i) => i > 0 && ((b.type === 'card' && b.template === 'summary') || /결론|요약|바쁘신|먼저/.test(textOf(b))));
(firstIdx > -1 && firstIdx <= 5 ? OK : W).push('결론 먼저 (상단 5블록 안에 상황별 추천 요약)');
const subs = blocks.filter((b) => b.type === 'subtitle').map((b) => b.text).join('\n');
(/(비추천|사지 마|안 맞|피해야|주의)/.test(subs) ? OK : W).push('"이런 분은 사지 마세요" 섹션 (신뢰 장치)');
(/(고르는|기준|체크|따져)/.test(subs) ? OK : W).push('"고르는 기준" 섹션');
const cards = blocks.filter((b) => b.type === 'card');
(cards.some((c) => c.template === 'compare') ? OK : W).push('비교표 카드 (compare)');
// 카드는 검색엔진이 못 읽는다 → 카드 핵심어가 본문 텍스트에도 있어야 함
cards.forEach((c) => {
  const keys = c.template === 'summary' ? (c.data?.rows || []).map((r) => r.pick) : c.template === 'compare' ? c.data?.products || [] : [];
  keys.filter(Boolean).forEach((k) => { if (!countLoose(body, k)) W.push(`카드(${c.template})의 "${k}" 가 본문 텍스트에 없음 — 이미지는 검색 노출 안 됨`); });
});

// 7. 공통 공식
const tl = [...draft.title].length;
(tl >= 25 && tl <= 32 ? OK : W).push(`제목 ${tl}자 (권장 25~32)`);
const chars = len(body);
(chars >= 2000 && chars <= 3500 ? OK : W).push(`본문 ${chars}자 (구매가이드 권장 2,000~3,500)`);
const mk = meta.mainKeyword;
if (!mk) E.push('meta.mainKeyword 없음');
else {
  const loose = countLoose(body, mk);
  (loose >= 5 && loose <= 8 ? OK : W).push(`메인 키워드 "${mk}" ${loose}회 (권장 5~8)`);
  (body.includes(mk) ? OK : E).push(`띄어쓰기까지 동일한 "${mk}" 1회 이상`);
  const ti = D.norm(draft.title).indexOf(D.norm(mk));
  (ti >= 0 && ti <= 6 ? OK : W).push(`제목 앞쪽 메인 키워드 ${ti < 0 ? '없음' : `(위치 ${ti})`}`);
}
for (const sk of meta.subKeywords || []) (countLoose(subs, sk) ? OK : W).push(`서브 키워드 "${sk}" 소제목 배치`);
const visuals = blocks.filter((b) => b.type === 'image' || b.type === 'card').length;
(visuals >= 8 && visuals <= 15 ? OK : W).push(`이미지(사진+카드) ${visuals}장 (권장 8~15)`);
const quotes = blocks.filter((b) => b.type === 'quote').length;
(quotes >= 2 && quotes <= 4 ? OK : W).push(`인용구 ${quotes}개 (권장 2~4)`);
let run = 0, maxRun = 0;
for (const b of blocks) { if (b.type === 'text') { run += len(b.text); maxRun = Math.max(maxRun, run); } else run = 0; }
if (maxRun > 500) E.push(`텍스트만 ${maxRun}자 연속 — 500자 초과는 실패작`);
else (maxRun <= 400 ? OK : W).push(`최장 텍스트 연속 ${maxRun}자`);
const tags = D.cleanTags(draft.tags);
(tags.length >= 5 && tags.length <= 10 ? OK : W).push(`태그 ${tags.length}개 (권장 5~10)`);

console.log(`\n■ 쿠팡 구매가이드 검수: ${draft.title}`);
if (meta.persona) console.log(`  페르소나: ${meta.persona}`);
OK.forEach((x) => console.log('  ✓ ' + x));
W.forEach((x) => console.log('  ⚠ ' + x));
E.forEach((x) => console.log('  ✗ ' + x));
console.log(`\n결과: 오류 ${E.length} · 경고 ${W.length} · 통과 ${OK.length}`);
process.exit(E.length ? 1 : 0);
