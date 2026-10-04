# 네이버 블로그 초안 공장

- **보험 블로그** (목포·영암·해남·강진 + 전국 유선) — `/write`
- **쿠팡파트너스 비교 블로그** (별도 네이버 아이디, 전 품목 구매가이드) — `/coupang`

사진 + 소재 + 한 줄 메모 → Claude Code가 사진을 직접 보고 글 작성 → **사용자 승인** → 네이버 **임시저장**까지.
발행 버튼은 항상 사람이 누릅니다. (코드로도 차단: `installPublishGuard`)

## 설치 (macOS, 1회)
```bash
# 1) Node.js 18+ (없으면)
brew install node

# 2) 내려받기 — 이 브랜치를 내 Mac으로
git clone -b claude/naver-blog-auto-writer-mhljxt https://github.com/hyeong803-debug/blog.git
cd blog

# 3) 패키지 + 브라우저
npm install
npx playwright install chromium

# 4) 안전장치 자가 테스트 (둘 다 ✓ 여야 함)
npm run test:guard
npm run test:mock

# 5) Claude Code 실행 후 로그인 + 셀렉터 실측
claude
> /setup-login
```

## 사용
1. 사진을 `input/photos/`에 넣는다 (영상은 `input/videos/`). 아이폰 HEIC는 Claude가 `sips`로 JPG로 바꿔 줍니다.
2. Claude Code에서 `/write 소재 정보 / 한 줄 메모`를 입력한다.
3. 질문(협찬 여부, 키워드, 모르는 사실)에 답한다 → 검수 보고를 보고 승인한다.
4. Claude가 dry-run → 임시저장 → 저장된 글을 전문 대조한다. 네이버 "저장 글"에서 확인 후 **직접 발행**한다.

### 쿠팡 비교글 (별도 블로그)
1. 처음 1회: `/setup-login shop` → 쿠팡 블로그용 **다른 네이버 아이디**로 로그인
2. `/coupang 원룸 제습기 추천` → 비교할 상품의 **파트너스 링크**, 상품 정보, 구매자 후기를 쿠팡에서 복사해 붙여넣기
3. Claude가 후기를 직접 세어 비교표·요약 카드 이미지를 만들고, 써 본 척 없이 정직한 구매가이드를 씁니다. 검수 보고 → 승인 → 임시저장 → 링크 전수 대조
4. 예시: `drafts/example-shop.json`, 카드 이미지 `drafts/example-shop.cards/`

기타 명령: `/learn-style`(내 기존 글 붙여넣기 → 문체 학습), `/analyze-trends`(상위 글 붙여넣기 → 패턴 분석)

## 꼭 알아둘 것
- 브라우저 자동화는 네이버 약관상 **회색지대**입니다. 본인 계정으로, **하루 1~2건**만 쓰세요.
- `naver-profile/`, `naver-profile-shop/` 폴더는 **로그인 세션**입니다. 외부 공유·업로드 금지 (git에서 제외됨).
- 보험 글은 금융소비자보호법·보험업법 광고 규제를 받습니다. 상품 소개 글은 소속사 심의필 번호 없이 저장하지 않습니다. (`data/insurance-compliance.md`)
- 쿠팡 글은 첫 줄에 쿠팡 지정 문구가 자동으로 들어가고, 써 보지 않은 제품을 써 본 것처럼 쓰는 표현은 검수에서 막힙니다 (표시광고법).
- 이 툴은 **"초안 공장"이지 "무인 발행기"가 아닙니다.**

자세한 규칙과 실측 지식은 [CLAUDE.md](CLAUDE.md)에 있습니다.
