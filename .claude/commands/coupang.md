---
description: 쿠팡파트너스 구매가이드·비교글 (별도 shop 블로그) — 사용자가 준 상품정보·후기로만, 정직 리서치형
argument-hint: [키워드 또는 품목] / [비교할 상품 2~5개 + 파트너스 링크]
---

# /coupang — 구매가이드·비교글 초안 → 승인 → shop 블로그 임시저장

입력: $ARGUMENTS

CLAUDE.md §9 와 `data/shop/` 전부(playbook, blogger-profile, authority-lines, disclosure, keywords, profile, post-history, trends)를 읽고 그대로 따른다.

## 1단계 — 재료 받기 (자동 수집 금지 — 전부 사용자가 붙여넣은 것만)
아래가 없으면 한 번에 요청한다:
1. 비교할 상품 2~5개의 **파트너스 링크** (쿠팡 파트너스 → 링크 생성으로 만든 `link.coupang.com/...`)
2. 상품별 **상세 정보** (상품명·주요 스펙·구성품 — 상품 페이지에서 복사) → `drafts/<초안>.products.md` 에 저장
3. 상품별 **구매자 후기** (상품 페이지 후기 복사 — 별점 낮은 후기 포함 권장) → `drafts/<초안>.reviews.md` 에 상품별로 저장
4. 직접 써 본 제품이 있는지 (있으면 그 제품만 실사용 표현 가능 + 본인 사진)
5. 사진이 있으면 `input/photos/` (상세페이지 이미지 캡처는 저작권 문제로 사용 금지)
- 가격을 쓰려면 확인한 일시도 받는다. 없으면 가격 숫자는 쓰지 않는다.
- 네이버/쿠팡 페이지 WebFetch 는 시도하지 않는다 (자동 수집 금지 + 차단). 붙여넣기 요청.

## 2단계 — 후기 분석 (직접 센다)
- 상품별로 후기를 읽고 장점 주제 Top3 / 불만 주제 Top3 를 **건수와 함께** 집계. 분석한 총 개수 = `meta.reviewsAnalyzed`.
- 집계표를 `drafts/<초안>.reviews.md` 하단에 남긴다 (나중에 검증 가능하게).
- 불만 후기에서 "고르는 기준"을 역산한다.

## 3단계 — 설계
- 검색 의도 유형 (탐색/비교/학습/검증/시즌) → 메인 키워드 1 + 서브 2~3 (keywords.md 공식, post-history 와 중복 금지)
- 페르소나 1명, 후킹 패턴, 권위 문구(정직 리서치형)
- 상황별 결론 3줄 ("○○이면 A / △△이면 B / 고민되면 C") — 근거는 2단계 집계

## 4단계 — 초안 작성 `drafts/YYYYMMDD-<slug>.json`
- `meta.blog: "shop"`, `meta.products`, `meta.reviewsAnalyzed`, `meta.usedPersonally`, `meta.priceCheckedAt`
- playbook §2 뼈대 순서. 첫 블록 = 쿠팡 지정 문구 (일반 text).
- 카드 블록: `{ "type": "card", "template": "summary|compare|criteria|proscons|reviewstats|score|cta", "data": {...}, "caption": "..." }` — 카드 내용은 텍스트로도 반드시 쓴다.
- 링크 블록: `{ "type": "link", "mode": "card", "url": "..." }` (링크 카드) 또는 `{ "type": "link", "mode": "text", "text": "가격·최신 후기 확인하기", "url": "..." }`
- 후기는 "구매자 후기에서는 ~"로. 써 본 척 금지.

## 5단계 — 렌더 + 검수
1. `node scripts/render_cards.js drafts/<초안>.json` → 카드 PNG 를 **전부 Read 로 열어** 글자 잘림·정렬 확인
2. `node scripts/lint_shop.js drafts/<초안>.json` → 오류 0 까지 수정
3. 자가 질문: "모바일에서 소제목·인용구·카드만 훑어도 무엇을 사야 할지 결정되는가?"

## 6단계 — 검수 보고 → 승인 대기
페르소나 / 키워드 / 후기 집계 요약(건수) / 상황별 결론 / lint 결과 / 카드 목록 / 링크 목록(상품↔링크 매칭 확인!) / 전문 미리보기. **승인 전 저장 금지.**

## 7단계 — 임시저장 (shop 세션)
1. `node scripts/naver_draft.js drafts/<초안>.json --dry-run` (meta.blog 로 shop 세션 자동 선택)
2. → `node scripts/naver_draft.js drafts/<초안>.json`
3. `drafts/<초안>.verify/post-dump.json` 의 `links` 가 초안 링크와 전부 일치하는지 **직접 확인** (링크가 틀리면 수익 0). 스크린샷도 Read.
4. 실패 시 probe(`--blog shop`)로 실측 → 수정 → dry-run. 3회 실패 시 manual.txt.

## 8단계 — 완료 보고
`! 수동 필요` 항목 / 발행 체크리스트(하루 1건 이하, 24시간 수정·링크 교체 금지, 첫 줄 표기 문구 육안 확인) / `data/shop/post-history.md` 1줄 추가.
