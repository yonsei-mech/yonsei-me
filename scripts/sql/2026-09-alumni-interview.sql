-- 동문 인터뷰(2026-09) — posts.interview 컬럼 추가
-- 적용 방법: Supabase 대시보드 → SQL Editor → 아래 한 줄 붙여넣기 → Run
--
-- ⚠️ **배포보다 먼저 실행해야 한다.** 사이트의 목록 조회(lib/posts.ts 의 LIST_COLUMNS)가
--    이 컬럼 이름을 명시적으로 싣기 때문에, 컬럼이 없는 DB 에서는 게시판 목록 조회 자체가
--    실패한다(한 게시판이 아니라 전 게시판).
--
-- 값의 모양 (null = 인터뷰가 아닌 글):
--   {
--     "name":     {"ko": "김연세", "en": "Kim Yonsei"},
--     "role":     {"ko": "○○자동차 로보틱스랩 책임연구원", "en": "..."},
--     "cohort":   "2005",
--     "closingQ": {"ko": "김연세 동문에게 ‘설계’란", "en": "..."},
--     "closingA": {"ko": "…", "en": "..."}
--   }
-- 기록은 lib/admin/posts-server.ts 의 interviewColumn(), 읽기는 lib/posts.ts 의 interviewOf().
-- closingQ·closingA 는 둘 다 채워졌을 때만 저장된다(화면도 그때만 그린다).

alter table posts add column if not exists interview jsonb;
