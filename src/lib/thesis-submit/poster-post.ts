/**
 * 예비심사 공고 포스터 → 게시물 본문 — **서버 전용** 공용 조각.
 *
 * 쓰는 곳:
 *   - POST /api/thesis-submit/notice  (학생 제출 — 비공개 행)
 *   - POST /api/admin/thesis/post     (교직원 공고 양식 — 바로 게시·수정)
 * 두 경로 모두 브라우저 렌더러(poster-canvas.ts 의 posterPngBlob)가 만든 PNG 한 장을 R2 에
 * 올리고, 그 이미지 한 장을 본문으로 하는 학위논문심사 글을 만든다(기존 게시판 관례).
 * 규격 검사·R2 키·본문 조립이 두 곳에서 어긋나지 않게 여기 한 벌만 둔다.
 */
import { withRandomSuffix } from '@/lib/admin/r2';
import { sanitizeEditorHtml } from '@/lib/admin/sanitize';
import { POSTER_EXPORT_SIZE, posterAlt, type ThesisNoticeInput } from './notice';

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** PNG 시그니처 + 첫 청크가 IHDR 이고 폭·높이가 내보내기 규격(2105×1488)과 정확히 같은가.
 *  브라우저 렌더러(poster-canvas.ts 의 posterPngBlob)가 만든 파일만 받으려는 것 —
 *  임의 이미지를 게시판 본문으로 밀어 넣는 통로가 되지 않게 한다. */
export function isPosterPng(b: Buffer): boolean {
  if (b.length < 33) return false;
  for (let i = 0; i < PNG_SIGNATURE.length; i++) if (b[i] !== PNG_SIGNATURE[i]) return false;
  if (b.readUInt32BE(8) !== 13 || b.toString('latin1', 12, 16) !== 'IHDR') return false;
  return b.readUInt32BE(16) === POSTER_EXPORT_SIZE.width && b.readUInt32BE(20) === POSTER_EXPORT_SIZE.height;
}

/** R2 키 — 기존 업로드 관례(uploads/<게시판>/<시각>-<이름>) + 랜덤 접미사.
 *  학생 이름은 키에 넣지 않는다(공개 URL 에 개인정보를 싣지 않는다).
 *  수정할 때도 언제나 새 키다 — 업로드 캐시 헤더가 immutable 이라 같은 키를 덮어쓰면
 *  브라우저·이미지 최적화 캐시가 옛 포스터를 계속 보여 준다(r2.ts UPLOAD_CACHE_CONTROL). */
export function posterKey(notice: Pick<ThesisNoticeInput, 'date'>, now: number): string {
  const ymd = notice.date.replace(/-/g, '').slice(2);
  return withRandomSuffix(`uploads/thesis/${now}-preliminary-${ymd}.png`);
}

function escAttr(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** 게시물 본문 — 포스터 이미지 한 장(대체 텍스트 = 포스터에 든 글 전부, WCAG 1.1.1).
 *  정화된 HTML 이다. 정화가 이미지를 떨어뜨렸는지(허용 스킴 밖 URL 등)는 호출부가
 *  `body.includes(url)` 로 확인하고, 떨어졌으면 저장하지 않는다(빈 게시물 방지). */
export function posterBodyHtml(notice: ThesisNoticeInput, posterUrl: string): string {
  return sanitizeEditorHtml(`<p><img src="${escAttr(posterUrl)}" alt="${escAttr(posterAlt(notice))}"></p>`);
}
