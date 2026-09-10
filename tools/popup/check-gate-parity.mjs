// 팝업 노출 판정 **두 벌 대조** — `npm run check:popup`
//
// src/lib/popup-visibility.ts 에는 같은 규칙이 두 번 있다.
//   (1) selectVisiblePopups        — React(PopupNotice)가 마운트 뒤에 쓰는 TS 원본
//   (2) POPUP_GATE_SELECT_SOURCE   — 첫 페인트 전에 도는 인라인 게이트가 실행할 ES5 사본
// 둘이 달라지면 "첫 화면에 떴다가 하이드레이션 직후 사라지는" 최악의 증상이 난다.
// 이 하네스는 (2)를 node:vm 으로 그대로 평가해 (1)과 같은 답을 내는지 확인한다.
//
// 규칙(페이지·기기·기간·오늘 하루 보지 않기)을 고쳤다면 **두 벌을 함께** 고치고
// 이 파일을 돌려라. 케이스가 부족하다 싶으면 여기에 더 넣는다.

import vm from 'node:vm';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

// .ts 를 Node 가 그대로 읽는다(24 의 타입 스트리핑) — popup-visibility.ts 에 런타임
// import 가 없어서 가능한 일이다. 값 import 를 추가하면 여기서 깨진다.
const here = path.dirname(fileURLToPath(import.meta.url));
const target = pathToFileURL(path.resolve(here, '../../src/lib/popup-visibility.ts'));
const { selectVisiblePopups, POPUP_GATE_SELECT_SOURCE } = await import(target.href);

/** 게이트 사본을 진짜 함수로 — 브라우저가 <script> 안에서 하는 것과 같은 평가다 */
const gateSelect = vm.runInNewContext(`(${POPUP_GATE_SELECT_SOURCE})`);

// ── 케이스 ────────────────────────────────────────────────────────────
const NOW = '2026-09-11T12:00';

/** 레코드 만들기 — 지정하지 않은 필드는 **아예 없다**(옛 항목 재현) */
const rec = (id, extra = {}) => ({ id, ...extra });

const RECORDS = {
  /** 필드가 하나도 없는 옛 항목 — 홈·두 기기·기간 무제한으로 봐야 한다 */
  bare: rec('bare'),
  home: rec('home', { pages: ['home'], devices: ['desktop', 'mobile'] }),
  about: rec('about', { pages: ['about'] }),
  multi: rec('multi', { pages: ['home', 'about', 'research'] }),
  deskOnly: rec('desk', { pages: ['home'], devices: ['desktop'] }),
  mobOnly: rec('mob', { pages: ['home'], devices: ['mobile'] }),
  emptyArrays: rec('empty', { pages: [], devices: [] }),
  window: rec('win', { pages: ['home'], start: '2026-09-01T00:00', end: '2026-09-30T23:59' }),
  future: rec('future', { pages: ['home'], start: '2027-01-01T00:00' }),
  past: rec('past', { pages: ['home'], end: '2020-01-01T00:00' }),
  startOnly: rec('startOnly', { pages: ['home'], start: '2026-09-11T12:00' }), // 경계: 같은 분
  endOnly: rec('endOnly', { pages: ['home'], end: '2026-09-11T12:00' }), // 경계: 같은 분
  blankRange: rec('blank', { pages: ['home'], start: '', end: '' }),
  hideMe: rec('hideMe', { pages: ['home'] }),
};

const ALL = Object.values(RECORDS);
const none = () => false;
const hides = (...ids) => (id) => ids.includes(id);

