#!/bin/bash
# ─────────────────────────────────────────────────────────────
#  네이버 블로그 초안 공장 — macOS 실행기 (Finder 에서 더블클릭)
#  첫 실행: 필요한 프로그램 자동 설치 + 안전장치 자가 테스트
#  이후: 메뉴에서 번호만 고르면 됩니다.
#  ※ 발행은 하지 않습니다. 임시저장까지만. (발행 버튼은 사람이)
# ─────────────────────────────────────────────────────────────
cd "$(dirname "$0")" || exit 1
ROOT="$(pwd)"
SETUP_MARK=".setup-ok"

B=$'\033[1m'; G=$'\033[32m'; R=$'\033[31m'; Y=$'\033[33m'; C=$'\033[36m'; N=$'\033[0m'
ok()   { echo "${G}✓${N} $*"; }
warn() { echo "${Y}⚠${N} $*"; }
err()  { echo "${R}✗${N} $*"; }
pause(){ echo; read -r -p "엔터를 누르면 메뉴로 돌아갑니다… " _; }
confirm(){ read -r -p "$1 [y/N] " a; [ "$a" = "y" ] || [ "$a" = "Y" ]; }

# ── 1. Node.js ───────────────────────────────────────────────
ensure_node() {
  if command -v node >/dev/null 2>&1; then
    local major; major=$(node -p 'process.versions.node.split(".")[0]')
    if [ "$major" -ge 18 ]; then ok "Node.js $(node -v)"; return 0; fi
    warn "Node.js $(node -v) 는 너무 오래됐습니다 (18 이상 필요)."
  else
    warn "Node.js 가 설치되어 있지 않습니다."
  fi
  if command -v brew >/dev/null 2>&1; then
    if confirm "Homebrew 로 Node.js 를 설치할까요?"; then brew install node && return 0; fi
  fi
  echo
  echo "  ${B}Node.js 설치 방법${N}: 열리는 웹페이지에서 macOS 설치 파일(.pkg)을 받아 설치한 뒤,"
  echo "  이 파일(블로그툴.command)을 다시 더블클릭하세요."
  open "https://nodejs.org/ko/download" 2>/dev/null
  pause; exit 1
}

# ── 2. 패키지 · 브라우저 · 자가 테스트 (첫 실행 또는 업데이트 후) ──
ensure_setup() {
  local stamp; stamp="$(node -v)-$(cksum < package.json | cut -d' ' -f1)"
  if [ -f "$SETUP_MARK" ] && [ "$(cat "$SETUP_MARK")" = "$stamp" ] && [ -d node_modules ]; then return 0; fi
  echo; echo "${B}처음 실행 준비 중… (몇 분 걸릴 수 있어요)${N}"
  npm install --no-audit --no-fund || { err "npm install 실패 — 인터넷 연결을 확인하세요."; pause; exit 1; }
  ok "패키지 설치"
  if node -e "const p=require('playwright').chromium.executablePath();process.exit(require('fs').existsSync(p)?0:1)" 2>/dev/null; then
    ok "브라우저(Chromium) 이미 설치됨"
  else
    npx playwright install chromium || { err "브라우저 설치 실패"; pause; exit 1; }
    ok "브라우저(Chromium) 설치"
  fi
  echo "발행 차단 안전장치 자가 테스트…"
  if npm run -s test:guard; then ok "발행 차단 가드 정상"; else err "가드 테스트 실패 — 안전을 위해 실행하지 않습니다."; pause; exit 1; fi
  echo "$stamp" > "$SETUP_MARK"
}

# ── 3. Claude Code (AI 글쓰기) ───────────────────────────────
ensure_claude() {
  if command -v claude >/dev/null 2>&1; then return 0; fi
  warn "Claude Code 가 설치되어 있지 않습니다. (AI 글쓰기에 필요 — Claude 구독 계정으로 로그인)"
  confirm "지금 설치할까요?" || return 1
  if npm install -g @anthropic-ai/claude-code; then ok "Claude Code 설치"; return 0; fi
  warn "npm 전역 설치 실패 → 공식 설치 스크립트로 재시도"
  curl -fsSL https://claude.ai/install.sh | bash && export PATH="$HOME/.local/bin:$PATH"
  command -v claude >/dev/null 2>&1 && ok "Claude Code 설치" && return 0
  err "설치 실패. 터미널에서 직접: npm install -g @anthropic-ai/claude-code"
  return 1
}

open_claude() {  # $1 = 안내할 명령
  ensure_claude || { pause; return; }
  echo
  echo "${B}Claude Code 를 엽니다.${N} 첫 실행이면 Claude 계정 로그인 창이 뜹니다."
  echo "열리면 이렇게 입력하세요:  ${C}$1${N}"
  echo "(사진은 먼저 input/photos 폴더에 넣어 두세요 · 끝내려면 /exit)"
  echo
  claude
}

