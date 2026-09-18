-- 학위논문심사 공고 등록 — 학생 본인 확인 인증번호 저장소.
-- 적용 방법: Supabase 대시보드 → SQL Editor → 이 파일 전체 붙여넣기 → Run (재실행 안전).
--
-- 대학원생이 학교 이메일(@yonsei.ac.kr)로 인증번호를 받아 본인을 확인한 뒤 심사 공고를
-- 직접 제출한다(/graduate/thesis/submit). 이 테이블은 그 인증번호만 담는다.
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