/** [이름, 레코드 배열, ctx] */
const CASES = [
  ['빈 목록', [], { section: 'home', device: 'desktop', now: NOW, isHidden: none }],
  ['옛 항목(필드 없음)·홈·PC', [RECORDS.bare], { section: 'home', device: 'desktop', now: NOW, isHidden: none }],
  ['옛 항목·홈·모바일', [RECORDS.bare], { section: 'home', device: 'mobile', now: NOW, isHidden: none }],
  ['옛 항목은 홈 밖에서 안 뜬다', [RECORDS.bare], { section: 'about', device: 'desktop', now: NOW, isHidden: none }],
  ['빈 배열은 기본값과 같다·홈', [RECORDS.emptyArrays], { section: 'home', device: 'mobile', now: NOW, isHidden: none }],
  ['빈 배열은 기본값과 같다·홈 밖', [RECORDS.emptyArrays], { section: 'news', device: 'mobile', now: NOW, isHidden: none }],
  ['about 전용은 홈에서 안 뜬다', [RECORDS.about], { section: 'home', device: 'desktop', now: NOW, isHidden: none }],
  ['about 전용은 about 에서 뜬다', [RECORDS.about], { section: 'about', device: 'desktop', now: NOW, isHidden: none }],
  ['여러 페이지·research', [RECORDS.multi], { section: 'research', device: 'mobile', now: NOW, isHidden: none }],
  ['여러 페이지·해당 없음', [RECORDS.multi], { section: 'graduate', device: 'mobile', now: NOW, isHidden: none }],
  ['PC 전용·PC', [RECORDS.deskOnly], { section: 'home', device: 'desktop', now: NOW, isHidden: none }],
  ['PC 전용·모바일', [RECORDS.deskOnly], { section: 'home', device: 'mobile', now: NOW, isHidden: none }],
  ['모바일 전용·PC', [RECORDS.mobOnly], { section: 'home', device: 'desktop', now: NOW, isHidden: none }],
  ['모바일 전용·모바일', [RECORDS.mobOnly], { section: 'home', device: 'mobile', now: NOW, isHidden: none }],
  ['기간 안', [RECORDS.window], { section: 'home', device: 'desktop', now: NOW, isHidden: none }],
  ['기간 앞', [RECORDS.window], { section: 'home', device: 'desktop', now: '2026-08-31T23:59', isHidden: none }],
  ['기간 뒤', [RECORDS.window], { section: 'home', device: 'desktop', now: '2026-10-01T00:00', isHidden: none }],
  ['시작 경계(같은 분)', [RECORDS.startOnly], { section: 'home', device: 'desktop', now: NOW, isHidden: none }],
  ['시작 경계 1분 전', [RECORDS.startOnly], { section: 'home', device: 'desktop', now: '2026-09-11T11:59', isHidden: none }],
  ['종료 경계(같은 분)', [RECORDS.endOnly], { section: 'home', device: 'desktop', now: NOW, isHidden: none }],
  ['종료 경계 1분 뒤', [RECORDS.endOnly], { section: 'home', device: 'desktop', now: '2026-09-11T12:01', isHidden: none }],
  ['시작만 있는 미래', [RECORDS.future], { section: 'home', device: 'desktop', now: NOW, isHidden: none }],
  ['종료만 있는 과거', [RECORDS.past], { section: 'home', device: 'desktop', now: NOW, isHidden: none }],
  ['빈 문자열 기간은 무제한', [RECORDS.blankRange], { section: 'home', device: 'desktop', now: NOW, isHidden: none }],
  ['오늘 하루 보지 않기', [RECORDS.hideMe], { section: 'home', device: 'desktop', now: NOW, isHidden: hides('hideMe') }],
  ['다른 항목만 숨김', [RECORDS.hideMe, RECORDS.home], { section: 'home', device: 'desktop', now: NOW, isHidden: hides('home') }],
  ['전체·홈·PC', ALL, { section: 'home', device: 'desktop', now: NOW, isHidden: none }],
  ['전체·홈·모바일', ALL, { section: 'home', device: 'mobile', now: NOW, isHidden: none }],
  ['전체·about·PC', ALL, { section: 'about', device: 'desktop', now: NOW, isHidden: none }],
  ['전체·홈·PC·2건 숨김', ALL, { section: 'home', device: 'desktop', now: NOW, isHidden: hides('bare', 'home') }],
  ['전체·과거 시점', ALL, { section: 'home', device: 'desktop', now: '2019-01-01T00:00', isHidden: none }],
  ['전체·먼 미래', ALL, { section: 'home', device: 'desktop', now: '2099-01-01T00:00', isHidden: none }],
  ['전체·전부 숨김', ALL, { section: 'home', device: 'mobile', now: NOW, isHidden: () => true }],
  ['순서 유지(역순 입력)', [...ALL].reverse(), { section: 'home', device: 'desktop', now: NOW, isHidden: none }],
];

// ── 대조 ──────────────────────────────────────────────────────────────
let failed = 0;
for (const [name, records, ctx] of CASES) {
  const ts = selectVisiblePopups(records, ctx).map((p) => p.id);
  const es5 = gateSelect(records, ctx);
  const same = ts.length === es5.length && ts.every((id, i) => id === es5[i]);
  if (!same) {
    failed += 1;
    console.error(`✗ ${name}\n   TS  : [${ts.join(', ')}]\n   게이트: [${es5.join(', ')}]`);
  }
}

if (failed) {
  console.error(`\n실패 ${failed}/${CASES.length} — selectVisiblePopups 와 POPUP_GATE_SELECT_SOURCE 가 어긋났다.`);
  process.exit(1);
}
console.log(`팝업 게이트 판정 일치: ${CASES.length}개 케이스 통과`);
