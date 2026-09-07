# tools/

사이트 빌드·배포와 무관한 **개발 보조 자료** 모음입니다. `scripts/`의 데이터 변환
스크립트들이 입력으로 사용하거나, 로컬 디버깅 재현에만 쓰입니다.

- `automation-plan.md` — 크롤 파이프라인 전수 인벤토리와 자동화 단계별 계획
  (무엇을 자동화하고 무엇은 일부러 하지 않는지). 운영 자동화 작업의 출발점
- `automation-spec.md` — 위 계획의 백로그 항목별 구현 설계(파일·CLI·종료 코드·검증 절차).
  Worker 브리프의 원본. 구현 코드는 `automation/` 아래에 모임
- `automation-phase3.md` — 반자동·수동 반영 3건(카탈로그·마일리지·입학 캘린더)을 완전 자동화하는
  계획. 병목 3개와 단계 P3-0~P3-6, 첫 단계는 세션 수명 실험
- `automation/` — 운영 자동화 코드(의존성 0, Node 24). `issue.mjs`(이슈 생성·중복 방지),
  `remind.mjs`+`reminders/`(정기 리마인더), `admission-watch.mjs`(입학처 변경 감지),
  `update-semester.mjs`(학기 갱신 오케스트레이터 — 쿠키 한 번이면 체커·마일리지 전 단계).
  `board-sync.mjs`(**컷오버 전 한시** — 구 게시판의 새 글만 매일 Supabase 로, P3-7),
  `register-tasks.ps1`(작업 스케줄러 등록 — `-Only <이름조각>` 으로 한 작업만).
  `.state/` 는 실행 상태·백테스트 덤프(미추적). 워크플로는 `.github/workflows/`

- `checker/` — 졸업요건 체커의 과목 카탈로그 파이프라인 (학기별 수강편람 크롤 →
  학정번호 키 통합 → `public/data/course-catalog.json`). 갱신 절차와 함정 모음은
  `checker/README.md`. 크롤 원본(`checker/data/raw/`)은 git 미추적, 통합 이력
  정본(`checker/data/catalog-history.json`)과 리포트만 추적
- `course-list.csv` — (구) 25-2 수강편람 PDF 기반 전체 개설과목 CSV. `checker/`
  파이프라인으로 대체되어 `scripts/parse-catalog.mjs`와 함께 은퇴 예정 — 새로 쓰지 말 것
- `import-raw/` — 기존 학부 홈페이지에서 스크랩한 원본 HTML (`scripts/extract_import.py`
  등 파이썬 파서의 입력, 변환 결과는 `content/`로 들어감)
- `mileage/` — 마일리지 전략 플래너의 데이터 파이프라인 (크롤 JSON → 이력 SQLite →
  예측 번들 `public/data/mileage-*.json`). 학기마다 한 번 돌리는 갱신 절차와 함정 모음은
  `mileage/README.md`. 이력 DB는 gzip본(`mileage/data/*.db.gz`)만 git에 포함하고, 실행 시
  자동 해제되는 `.db`는 무시함
- `traineddata/` — tesseract 한국어/영어 학습데이터. 졸업요건 체커의 OCR을 Node에서
  로컬 재현할 때만 필요 (브라우저는 CDN에서 받음). git에는 포함하지 않음
