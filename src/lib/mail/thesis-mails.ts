/**
 * 학위논문 예비심사 공고 — 메일 4종(HTML 한 통씩). 받는 사람이 학생·학과 교직원이라 한국어 고정.
 *
 *   1 receiptMail   학생 — 접수 확인(접수번호)
 *   2 officeMail    학과 담당자 — 새 제출 알림(대기 1건 / 여러 건 변형)
 *   3 publishedMail 학생 — 게시 안내
 *   4 rejectedMail  학생 — 반려 안내(사유 + 담당자 메시지 + 다시 제출하기)
 *
 * 디자인 원본: Claude Design "학위논문심사 메일 4종"(https://claude.ai/artifact/2T49XBSezNL9dpEeGh18ah).
 * 구조·색·문구를 그대로 옮겼다 — 표 레이아웃 + 인라인 style, 520 폭, 시스템 한글 폰트, 각진 모서리,
 * 배경색은 bgcolor 속성과 background-color 를 **둘 다** 적는다(다크모드 클라이언트가 한쪽만
 * 뒤집는 경우가 있다). 메일 문법의 근거는 otp-email.ts 머리 주석과 같다.
 * 디자인 이후 바뀐 점: 과정은 박사과정·통합과정(석사 없음), 지도교수 행 없음(받지 않는다),
 * 담당자 알림에 자동 생성 포스터 이미지를 싣는다, 문의처 자리표시는 대학원 담당 교직원
 * 연락처(thesisContact)로 채운다, 접수번호는 receiptNo(notice, postId).
 *
 * ⚠️ 사용자 입력(이름·제목·장소·이메일·반려 메시지)은 전부 esc() 를 거친다 — 학생이 입력한
 *    문자열이 그대로 메일함의 HTML 이 되는 경로다. URL 도 속성값으로 이스케이프한다.
 * ⚠️ 순수 함수만 둔다(타입 외 import 는 notice.ts 뿐) — 라우트·검토 로직·시험 하네스 어디서
 *    불러도 서버 전용 모듈이 딸려 오지 않게.
 */
import type { ThesisContact } from '@/lib/thesis-submit/contact';
import { posterAlt, squash, type ThesisNoticeInput } from '@/lib/thesis-submit/notice';

export interface MailOut {
  subject: string;
  html: string;
}

// ── 표기 ─────────────────────────────────────────────────────────────────

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** 여러 줄 입력(반려 메시지) — 이스케이프 뒤 줄바꿈만 <br /> 로 살린다 */
function escLines(s: string): string {
  return esc(s.replace(/\r\n?/g, '\n').trim()).replace(/\n/g, '<br />');
}

const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

/** 심사 일시 — 디자인 표기 '2026년 4월 22일(수) 14:00'. 요일은 날짜 문자열에서 UTC 로 계산 */
export function mailWhen(date: string, time: string): string {
  const m = DATE_RE.exec(date.trim());
  if (!m) return squash(`${date} ${time}`);
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const wd = WEEKDAYS[new Date(Date.UTC(y, mo - 1, d)).getUTCDay()];
  const t = time.trim();
  return `${y}년 ${mo}월 ${d}일(${wd})${TIME_RE.test(t) ? ` ${t}` : ''}`;
}

/** 접수 시각(ISO) → '2026년 4월 15일 16:42' (KST) */
export function mailStamp(iso: string): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return iso;
  const k = new Date(t + 9 * 60 * 60 * 1000).toISOString(); // YYYY-MM-DDTHH:MM
  return `${Number(k.slice(0, 4))}년 ${Number(k.slice(5, 7))}월 ${Number(k.slice(8, 10))}일 ${k.slice(11, 16)}`;
}

/** '4월 22일' — 담당자 알림 미리보기 줄 */
function monthDay(date: string): string {
  const m = DATE_RE.exec(date.trim());
  return m ? `${Number(m[2])}월 ${Number(m[3])}일` : '';
}

// ── 블록(디자인의 인라인 스타일 그대로) ─────────────────────────────────────

const F = "'Apple SD Gothic Neo','Malgun Gothic','맑은 고딕',Helvetica,Arial,sans-serif";
const TABLE = 'border-collapse:collapse;border-spacing:0';

function eyebrow(text: string): string {
  return `<p style="margin:0;font-family:${F};font-size:12px;font-weight:700;letter-spacing:3px;color:#0057A8">${text}</p>`;
}

function heading(text: string): string {
  return `<h1 style="margin:10px 0 0;font-family:${F};font-size:20px;font-weight:700;line-height:1.4;color:#232323">${text}</h1>`;
}

/** 본문 문단 — 14px 본문색 */
function para(html: string, margin: string): string {
  return `<p style="margin:${margin};font-family:${F};font-size:14px;line-height:1.7;color:#232323">${html}</p>`;
}

