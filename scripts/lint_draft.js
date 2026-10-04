#!/usr/bin/env node
// 초안 자동 검수 — 글쓰기 공식·협찬 표기·보험 광고 주의어를 숫자로 대조한다. (브라우저 안 씀, 읽기 전용)
// 사용: node scripts/lint_draft.js drafts/<이름>.json
// 종료코드: 0 = 통과(경고만), 1 = 오류 있음
'use strict';

const D = require('./lib/draft_io');

const draft = D.loadDraft(process.argv[2] || '');
const meta = draft.meta || {};
const E = []; // 오류
const W = []; // 경고
const OK = []; // 통과

const blocks = draft.blocks;
const textOf = (b) => (['text', 'subtitle', 'quote'].includes(b.type) ? String(b.text) : b.type === 'image' ? String(b.caption || '') : '');
const bodyAll = blocks.map(textOf).join('\n');
const len = (s) => s.replace(/\n/g, '').length;
const count = (hay, needle) => (needle ? hay.split(needle).length - 1 : 0);
const countLoose = (hay, kw) => count(D.norm(hay), D.norm(kw));

// 1. 구조
const { err, warn } = D.validateStructure(draft);
E.push(...err);
W.push(...warn);

// 2. 제목
const tl = [...draft.title].length;
(tl >= 25 && tl <= 32 ? OK : W).push(`제목 ${tl}자 (권장 25~32)`);

// 3. 분량
const chars = len(bodyAll);
const info = meta.articleType === '정보성';
const max = info ? 3000 : 2500;
(chars >= 1800 && chars <= max ? OK : W).push(`본문 ${chars}자 (권장 1,800~${max.toLocaleString()})`);

// 4. 키워드
const mk = meta.mainKeyword;
if (!mk) E.push('meta.mainKeyword 없음 (지역명 포함 메인 키워드 1개)');
else {
  const loose = countLoose(bodyAll, mk);
  const exact = count(bodyAll, mk);
  (loose >= 5 && loose <= 7 ? OK : W).push(`메인 키워드 "${mk}" 본문 ${loose}회 (권장 5~7)`);
  (exact >= 1 ? OK : E).push(`띄어쓰기까지 동일한 "${mk}" ${exact}회 (1회 이상 필수)`);
  const ti = D.norm(draft.title).indexOf(D.norm(mk));
  (ti >= 0 && ti <= 6 ? OK : W).push(`제목 앞쪽 메인 키워드 ${ti < 0 ? '없음' : `(위치 ${ti})`}`);
  const texts = blocks.filter((b) => b.type === 'text');
  const firstIdx = meta.sponsored && texts.length > 1 ? 1 : 0; // 협찬 표기 블록 다음이 첫 문단
  if (texts[firstIdx]) (countLoose(texts[firstIdx].text, mk) ? OK : W).push('첫 문단 메인 키워드');
  if (texts.length) (countLoose(texts[texts.length - 1].text, mk) ? OK : W).push('마지막 문단 메인 키워드');
  const caps = blocks.filter((b) => b.type === 'image' && b.caption);
  const capKw = caps.reduce((a, b) => a + countLoose(b.caption, mk), 0);
  (capKw >= 1 && capKw <= 2 ? OK : W).push(`캡션 속 메인 키워드 ${capKw}회 (권장 1~2)`);
}
const subs = blocks.filter((b) => b.type === 'subtitle').map((b) => b.text).join('\n');
for (const sk of meta.subKeywords || []) (countLoose(subs, sk) ? OK : W).push(`서브 키워드 "${sk}" 소제목 배치`);

// 5. 사진·인용구·리듬
const imgs = blocks.filter((b) => b.type === 'image');
(imgs.length >= 10 && imgs.length <= 15 ? OK : W).push(`사진 ${imgs.length}장 (권장 10~15)`);
const capN = imgs.filter((b) => b.caption).length;
(imgs.length === 0 || Math.abs(capN - imgs.length / 2) <= Math.max(2, imgs.length * 0.2) ? OK : W).push(`캡션 ${capN}/${imgs.length}장 (절반 정도 권장)`);
const quotes = blocks.filter((b) => b.type === 'quote').length;
(quotes >= 2 && quotes <= 4 ? OK : W).push(`인용구 ${quotes}개 (권장 2~4)`);

let run = 0;
let maxRun = 0;
for (const b of blocks) {
  if (b.type === 'text') { run += len(b.text); maxRun = Math.max(maxRun, run); }
  else run = 0;
}
if (maxRun > 500) E.push(`텍스트만 ${maxRun}자 연속 — 500자 초과는 실패작 (사진/인용구/소제목/구분선 삽입)`);
else (maxRun <= 400 ? OK : W).push(`최장 텍스트 연속 ${maxRun}자 (리듬 장치 300~400자마다)`);

blocks.forEach((b, i) => {
  if (b.type !== 'text') return;
  const lines = String(b.text).split('\n').filter((l) => l.trim());
  if (lines.length > 5) W.push(`blocks[${i}] ${lines.length}줄 — 한 블록 3~5줄 권장`);
  lines.forEach((l) => {
    const sentences = l.split(/(?<=[.!?。])\s+/).filter((s) => s.trim());
    if (sentences.length > 1) W.push(`blocks[${i}] 한 줄에 문장 ${sentences.length}개: "${l.slice(0, 24)}…"`);
  });
});

