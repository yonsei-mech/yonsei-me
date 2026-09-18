-- 연세 ME 사이트 게시판 스키마 (백엔드 전환 Phase 2)
-- 적용 방법: Supabase 대시보드 → SQL Editor → 이 파일 전체 붙여넣기 → Run
-- (재실행 안전: if not exists / or replace 사용)

-- ── posts: 게시판 10종 통합 테이블 ─────────────────────────────────────
-- board 값은 기존 코드의 BoardKey 그대로:
--   noticesUndergrad | noticesGraduate | news | seminars | events |
--   thesis | resources | career | alumniNews | alumniEvents
create table if not exists posts (
  id            bigint generated always as identity primary key,
  board         text not null,
  slug          text unique,              -- 뉴스형만 사용(기존 URL 보존), 게시판형은 null
  title_ko      text not null,
  title_en      text,
  body_html_ko  text not null default '', -- 에디터 산출 HTML(서버에서 정화 후 저장)
  body_html_en  text,
  body_md_ko    text,                     -- 마크다운 원문(텍스트 에디터 수정 왕복용)
  body_md_en    text,
  excerpt_ko    text,
  excerpt_en    text,
  category      text,                     -- 뉴스: notice | seminar | achievement
  host_ko       text,                     -- 세미나형: 연사/주최
  host_en       text,
  date_label_ko text,                     -- 행사형: 표시용 일정 라벨(저장 시 서버가 시작/종료일로 자동 생성)
  date_label_en text,
  is_event      boolean not null default false,
  event_date    date,                     -- 캘린더용 시작일(있으면)
  end_date      date,                     -- 행사·세미나·동문행사 종료일(null = 하루)
  link_url      text,                     -- 일정(캘린더) 게시판: 선택 링크
  pinned        boolean not null default false, -- 목록 최상단 고정(공지형 게시판의 '중요' 글)
  thumbnail_url text,
  published     boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- (기존 설치 업그레이드) create table if not exists 는 이미 있는 테이블에 컬럼을
-- 추가하지 않으므로, 새 컬럼은 alter 로도 보강한다 — 이 파일 재실행이 곧 업그레이드.
alter table posts add column if not exists body_md_ko text;
alter table posts add column if not exists body_md_en text;
alter table posts add column if not exists end_date date;
alter table posts add column if not exists link_url text;
alter table posts add column if not exists pinned boolean not null default false;
-- 원문 모드 — true 면 본문을 화이트리스트 정화 대신 scrubRawHtml(스크립트류만 제거)로
-- 저장한다. 배경·위험 수용 범위는 scripts/sql/2026-08-post-body-raw.sql 참조.
alter table posts add column if not exists body_raw boolean not null default false;
-- 원문 게시물 주소 — 현행 학과 사이트에서 옮겨 온 글의 출처.
-- 이전 스크립트(scripts/import-boards.mjs)의 멱등 키이자 중복 적재 방지선이고,
-- 사람이 눌러 원문을 바로 대조할 수 있는 값이기도 하다. 손으로 옮긴 글은 일회성
-- 연결 스크립트(구 link-existing-posts.mjs, 완료 후 삭제)가 채웠다. 창작 글은 null 로 남는다.
alter table posts add column if not exists source_url text;
-- 이 행을 누가 만들었는가. true = 임포터가 만든 행(재크롤 시 제목·본문 갱신 대상),
-- false = 사람이 손으로 쓴 행(불가침). 손으로 옮긴 글도 source_url 은 갖는다 —
-- 중복 적재를 막아야 하기 때문이다. 하지만 그 본문은 원문을 그대로 베낀 게 아니라
-- 다듬어 쓴 것이라, 재크롤이 원문으로 덮어쓰면 품질이 되레 떨어진다.
-- 그래서 "중복 방지(source_url)" 와 "갱신 대상(import_managed)" 을 분리한다.
-- 롤백도 이 값 하나로 정확해진다: delete from posts where import_managed;
alter table posts add column if not exists import_managed boolean not null default false;
-- 동문 인터뷰(2026-09) — 동문 소식·네트워크 글의 인터뷰 헤더 정보.
-- {name:{ko,en}, role:{ko,en}, cohort:"2005", closingQ:{ko,en}, closingA:{ko,en}}
-- null 이면 인터뷰가 아닌 글(개편 이전 동문 소식)이다. 자세한 설명·주의는
-- scripts/sql/2026-09-alumni-interview.sql.
alter table posts add column if not exists interview jsonb;
-- 학생 제출 공고 기록 {email, submittedAt, notice} — null = 일반 글, 게시 여부는 published.
-- 학생 이메일이 있어 공개 조회에서 뺀다. 자세한 설명은 scripts/sql/2026-09-thesis-submit-otp.sql.
alter table posts add column if not exists thesis_submission jsonb;

create index if not exists posts_board_created_idx on posts (board, created_at desc);
create index if not exists posts_published_idx on posts (published);
-- 부분 유니크 — null(창작 글)끼리는 충돌하지 않으면서 같은 원문을 두 번 넣는 것만 막는다.
create unique index if not exists posts_source_url_key
  on posts (source_url) where source_url is not null;

-- ── attachments: 첨부 메타 (실체는 R2, 여기엔 URL 만) ──────────────────
create table if not exists attachments (
  id         bigint generated always as identity primary key,
  post_id    bigint not null references posts (id) on delete cascade,
  label_ko   text,
  label_en   text,
  url        text not null,
  sort       int not null default 0,
  size_bytes bigint            -- 파일 크기. 자료실 목록의 "PDF · 1.2MB" 표기용, null 이면 생략
);

-- (기존 설치 업그레이드) 새 칼럼은 alter 로도 보강 — 이 파일 재실행이 곧 업그레이드.
-- 구 첨부의 크기는 `node tools/backfill-attachment-sizes.mjs` 로 한 번 채운다.
alter table attachments add column if not exists size_bytes bigint;

create index if not exists attachments_post_idx on attachments (post_id);

-- ── updated_at 자동 갱신 ──────────────────────────────────────────────
create or replace function set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

drop trigger if exists posts_set_updated_at on posts;
create trigger posts_set_updated_at
  before update on posts
  for each row execute function set_updated_at();

-- ── RLS: 공개 읽기는 published 만, 쓰기는 service role 전용 ────────────
-- (service role 키는 RLS 를 우회하므로 별도 쓰기 정책이 필요 없다.
--  anon 키는 클라이언트에 배포하지 않지만, 정책은 방어선으로 둔다.)
alter table posts enable row level security;
alter table attachments enable row level security;

drop policy if exists "public read published posts" on posts;
create policy "public read published posts"
  on posts for select
  using (published);

drop policy if exists "public read attachments of published posts" on attachments;
create policy "public read attachments of published posts"
  on attachments for select
  using (exists (select 1 from posts p where p.id = post_id and p.published));