# ── 4. 초안 고르기 ────────────────────────────────────────────
pick_draft() {
  local files=() f i=1
  while IFS= read -r f; do
    case "$(basename "$f")" in _*|example*) continue ;; esac
    files+=("$f")
  done < <(ls -t drafts/*.json 2>/dev/null | grep -Ev '\.(mosaic|result)\.')
  if [ ${#files[@]} -eq 0 ]; then err "drafts/ 에 초안이 없습니다. 먼저 Claude Code 에서 /write 또는 /coupang 으로 초안을 만드세요."; return 1; fi
  echo; echo "${B}초안 목록 (최근 순)${N}"
  for f in "${files[@]}"; do
    echo "  $i) $(node -e 'const d=require(process.argv[1]);console.log(`[${(d.meta&&d.meta.blog)||"insurance"}] ${d.title}`)' "$ROOT/$f")  ${C}$f${N}"
    i=$((i+1))
  done
  read -r -p "번호: " n
  if ! [[ "$n" =~ ^[0-9]+$ ]] || [ "$n" -lt 1 ] || [ "$n" -gt ${#files[@]} ]; then err "잘못된 번호"; return 1; fi
  DRAFT="${files[$((n-1))]}"
  DRAFT_BLOG=$(node -e 'const d=require(process.argv[1]);console.log((d.meta&&d.meta.blog)||"insurance")' "$ROOT/$DRAFT")
}

save_draft() {
  pick_draft || { pause; return; }
  echo; echo "${B}① 검수${N}"
  if [ "$DRAFT_BLOG" = "shop" ]; then
    node scripts/render_cards.js "$DRAFT" || { err "카드 렌더 실패"; pause; return; }
    node scripts/lint_shop.js "$DRAFT" || { err "검수 오류 — Claude Code 에서 고친 뒤 다시 실행하세요."; pause; return; }
  else
    node scripts/lint_draft.js "$DRAFT" || { err "검수 오류 — Claude Code 에서 고친 뒤 다시 실행하세요."; pause; return; }
  fi
  echo; echo "${B}② 연습 실행 (저장 안 함 · dry-run)${N}"
  node scripts/naver_draft.js "$DRAFT" --dry-run || { err "연습 실행 실패 — 로그의 '자동 처리 결과'를 확인하세요. (Claude Code 에게 로그를 보여주면 고쳐 줍니다)"; pause; return; }
  echo
  confirm "③ 연습 실행 통과. 실제로 네이버에 임시저장할까요? (발행은 하지 않습니다)" || { pause; return; }
  node scripts/naver_draft.js "$DRAFT" && ok "임시저장 완료 — 네이버 블로그 '저장 글'에서 확인 후 직접 발행하세요." \
    || err "임시저장 검증 실패 — 성공으로 보지 마세요. drafts/ 의 .manual.txt 로 수동 붙여넣기 가능."
  pause
}

choose_blog() {
  echo "  1) 보험 블로그   2) 쿠팡 블로그"
  read -r -p "번호: " b
  case "$b" in 1) BLOG=insurance ;; 2) BLOG=shop ;; *) err "잘못된 번호"; return 1 ;; esac
}

# ── 메인 ────────────────────────────────────────────────────
clear
echo "${B}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${N}"
echo "${B}   네이버 블로그 초안 공장${N}   (발행은 사람이 · 임시저장까지만)"
echo "${B}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${N}"
ensure_node
ensure_setup

while true; do
  echo
  echo "${B}무엇을 할까요?${N}"
  echo "  ${B}글쓰기${N}"
  echo "   1) 보험 블로그 글쓰기        (Claude Code → /write)"
  echo "   2) 쿠팡 비교글 쓰기          (Claude Code → /coupang)"
  echo "   3) 만든 초안 네이버에 임시저장 (검수 → 연습 → 저장)"
  echo "  ${B}준비${N}"
  echo "   4) 보험 블로그 네이버 로그인  (처음 1회)"
  echo "   5) 쿠팡 블로그 네이버 로그인  (처음 1회 · 다른 아이디)"
  echo "   6) 사진 넣는 폴더 열기"
  echo "  ${B}점검${N}"
  echo "   7) 네이버 화면 진단 (셀렉터 실측 — 문제 생겼을 때)"
  echo "   8) 안전장치·동작 자가 테스트"
  echo "   0) 종료"
  read -r -p "번호: " m
  case "$m" in
    1) open_claude "/write 소재 정보 / 한 줄 메모" ;;
    2) open_claude "/coupang 원룸 제습기 추천" ;;
    3) save_draft ;;
    4) node scripts/naver_login.js --blog insurance; pause ;;
    5) node scripts/naver_login.js --blog shop; pause ;;
    6) mkdir -p input/photos input/videos; open input/photos; ok "Finder 에서 사진 폴더를 열었습니다 (영상은 input/videos)." ;;
    7) choose_blog && node scripts/probe_selectors.js --blog "$BLOG" && echo "결과 파일은 logs/ 폴더 — Claude Code 에게 '최근 probe 결과로 셀렉터 고쳐줘'라고 하세요."; pause ;;
    8) npm run -s test:guard && npm run -s test:mock; pause ;;
    0) echo "종료합니다."; exit 0 ;;
    *) err "0~8 중에서 고르세요." ;;
  esac
done