// 6. 홍보 냄새·링크·연락처
const links = (bodyAll.match(/https?:\/\/\S+/g) || []).length;
(links <= 1 ? OK : E).push(`외부 링크 ${links}개 (최대 1)`);
const phones = (bodyAll.match(/0\d{1,2}[-.\s]?\d{3,4}[-.\s]?\d{4}/g) || []).length;
(phones <= 1 ? OK : E).push(`연락처 ${phones}회 (글 전체 1회)`);
if (meta.brandName) {
  const bn = count(bodyAll, meta.brandName);
  (bn <= 3 ? OK : E).push(`업체명 본문 ${bn}회 (3회 이내)`);
  if (info) {
    const cta = blocks.slice(-3).map(textOf).join('\n');
    const outside = bn - count(cta, meta.brandName);
    (outside === 0 && count(cta, meta.brandName) <= 1 ? OK : E).push(`정보성 글 업체명: CTA 외 ${outside}회 (CTA 1회만 허용)`);
  }
}
const SPECIAL = /[★☆♥♡◆◇■□▶◀●○※♣♠]{1}/g;
const sp = (bodyAll + draft.title).match(SPECIAL) || [];
(sp.length <= 2 ? OK : W).push(`장식 특수문자 ${sp.length}개 (제목에는 금지)`);
if (SPECIAL.test(draft.title)) E.push('제목에 장식 특수문자');
const AD_WORDS = ['최저가', '파격', '대박', '무조건', '100%', '업계 1위', '최고의', '공짜', '무료 증정', '선착순'];
AD_WORDS.forEach((w) => { if (bodyAll.includes(w) || draft.title.includes(w)) W.push(`광고 어휘: "${w}"`); });

// 7. 협찬 (공정위 표시광고법 — 생략 불가)
if (meta.sponsored === undefined) E.push('meta.sponsored 미확인 — 협찬/체험단 여부를 사용자에게 확인할 것');
else if (meta.sponsored) {
  const first = blocks[0];
  if (!first || first.type !== 'text') E.push('협찬 표기는 맨 첫 블록(일반 text 블록)이어야 함 — quote 금지');
  else if (!/(협찬|제공|원고료|지원|대가|광고|체험단)/.test(first.text)) E.push('첫 블록에 협찬 표기 문구 없음');
  else OK.push('협찬 표기 첫 블록');
  ['내돈내산', '광고 아님', '광고아님', '협찬 아님', '협찬아님', '제 돈 주고', '직접 구매'].forEach((w) => {
    if (bodyAll.includes(w) || draft.title.includes(w)) E.push(`협찬 글 거짓 부인 표현(위법): "${w}"`);
  });
}

// 8. 보험 광고 주의어 (금융소비자보호법·보험업법 광고 규제 — 법률 자문 아님, 소속사 준법감시 기준 우선)
const INS_BANNED = ['무조건 보장', '무조건 나옵', '100% 보장', '100% 지급', '손해 없', '원금 보장', '확정 수익', '절대 손해', '가장 저렴', '최저 보험료', '업계 최저', '보험료 0원', '무심사', '누구나 가입', '평생 보장해', '거절 없'];
INS_BANNED.forEach((w) => { if (bodyAll.includes(w) || draft.title.includes(w)) E.push(`보험 광고 금지·오인 표현: "${w}"`); });
if (/(삼성|한화|교보|DB|KB|현대해상|메리츠|흥국|롯데|NH|동양|신한|미래에셋|라이나|AIA|처브|ABL|푸본|하나)\S{0,6}(보험|생명|손보|화재)/.test(bodyAll)) {
  W.push('특정 보험사명 언급 — 상품 비교·우열 표현은 광고 규제 대상. 상품광고면 소속사 심의 필요');
}
if (meta.adType === '상품광고') {
  if (!meta.reviewNumber) E.push('상품광고 글: meta.reviewNumber(소속사 광고심의필 번호) 없음 — 심의 전 임시저장 금지');
  else (bodyAll.includes(meta.reviewNumber) ? OK : E).push('본문에 심의필 번호 표기');
} else if (!meta.adType) W.push('meta.adType 없음 ("정보성" | "상품광고")');

// 9. 태그·동영상·지도
const tags = D.cleanTags(draft.tags);
(tags.length >= 5 && tags.length <= 10 ? OK : W).push(`태그 ${tags.length}개 (권장 5~10)`);
if (draft.video) {
  const vt = D.videoTitle(draft);
  OK.push(`동영상 제목 "${vt}" (${[...vt].length}/40자)`);
}
if (meta.local && !draft.place) W.push('지역 업종 글인데 place 없음 (지도 필수)');

// 10. 페르소나
if (!meta.persona) E.push('meta.persona 없음 — 검색자 1명(지역·나이·직책·상황·감정)을 정의할 것');

// 출력
console.log(`\n■ 초안 검수: ${draft.title}`);
if (meta.persona) console.log(`  페르소나: ${meta.persona}`);
OK.forEach((x) => console.log('  ✓ ' + x));
W.forEach((x) => console.log('  ⚠ ' + x));
E.forEach((x) => console.log('  ✗ ' + x));
console.log(`\n결과: 오류 ${E.length} · 경고 ${W.length} · 통과 ${OK.length}`);
process.exit(E.length ? 1 : 0);
