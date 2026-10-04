#!/usr/bin/env node
// 사진 모자이크 — 원본은 절대 덮어쓰지 않고 input/photos/_mosaic/ 에 처리본 생성.
// 사용: node scripts/mosaic.js drafts/<이름>.mosaic.json
//
// spec 형식:
// {
//   "pad": 0.15,                       // (선택) 영역 상하좌우 여유 비율, 기본 0.15
//   "items": [
//     { "src": "input/photos/IMG_01.jpg",
//       "regions": [ { "x": 0.42, "y": 0.10, "w": 0.18, "h": 0.22, "reason": "타인 얼굴" } ] }
//   ]
// }
// 좌표는 0~1 상대값, **EXIF 회전 보정 후(사람 눈에 보이는 화면) 기준**.
//
// 구현 함정(실측):
//  1) 좌표 기준은 반드시 .rotate() 로 EXIF 회전을 먼저 반영한 뒤의 크기.
//  2) sharp 는 한 파이프라인에 resize 가 1회만 적용된다 → 축소(버퍼) / 확대(nearest) 2단계로 분리.
'use strict';

const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const ROOT = path.resolve(__dirname, '..');
const OUT_DIR = path.join(ROOT, 'input', 'photos', '_mosaic');

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

async function pixelate(buf, left, top, width, height, block) {
  // 1단계: 영역 추출 + 축소 → 버퍼
  const smallW = Math.max(1, Math.round(width / block));
  const smallH = Math.max(1, Math.round(height / block));
  const small = await sharp(buf)
    .extract({ left, top, width, height })
    .resize(smallW, smallH, { fit: 'fill' })
    .toBuffer();
  // 2단계: 별도 파이프라인에서 nearest 로 원래 크기 확대
  return sharp(small).resize(width, height, { fit: 'fill', kernel: 'nearest' }).toBuffer();
}

async function processItem(item, padDefault) {
  const src = path.resolve(ROOT, item.src);
  if (!fs.existsSync(src)) throw new Error(`원본 없음: ${item.src}`);

  // EXIF 회전 보정된 화면 기준 버퍼 (메타데이터 제거 → GPS 등도 함께 제거됨)
  const oriented = await sharp(src).rotate().toBuffer();
  const meta = await sharp(oriented).metadata();
  const W = meta.width;
  const H = meta.height;
  const pad = item.pad ?? padDefault;
  const block = Math.max(10, Math.round(Math.min(W, H) / 45));

  const composites = [];
  const report = [];
  for (const r of item.regions || []) {
    const px = r.w * pad;
    const py = r.h * pad;
    const x0 = clamp(r.x - px, 0, 1);
    const y0 = clamp(r.y - py, 0, 1);
    const x1 = clamp(r.x + r.w + px, 0, 1);
    const y1 = clamp(r.y + r.h + py, 0, 1);
    const left = Math.floor(x0 * W);
    const top = Math.floor(y0 * H);
    const width = Math.max(1, Math.min(W - left, Math.ceil((x1 - x0) * W)));
    const height = Math.max(1, Math.min(H - top, Math.ceil((y1 - y0) * H)));
    const input = await pixelate(oriented, left, top, width, height, block);
    composites.push({ input, left, top });
    report.push({ reason: r.reason || '', px: { left, top, width, height } });
  }

  fs.mkdirSync(OUT_DIR, { recursive: true });
  const ext = path.extname(src).toLowerCase();
  const base = path.basename(src, path.extname(src));
  const outPath = path.join(OUT_DIR, `${base}_m${ext === '.png' ? '.png' : '.jpg'}`);
  if (path.resolve(outPath) === src) throw new Error('원본 덮어쓰기 방지');

  let pipe = sharp(oriented).composite(composites);
  pipe = ext === '.png' ? pipe.png() : pipe.jpeg({ quality: 92 });
  await pipe.toFile(outPath);

  return { src: item.src, out: path.relative(ROOT, outPath), size: `${W}x${H}`, regions: report };
}

(async () => {
  const specPath = process.argv[2];
  if (!specPath) {
    console.error('사용: node scripts/mosaic.js drafts/<이름>.mosaic.json');
    process.exit(1);
  }
  const spec = JSON.parse(fs.readFileSync(path.resolve(ROOT, specPath), 'utf8'));
  const pad = spec.pad ?? 0.15;
  const results = [];
  for (const item of spec.items || []) {
    const r = await processItem(item, pad);
    results.push(r);
    console.log(`✓ ${r.src} → ${r.out} (${r.regions.length}개 영역: ${r.regions.map((x) => x.reason).join(', ')})`);
  }
  const reportPath = path.resolve(ROOT, specPath).replace(/\.json$/, '') + '.result.json';
  fs.writeFileSync(reportPath, JSON.stringify(results, null, 2));
  const total = results.reduce((a, r) => a + r.regions.length, 0);
  console.log(`\n모자이크 처리: ${results.length}장 · ${total}개 영역 → 결과 ${path.relative(ROOT, reportPath)}`);
  console.log('※ 처리본을 반드시 직접 열어 실제로 가려졌는지 확인할 것 (덜 가려졌으면 좌표를 키워 재실행).');
})().catch((e) => {
  console.error('✗', e.message);
  process.exit(1);
});
