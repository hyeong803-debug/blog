---
description: 설치 확인 → 발행 가드 테스트 → 네이버 1회 로그인(사용자가 직접) → 셀렉터 실측
---

# /setup-login

macOS 기준. 각 단계는 결과를 확인하고 다음으로 넘어간다.

1. 설치 확인: `node -v` (18 이상) → 없으면 `brew install node` 안내 후 중단.
2. `npm install` → `npx playwright install chromium`
3. **발행 차단 가드 테스트:** `npm run test:guard` — 전부 ✓ 가 아니면 중단하고 원인 수정 (이 툴은 가드 없이 실행하지 않는다).
4. 로그인: `node scripts/naver_login.js` 실행 → 사용자에게 안내:
   - "열린 Chromium 창에서 **직접** 네이버에 로그인해 주세요. '로그인 상태 유지' 체크 권장. 비밀번호는 이 툴이 저장하지 않습니다. (2단계 인증도 그 창에서 처리)"
   - 로그의 `✓ 로그인 세션 저장 완료` 를 확인. 실패면 재실행.
5. 셀렉터 실측: `node scripts/probe_selectors.js` → 출력의 ✓/✗ 표와 `logs/probe-*.json` 을 읽고, `scripts/naver_draft.js` 의 `S` 객체 [추정] 항목을 대조.
   - 지도/동영상 팝업은 `--open "<툴바 버튼 셀렉터>"` 로 열어 내부 DOM 까지 덤프.
   - 실측으로 확정된 값은 `[실측]` 으로 바꾸고 CLAUDE.md §6-1·§8 에 기록.
6. 안내: `naver-profile/` 은 로그인 세션 — 외부 공유 금지. 세션 만료 시 이 명령을 다시 실행.
