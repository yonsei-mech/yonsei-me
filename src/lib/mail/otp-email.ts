/**
 * 인증번호(OTP) 메일 HTML — CMS 로그인과 학위논문심사 공고 등록(학생 본인 확인)이 함께 쓴다.
 *
 * 레이아웃·색은 하나로 고정하고 **문구만** 호출부가 바꾼다(OtpEmailCopy). 기본값은 CMS
 * 로그인 문구라 `otpEmailHtml(code)` 는 추출 전 CMS 라우트가 만들던 HTML 과 바이트 단위로
 * 같다 — 받은편지함에서 이미 익숙한 메일 모양을 바꾸지 않기 위해서다.
 *
 * 이메일 클라이언트(특히 Gmail·Outlook·네이버)는 웹과 규칙이 다르다 — 여기 문법은
 * 전부 그 제약 때문이다:
 * - 레이아웃은 <table role="presentation"> + 인라인 style 만 (클래스·<style> 은 Gmail 이 제거)
 * - 웹폰트 불가 → 한글 시스템 폰트 스택
 * - 이미지 없이 텍스트 락업만 (수신측 이미지 차단이 기본값인 환경이 흔하다)
 * - 배경색은 전부 명시 (다크모드 클라이언트에서 투명 배경은 뒤집힌다)
 * - letter-spacing 은 마지막 글자 뒤에도 붙어 시각 중심이 오른쪽으로 밀린다
 *   → 코드 셀에 같은 값의 padding-left 로 보정
 *
 * ⚠️ 이 모듈은 아무것도 import 하지 않는다(순수 함수). 라우트·스크립트 어디서 불러도
 *    순환 import 가 생기지 않고, 추출 전후 동일성 검사도 이 파일 하나만 변환해 돌린다.
 */

/** 메일 한 통의 문구 — 전부 평문(HTML 은 여기서 이스케이프한다) */
export interface OtpEmailCopy {
  /** <html lang> */
  lang: string;
  /** 상단 브랜드 바의 이름 (굵게) */
  brandName: string;
  /** 브랜드 바의 영문 보조 문구 (작게, 대문자) */
  brandTagline: string;
  /** 받은편지함 미리보기 한 줄 — 본문에는 보이지 않는다 */
  preheader: string;
  /** 본문 카드 맨 위 아이브로 (영문 대문자) */
  eyebrow: string;
  /** 본문 제목 */
  heading: string;
  /** 코드 위 안내문 */
  instruction: string;
  /** 코드 아래 유효 시간 안내 */
  validity: string;
  /** 구분선 아래 주의 문구 — 줄마다 <br /> 로 잇는다 */
  cautionLines: string[];
  /** 카드 밖 푸터 한 줄 */
  footer: string;
}

/** CMS 로그인 메일 문구 — 추출 전 라우트에 박혀 있던 값 그대로 */
export function cmsOtpEmailCopy(code: string): OtpEmailCopy {
  return {
    lang: 'ko',
    brandName: '연세대학교 기계공학부',
    brandTagline: 'YONSEI MECHANICAL ENGINEERING',
    preheader: `인증번호 ${code} — 10분간 유효합니다`,
    eyebrow: 'CONTENT MANAGEMENT',
    heading: '로그인 인증번호',
    instruction: '콘텐츠 관리 콘솔 로그인 화면에 아래 번호를 입력해 주세요.',
    validity: '이 번호는 발급 후 10분간 유효합니다.',
    cautionLines: [
      '본인이 요청하지 않았다면 이 메일은 무시하셔도 됩니다.',
      '인증번호를 다른 사람에게 알려주지 마세요.',
    ],
    footer: '연세대학교 기계공학부 · 본 메일은 CMS 로그인 요청에 따라 자동 발송되었습니다',
  };
}

/** 문구 이스케이프 — 번역 문구에 & < > " 가 섞여도 마크업이 깨지지 않게 */
function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * 인증번호 메일 HTML.
 * @param code 6자리 숫자 (호출부가 생성 — 숫자만이라 이스케이프 불필요하지만 방어로 통과시킨다)
 * @param copy 문구. 생략하면 CMS 로그인 문구
 */
export function otpEmailHtml(code: string, copy: OtpEmailCopy = cmsOtpEmailCopy(code)): string {
  const font =
    "'Apple SD Gothic Neo','Malgun Gothic','맑은 고딕',Helvetica,Arial,sans-serif";
  const c = esc(code);
  const caution = copy.cautionLines.map(esc).join('<br />');
  return `<!DOCTYPE html>
<html lang="${esc(copy.lang)}">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
</head>
<body style="margin:0;padding:0;background-color:#F4F7FB">
  <!-- 프리헤더: 받은편지함 미리보기 한 줄 (본문에는 보이지 않음) -->
  <div style="display:none;max-height:0;overflow:hidden;mso-hide:all">${esc(copy.preheader)}</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#F4F7FB">
    <tr>
      <td align="center" style="padding:32px 12px">
        <!-- width 속성은 Outlook 데스크톱용(맥스폭 미지원), CSS 는 그 외 클라이언트의
             반응형(100% 를 520 에서 캡) — 하이브리드 폭 지정의 표준 문법 -->
        <table role="presentation" width="520" cellpadding="0" cellspacing="0" style="width:100%;max-width:520px">
          <!-- 상단 브랜드 바 -->
          <tr>
            <td style="background-color:#003377;padding:16px 28px">
              <span style="font-family:${font};font-size:14px;font-weight:700;color:#FFFFFF">${esc(copy.brandName)}</span>
              <!-- inline-block: 좁은 화면에서 어절 중간이 아니라 문구 전체가 둘째 줄로 내려간다 -->
              <span style="display:inline-block;font-family:${font};font-size:11px;color:#8FA6C6">&nbsp;&nbsp;${esc(copy.brandTagline)}</span>
            </td>
          </tr>
          <!-- 본문 카드 -->
          <tr>
            <td style="background-color:#FFFFFF;border:1px solid #E0E6ED;border-top:0;padding:32px 28px">
              <p style="margin:0;font-family:${font};font-size:11px;font-weight:700;letter-spacing:3px;color:#0057A8">${esc(copy.eyebrow)}</p>
              <h1 style="margin:10px 0 0;font-family:${font};font-size:20px;font-weight:700;color:#232323">${esc(copy.heading)}</h1>
              <p style="margin:14px 0 0;font-family:${font};font-size:14px;line-height:1.7;color:#232323">${esc(copy.instruction)}</p>
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:22px">
                <tr>
                  <td align="center" style="background-color:#F4F7FB;border:1px solid #E0E6ED;padding:22px 10px 22px 20px">
                    <span style="font-family:${font};font-size:34px;font-weight:700;letter-spacing:10px;color:#003377">${c}</span>
                  </td>
                </tr>
              </table>
              <p style="margin:14px 0 0;font-family:${font};font-size:13px;line-height:1.7;color:#6E6E6E">${esc(copy.validity)}</p>
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:22px">
                <tr><td style="border-top:1px solid #E0E6ED;font-size:0;line-height:0">&nbsp;</td></tr>
              </table>
              <p style="margin:14px 0 0;font-family:${font};font-size:13px;line-height:1.7;color:#6E6E6E">${caution}</p>
            </td>
          </tr>
          <!-- 푸터 -->
          <tr>
            <td align="center" style="padding:18px 12px 0">
              <p style="margin:0;font-family:${font};font-size:12px;line-height:1.7;color:#6E6E6E">${esc(copy.footer)}</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}
