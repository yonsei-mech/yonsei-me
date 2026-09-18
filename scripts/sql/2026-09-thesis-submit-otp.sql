-- 학위논문심사 공고 등록 — 학생 본인 확인 인증번호 저장소.
-- 적용 방법: Supabase 대시보드 → SQL Editor → 이 파일 전체 붙여넣기 → Run (재실행 안전).
--
-- 대학원생이 학교 이메일(@yonsei.ac.kr)로 인증번호를 받아 본인을 확인한 뒤 심사 공고를
-- 직접 제출한다(/graduate/thesis/submit). 이 테이블은 그 인증번호만 담는다.
-- 파일 끝에 제출 기록 컬럼(posts.thesis_submission)도 함께 추가한다 — 제출 API 가 쓰므로
-- 기능을 켜기 전에 이 파일 전체를 한 번 실행하면 된다.
--
-- ⚠️ CMS 로그인(cms_users)과 **완전히 분리**된 테이블이다. 학생 인증에 cms_users 를
--    쓰면 학생에게 CMS 관리자 세션이 생긴다. 코드: src/lib/thesis-submit/otp-store.ts.
--
-- RLS 는 켜되 정책을 두지 않는다 = 서비스 롤(SUPABASE_SERVICE_ROLE_KEY)로만 접근.
-- otp_hash 는 인증번호 원문이 아니라 sha256 16진 해시다(메일 유출 시 재사용 방지).
-- IP 는 저장하지 않는다(발급 IP 제한은 서버 메모리 전용 — 개인정보 수집 항목을 늘리지 않는다).
--
-- 보관: 인증에 성공하면 행을 즉시 지우고, 발급 API 가 하루 지난 행을 그때그때 정리한다.
-- 한 번에 비우려면(언제 실행해도 안전 — 진행 중인 인증만 끊긴다):
--   delete from thesis_submit_otps where otp_sent_at < now() - interval '1 day';

create table if not exists thesis_submit_otps (
  email text primary key,
  otp_hash text,
  otp_expires_at timestamptz,
  otp_attempts int not null default 0,
  otp_sent_at timestamptz,
  created_at timestamptz default now()
);
alter table thesis_submit_otps enable row level security;

-- ── 공고 제출 기록 (posts.thesis_submission) ─────────────────────────────
-- 본인 확인을 마친 학생이 예비심사 공고를 제출하면(/api/thesis-submit/notice) 학위논문심사
-- 게시판(board='thesis')에 포스터 이미지 한 장을 본문으로 하는 글이 생긴다. 이 컬럼은 그
-- 제출 기록이다: {email, submittedAt, notice} — 누가(본인 확인된 학교 이메일)·언제·무엇을
-- (입력 원본). null = 일반 글(관리자가 CMS 로 쓴 글·이관 글).
--
-- 게시 여부는 이 컬럼이 아니라 posts.published 가 단일 출처다. 학생 제출물은 published=false
-- (학과 확인 대기)로 들어오고, 관리자가 콘솔에서 '게시하기'를 누르면 true 가 된다.
-- 반려는 글 삭제다.
--
-- ⚠️ 학생 이메일이 들어 있으므로 공개 조회에서 제외한다 — 목록은 컬럼을 명시해 읽어
--    애초에 안 실리고, 상세(select '*')는 lib/posts.ts 가 캐시에 넣기 전에 떼어 낸다.
--    (RLS 공개 읽기 정책은 행 단위라 컬럼을 가리지 못한다 — 코드가 막는 선이다.)
alter table posts add column if not exists thesis_submission jsonb;
