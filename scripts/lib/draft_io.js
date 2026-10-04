// 초안 JSON 로드·정규화·기대값(검증용) 생성 — naver_draft.js / lint_draft.js 공용
'use strict';

const fs = require('fs');
const path = require('path');
const { ROOT } = require('./common');

// card = render_cards.js 로 HTML→PNG 렌더한 이미지 / link = 제휴 링크 (mode: card=링크 카드, text=텍스트 링크)
const BLOCK_TYPES = ['text', 'subtitle', 'image', 'quote', 'divider', 'card', 'link'];

// 비교용 정규화: 공백·제로폭·nbsp 제거
const norm = (s) => String(s || '').replace(/[\s​‌‍﻿ ]/g, '');

function loadDraft(p) {
  const abs = path.resolve(ROOT, p);
  const draft = JSON.parse(fs.readFileSync(abs, 'utf8'));
  draft.__path = abs;
  draft.__name = path.basename(abs).replace(/\.json$/, '');
  return draft;
}

/** 구조 검증 — 실행 전에 막아야 할 오류(err)와 경고(warn) */
function validateStructure(draft) {
  const err = [];
  const warn = [];
  if (!draft.title || typeof draft.title !== 'string') err.push('title 없음');
  if (!Array.isArray(draft.blocks) || !draft.blocks.length) err.push('blocks 없음');
  (draft.blocks || []).forEach((b, i) => {
    if (!BLOCK_TYPES.includes(b.type)) err.push(`blocks[${i}] 알 수 없는 type: ${b.type}`);
    if (['text', 'subtitle', 'quote'].includes(b.type) && !String(b.text || '').trim()) err.push(`blocks[${i}] ${b.type} 텍스트 비어 있음`);
    if (b.type === 'image') {
      if (!b.path) err.push(`blocks[${i}] image.path 없음`);
      else if (!fs.existsSync(path.resolve(ROOT, b.path))) err.push(`blocks[${i}] 사진 파일 없음: ${b.path}`);
    }
    if (b.type === 'card') {
      if (!b.template) err.push(`blocks[${i}] card.template 없음`);
      if (!b.path || !fs.existsSync(path.resolve(ROOT, b.path))) err.push(`blocks[${i}] 카드 미렌더 — 먼저 node scripts/render_cards.js ${'<초안>'} 실행`);
    }
    if (b.type === 'link') {
      if (!/^https:\/\//.test(String(b.url || ''))) err.push(`blocks[${i}] link.url 이 https 주소가 아님`);
      if (b.mode === 'text' && !String(b.text || '').trim()) err.push(`blocks[${i}] 텍스트 링크에 text 없음`);
    }
  });
  const imgs = (draft.blocks || []).filter((b) => b.type === 'image' || b.type === 'card').map((b) => b.path).filter(Boolean);
  const dup = imgs.filter((p, i) => imgs.indexOf(p) !== i);
  if (dup.length) err.push(`사진 재사용 금지 — 중복: ${[...new Set(dup)].join(', ')}`);
  if (!(draft.blocks || []).some((b) => b.type === 'text')) err.push('text 블록이 최소 1개 필요');

  if (draft.tags && !Array.isArray(draft.tags)) err.push('tags 는 배열이어야 함');
  if (draft.place && !draft.place.query) err.push('place.query 없음');
  if (draft.video) {
    if (!draft.video.path) err.push('video.path 없음');
    else if (!fs.existsSync(path.resolve(ROOT, draft.video.path))) err.push(`동영상 파일 없음: ${draft.video.path}`);
  }
  return { err, warn };
}

function cleanTags(tags) {
  const out = [];
  for (const t of tags || []) {
    const v = String(t).replace(/^#+/, '').trim();
    if (v && !out.includes(v)) out.push(v);
  }
  return out.slice(0, 30);
}

function videoTitle(draft) {
  const t = (draft.video && draft.video.title) || draft.title || '영상';
  return [...t].slice(0, 40).join('');
}

/** 실제 입력 순서 (video 는 첫 text 블록 직후 삽입) */
function insertionPlan(draft) {
  const plan = [];
  let videoDone = !draft.video;
  for (const b of draft.blocks) {
    plan.push(b);
    if (!videoDone && b.type === 'text') {
      plan.push({ type: 'video', path: draft.video.path, title: videoTitle(draft) });
      videoDone = true;
    }
  }
  if (draft.place) plan.push({ type: 'place', ...draft.place });
  return plan;
}

/** 검증용 기대 텍스트 시퀀스 + 컴포넌트 타입 시퀀스 */
function expectations(draft) {
  const texts = [];
  const types = [];
  const links = [];
  for (const b of insertionPlan(draft)) {
    if (b.type === 'text') String(b.text).split('\n').forEach((l) => l.trim() && texts.push(l));
    if (b.type === 'subtitle' || b.type === 'quote') texts.push(b.text);
    if (b.type === 'image' || b.type === 'card') {
      types.push('image');
      if (b.caption) texts.push(b.caption);
    }
    if (b.type === 'link') {
      links.push(b.url);
      if (b.mode === 'text') texts.push(b.text);
    }
    if (b.type === 'quote') types.push('quote');
    if (b.type === 'divider') types.push('divider');
    if (b.type === 'video') types.push('video');
    if (b.type === 'place') types.push('place');
  }
  return { texts, types, links };
}

/** 사람이 그대로 붙여넣을 수 있는 수동 원고 */
function manualManuscript(draft) {
  const L = [];
  L.push(`[제목] ${draft.title}`, '');
  for (const b of insertionPlan(draft)) {
    if (b.type === 'text') L.push(b.text, '');
    if (b.type === 'subtitle') L.push(`[소제목 · 문단서식 "소제목" · 크기 19] ${b.text}`, '');
    if (b.type === 'quote') L.push(`[인용구] ${b.text}`, '');
    if (b.type === 'divider') L.push('[구분선]', '');
    if (b.type === 'image') L.push(`[사진] ${b.path}${b.caption ? `  / 캡션: ${b.caption}` : ''}`, '');
    if (b.type === 'card') L.push(`[카드 이미지 · ${b.template}] ${b.path}${b.caption ? `  / 캡션: ${b.caption}` : ''}`, '');
    if (b.type === 'link') L.push(b.mode === 'text' ? `[텍스트 링크] ${b.text} → ${b.url}` : `[링크 카드 — URL 붙여넣기] ${b.url}`, '');
    if (b.type === 'video') L.push(`[동영상] ${b.path}  / 제목: ${b.title}`, '');
    if (b.type === 'place') L.push(`[지도] 검색어: ${b.query}${b.name ? ` / 장소명: ${b.name}` : ''}`, '');
  }
  const tags = cleanTags(draft.tags);
  if (tags.length) L.push(`[태그] ${tags.map((t) => '#' + t).join(' ')}`);
  return L.join('\n');
}

module.exports = { norm, loadDraft, validateStructure, cleanTags, videoTitle, insertionPlan, expectations, manualManuscript };
