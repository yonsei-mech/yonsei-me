/**
 * 학위논문 예비심사 공고 제출 알림 메일(학과사무실 수신) — HTML 한 통.
 *
 * 받는 사람은 학과 교직원이라 한국어 고정이다. 레이아웃 문법은 otp-email.ts 와 같다
 * (table + 인라인 style 만, 시스템 한글 폰트, 배경색 전부 명시). 차이는 포스터 이미지 한 장 —
 * 이미지 차단 환경에서도 내용을 알 수 있게 아래에 입력 내용 표를 함께 싣는다.
 *
 * ⚠️ 사용자 입력(이름·제목·장소·이메일)은 전부 esc() 를 거친다. 학생이 입력한 문자열이
 *    그대로 학과 메일함의 HTML 이 되는 경로다.
 */
import {
  committeeEntry,
  formatWhen,
  memberEntries,
  type ThesisNoticeInput,
} from '@/lib/thesis-submit/notice';

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** ISO → 'YYYY-MM-DD HH:MM' (KST) */
export function kstStamp(iso: string): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return iso;
  return new Date(t + 9 * 60 * 60 * 1000).toISOString().slice(0, 16).replace('T', ' ');
}

export interface ThesisNoticeMail {
  /** 게시 제목 `[YYMMDD] 성명` */
  title: string;
  notice: ThesisNoticeInput;
  /** 제출자(본인 확인된 학교 이메일) */
  email: string;
  /** ISO */
  submittedAt: string;
  /** 포스터 공개 URL */
  posterUrl: string;
  /** 포스터 대체 텍스트 */
  posterAlt: string;
  /** 관리자 콘솔 학위논문심사 화면 URL */
  consoleUrl: string;
}

export function thesisNoticeMailSubject(title: string): string {
  return `[기계공학부] 예비심사 공고 제출 — ${title}`;
}

export function thesisNoticeMailHtml(m: ThesisNoticeMail): string {
  const font = "'Apple SD Gothic Neo','Malgun Gothic','맑은 고딕',Helvetica,Arial,sans-serif";
  const n = m.notice;
  const rows: [string, string][] = [
    ['과정', n.program],
    ['발표자', n.presenter],
    ['논문 제목', n.title],
    ['심사위원장', committeeEntry(n.chair)],
    ['심사위원', memberEntries(n).join(', ')],
    ['일시', formatWhen(n.date, n.time)],
    ['장소', n.place],
    ['제출자', m.email],
    ['제출 시각', `${kstStamp(m.submittedAt)} (KST)`],
  ];
  const table = rows
    .map(
      ([k, v]) => `<tr>
                  <td valign="top" style="width:88px;padding:9px 12px 9px 0;border-bottom:1px solid #E0E6ED;font-family:${font};font-size:13px;font-weight:700;color:#6E6E6E;white-space:nowrap">${esc(k)}</td>
                  <td valign="top" style="padding:9px 0;border-bottom:1px solid #E0E6ED;font-family:${font};font-size:14px;line-height:1.6;color:#232323">${esc(v)}</td>
                </tr>`,
    )
    .join('\n');

  return `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
</head>
<body style="margin:0;padding:0;background-color:#F4F7FB">
  <div style="display:none;max-height:0;overflow:hidden;mso-hide:all">${esc(m.title)} — 학과 확인 후 게시 대기 중입니다</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#F4F7FB">
    <tr>
      <td align="center" style="padding:32px 12px">
        <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:100%;max-width:600px">
          <tr>
            <td style="background-color:#003377;padding:16px 28px">
              <span style="font-family:${font};font-size:14px;font-weight:700;color:#FFFFFF">연세대학교 기계공학부</span>
              <span style="display:inline-block;font-family:${font};font-size:11px;color:#8FA6C6">&nbsp;&nbsp;THESIS DEFENSE NOTICE</span>
            </td>
          </tr>
          <tr>
            <td style="background-color:#FFFFFF;border:1px solid #E0E6ED;border-top:0;padding:28px">
              <p style="margin:0;font-family:${font};font-size:11px;font-weight:700;letter-spacing:3px;color:#0057A8">검토 대기</p>
              <h1 style="margin:10px 0 0;font-family:${font};font-size:20px;font-weight:700;color:#232323">예비심사 공고가 제출되었습니다</h1>
              <p style="margin:12px 0 0;font-family:${font};font-size:14px;line-height:1.7;color:#232323">${esc(m.title)}</p>
              <img src="${esc(m.posterUrl)}" alt="${esc(m.posterAlt)}" width="544" style="display:block;width:100%;max-width:544px;height:auto;margin-top:18px;border:1px solid #E0E6ED" />
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:18px;border-top:2px solid #003377">
                ${table}
              </table>
              <p style="margin:20px 0 0;font-family:${font};font-size:14px;line-height:1.7;color:#232323">관리자 콘솔 › 학위논문심사에서 포스터와 제목을 확인한 뒤 ‘게시하기’를 누르면 공개됩니다. 반려하려면 그 글을 삭제하세요.</p>
              <table role="presentation" cellpadding="0" cellspacing="0" style="margin-top:18px">
                <tr>
                  <td style="background-color:#003377">
                    <a href="${esc(m.consoleUrl)}" style="display:inline-block;padding:12px 22px;font-family:${font};font-size:14px;font-weight:700;color:#FFFFFF;text-decoration:none">관리자 콘솔에서 확인하기</a>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td align="center" style="padding:18px 12px 0">
              <p style="margin:0;font-family:${font};font-size:12px;line-height:1.7;color:#6E6E6E">연세대학교 기계공학부 · 본 메일은 학위논문 예비심사 공고 제출에 따라 자동 발송되었습니다</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}