/** 보조 문단 — 13px 회색(접수번호 줄·문의처·주석) */
function note(html: string, margin: string): string {
  return `<p style="margin:${margin};font-family:${F};font-size:13px;line-height:1.7;color:#6E6E6E">${html}</p>`;
}

/** 표 위 소제목 — 13px 굵게 */
function label(text: string, margin: string): string {
  return `<p style="margin:${margin};font-family:${F};font-size:13px;font-weight:700;line-height:1.5;color:#232323">${text}</p>`;
}

/** 강조 상자(접수번호·게시된 제목) — 회색 바탕 가운데 정렬 */
function hero(caption: string, valueHtml: string, big: boolean): string {
  // letter-spacing 은 마지막 글자 뒤에도 붙는다 → 같은 값(2px)만큼 왼쪽 패딩을 더 준다(디자인 값)
  const pad = big ? '18px 12px 20px 14px' : '18px 12px 20px 12px';
  const value = big ? 'font-size:24px;font-weight:700;line-height:1.35;letter-spacing:2px' : 'font-size:20px;font-weight:700;line-height:1.35;letter-spacing:0px';
  return `<table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="width:100%;margin-top:22px;${TABLE}"><tr><td align="center" bgcolor="#F4F7FB" style="background-color:#F4F7FB;border:1px solid #E0E6ED;padding:${pad}"><p style="margin:0;font-family:${F};font-size:12px;line-height:1.5;color:#6E6E6E">${caption}</p><p style="margin:6px 0 0;font-family:${F};${value};color:#003377">${valueHtml}</p></td></tr></table>`;
}

/** 이름-값 표 — 윗선은 남색 1px, 줄마다 아래 회색 선. 값은 이미 이스케이프된 HTML */
function infoTable(rows: [string, string][], marginTop: number): string {
  const tr = rows
    .map(
      ([k, v]) =>
        `<tr><td valign="top" width="84" bgcolor="#FFFFFF" style="width:84px;background-color:#FFFFFF;border-bottom:1px solid #E0E6ED;padding:11px 12px 11px 0;font-family:${F};font-size:13px;line-height:1.6;color:#6E6E6E;vertical-align:top">${k}</td><td valign="top" bgcolor="#FFFFFF" style="background-color:#FFFFFF;border-bottom:1px solid #E0E6ED;padding:11px 0;font-family:${F};font-size:14px;line-height:1.6;color:#232323;vertical-align:top">${v}</td></tr>`,
    )
    .join('');
  return `<table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="width:100%;margin-top:${marginTop}px;${TABLE};border-top:1px solid #003377">${tr}</table>`;
}

function button(href: string, text: string): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin-top:26px;${TABLE}"><tr><td bgcolor="#003377" style="background-color:#003377"><a href="${esc(href)}" style="display:inline-block;padding:13px 28px;font-family:${F};font-size:14px;font-weight:700;line-height:20px;color:#FFFFFF;text-decoration:none;background-color:#003377;border:1px solid #003377">${text}</a></td></tr></table>`;
}

function divider(): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="width:100%;margin-top:24px;${TABLE}"><tr><td bgcolor="#FFFFFF" style="background-color:#FFFFFF;border-top:1px solid #E0E6ED;font-size:0;line-height:0">&nbsp;</td></tr></table>`;
}

/** 문의처 한 줄 — 디자인의 '[전화번호] · [이메일 주소]' 자리. 연락처를 못 읽으면 사무실 이름만 */
function contactLine(contact: ThesisContact | null): string {
  if (!contact) return '문의 · 기계공학부 학과사무실';
  const reach = [contact.phone, contact.email].map((s) => squash(s)).filter(Boolean).map(esc).join(' · ');
  return `문의 · 기계공학부 ${esc(squash(contact.office))}${reach ? ` ${reach}` : ''}`;
}

/** 한 통의 뼈대 — 브랜드 바 + 흰 카드 + 바닥글 */
function layout(p: { title: string; preheader: string; body: string; footer: string }): string {
  return `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${esc(p.title)}</title>
</head>
<body style="margin:0;padding:0;background-color:#F4F7FB">
<div style="display:none;max-height:0;overflow:hidden">${esc(p.preheader)}</div>
<table role="presentation" cellpadding="0" cellspacing="0" width="100%" bgcolor="#F4F7FB" style="width:100%;background-color:#F4F7FB;${TABLE}">
<tr>
<td align="center" bgcolor="#F4F7FB" style="background-color:#F4F7FB;padding:32px 12px">
<table role="presentation" cellpadding="0" cellspacing="0" width="520" style="width:100%;max-width:520px;${TABLE}">
<tr>
<td bgcolor="#003377" style="background-color:#003377;padding:16px 28px;text-align:left">
<span style="font-family:${F};font-size:14px;font-weight:700;color:#FFFFFF">연세대학교 기계공학부</span><span style="display:inline-block;font-family:${F};font-size:11px;color:#8FA6C6">&nbsp;&nbsp;YONSEI MECHANICAL ENGINEERING</span>
</td>
</tr>
<tr>
<td bgcolor="#FFFFFF" style="background-color:#FFFFFF;border:1px solid #E0E6ED;border-top:0;padding:32px 28px;text-align:left">
${p.body}
</td>
</tr>
<tr>
<td align="center" bgcolor="#F4F7FB" style="background-color:#F4F7FB;padding:18px 12px 0">
<p style="margin:0;font-family:${F};font-size:12px;line-height:1.7;color:#6E6E6E">${p.footer}</p>
</td>
</tr>
</table>
</td>
</tr>
</table>
</body>
</html>`;
}

// ── 1 접수 확인(학생) ─────────────────────────────────────────────────────

export function receiptMail(p: {
  notice: ThesisNoticeInput;
  receiptNo: string;
  contact: ThesisContact | null;
}): MailOut {
  const n = p.notice;
  const no = esc(p.receiptNo);
  const body = [
    eyebrow('THESIS DEFENSE NOTICE'),
    heading('접수되었습니다'),
    para('학위논문 심사 공고 제출이 접수되었습니다. 아래 접수번호는 문의하실 때 필요하니 보관해 주세요.', '14px 0 0'),
    hero('접수번호', no, true),
    label('접수 내용', '26px 0 0'),
    infoTable(
      [
        ['심사 일시', esc(mailWhen(n.date, n.time))],
        ['장소', esc(squash(n.place))],
        ['논문 제목', esc(squash(n.title))],
      ],
      10,
    ),
    para('학과 확인 후 게시되며 보통 1~2 근무일이 걸립니다. 게시되면 이 주소로 다시 안내해 드립니다.', '18px 0 0'),
    divider(),
    note(`${contactLine(p.contact)}<br />평일 09:00–17:00`, '14px 0 0'),
  ].join('');
  return {
    subject: `[연세대 기계공학부] 학위논문 심사 공고 접수 확인 (${p.receiptNo})`,
    html: layout({
      title: '학위논문 심사 공고 접수 확인',
      preheader: `접수번호 ${p.receiptNo} — 학과 확인 후 게시됩니다`,
      body,
      footer: '연세대학교 기계공학부 · 본 메일은 학위논문 심사 공고 제출에 따라 자동 발송되었습니다',
    }),
  };
}

// ── 2 담당자 알림(학과) ───────────────────────────────────────────────────

export function officeMail(p: {
  latest: {
    notice: ThesisNoticeInput;
    email: string;
    submittedAt: string;
    receiptNo: string;
    posterUrl?: string;
  };
  pendingTotal: number;
  consoleUrl: string;
}): MailOut {
  const { notice: n, email, submittedAt, receiptNo, posterUrl } = p.latest;
  // 방금 들어온 건이 포함된 대기 건수 — 조회에 실패해 0 이 와도 최소 1건이다
  const total = Math.max(1, Math.floor(p.pendingTotal) || 1);
  const multi = total > 1;
  const presenter = squash(n.presenter);
  const program = squash(n.program);

  const rows: [string, string][] = [
    ['성명', esc(presenter)],
    ...(program ? ([['과정', esc(program)]] as [string, string][]) : []),
    ['심사 일시', esc(mailWhen(n.date, n.time))],
    ['접수 시각', esc(mailStamp(submittedAt))],
    ['제출 메일', esc(email)],
    ['접수번호', esc(receiptNo)],
  ];
  const poster = posterUrl
    ? `<img src="${esc(posterUrl)}" alt="${esc(posterAlt(n))}" width="464" style="display:block;width:100%;max-width:464px;height:auto;margin-top:18px;border:1px solid #E0E6ED" />`
    : '';

  const others = `${esc(presenter)} 외 ${total - 1}건`;
  const body = [
    eyebrow('CONTENT MANAGEMENT'),
    heading(`새 심사 공고 제출 ${total}건`),
    multi
      ? para(`검토를 기다리는 학위논문 심사 공고가 ${total}건 있습니다. 가장 최근 제출 건은 아래와 같습니다.`, '14px 0 0')
      : para('학위논문 심사 공고가 새로 제출되었습니다. 내용을 확인한 뒤 게시하거나 반려해 주세요.', '14px 0 0'),
    multi ? label(others, '26px 0 0') : '',
    infoTable(rows, multi ? 10 : 22),
    poster,
    button(p.consoleUrl, '검토하기'),
    divider(),
    note('이 알림은 학위논문심사 게시판 담당자에게만 발송됩니다.', '14px 0 0'),
  ].join('');

  const preheader = multi
    ? `${presenter} 외 ${total - 1}건 — 검토를 기다리고 있습니다`
    : `${[presenter, program, monthDay(n.date) && `${monthDay(n.date)} 심사`].filter(Boolean).join(' · ')} — 검토를 기다리고 있습니다`;
  return {
    subject: multi
      ? `[기계공학부] 심사 공고 검토 대기 ${total}건 — ${presenter} 외 ${total - 1}건`
      : `[기계공학부] 새 심사 공고 제출 — ${presenter}`,
    html: layout({
      title: `새 심사 공고 제출 ${total}건`,
      preheader,
      body,
      footer: '연세대학교 기계공학부 · 본 메일은 학위논문 심사 공고 제출 알림으로 자동 발송되었습니다',
    }),
  };
}

// ── 3 게시 안내(학생) ─────────────────────────────────────────────────────

export function publishedMail(p: {
  notice: ThesisNoticeInput;
  receiptNo: string;
  postTitle: string;
  postUrl: string;
  contact: ThesisContact | null;
}): MailOut {
  const title = squash(p.postTitle);
  const body = [
    eyebrow('THESIS DEFENSE NOTICE'),
    heading('공고가 게시되었습니다'),
    para('학과 확인을 마치고 학위논문심사 게시판에 공고를 게시했습니다.', '14px 0 0'),
    hero('게시된 제목', esc(title), false),
    button(p.postUrl, '게시된 공고 보기'),
    note(`접수번호 ${esc(p.receiptNo)}`, '18px 0 0'),
    divider(),
    note('내용 수정이 필요하면 학과사무실로 접수번호와 함께 알려 주세요.', '14px 0 0'),
    note(contactLine(p.contact), '4px 0 0'),
  ].join('');
  return {
    subject: `[연세대 기계공학부] 학위논문 심사 공고가 게시되었습니다 — ${title}`,
    html: layout({
      title: '학위논문 심사 공고 게시 안내',
      preheader: `${title} — 학위논문심사 게시판에 게시되었습니다`,
      body,
      footer: '연세대학교 기계공학부 · 본 메일은 학위논문 심사 공고 게시에 따라 자동 발송되었습니다',
    }),
  };
}

// ── 4 반려 안내(학생) ─────────────────────────────────────────────────────

export function rejectedMail(p: {
  notice: ThesisNoticeInput;
  receiptNo: string;
  reason: string;
  message: string;
  resubmitUrl: string;
  contact: ThesisContact | null;
}): MailOut {
  const message = p.message.trim();
  const box = message
    ? `<table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="width:100%;margin-top:14px;${TABLE}"><tr><td bgcolor="#F4F7FB" style="background-color:#F4F7FB;border:1px solid #E0E6ED;padding:18px 20px"><p style="margin:0;font-family:${F};font-size:12px;font-weight:700;line-height:1.5;color:#6E6E6E">담당자 메시지</p><p style="margin:8px 0 0;font-family:${F};font-size:14px;line-height:1.7;color:#232323">${escLines(message)}</p><p style="margin:10px 0 0;font-family:${F};font-size:13px;line-height:1.6;color:#6E6E6E">기계공학부 학과사무실</p></td></tr></table>`
    : '';
  const body = [
    eyebrow('THESIS DEFENSE NOTICE'),
    heading('제출하신 공고를 확인해 주세요'),
    para(
      '제출하신 학위논문 심사 공고를 검토하는 중에 확인이 필요한 부분이 있어 아직 게시하지 않았습니다. 아래 내용을 확인하신 뒤 다시 제출해 주세요.',
      '14px 0 0',
    ),
    label('확인이 필요한 부분', '24px 0 0'),
    `<p style="margin:8px 0 0"><span style="display:inline-block;padding:5px 10px;border:1px solid #0057A8;background-color:#FFFFFF;font-family:${F};font-size:13px;font-weight:700;line-height:1.4;color:#0057A8">${esc(squash(p.reason))}</span></p>`,
    box,
    button(p.resubmitUrl, '다시 제출하기'),
    note(`접수번호 ${esc(p.receiptNo)}`, '18px 0 0'),
    divider(),
    note('확인이 어렵거나 궁금한 점이 있으면 학과사무실로 편하게 문의해 주세요.', '14px 0 0'),
    note(contactLine(p.contact), '4px 0 0'),
  ].join('');
  return {
    subject: `[연세대 기계공학부] 제출하신 심사 공고를 확인해 주세요 (${p.receiptNo})`,
    html: layout({
      title: '학위논문 심사 공고 확인 요청',
      preheader: '제출하신 심사 공고에 확인이 필요한 부분이 있습니다',
      body,
      footer: '연세대학교 기계공학부 · 본 메일은 학위논문 심사 공고 검토 결과에 따라 자동 발송되었습니다',
    }),
  };
}
