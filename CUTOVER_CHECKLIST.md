# 도메인 컷오버 체크리스트 — me.yonsei.ac.kr

구 학과 사이트(지니웍스 CMS)가 쓰던 `me.yonsei.ac.kr` 을 이 사이트가 넘겨받는 날의 절차다.
순서가 곧 내용이다 — 아래 단계는 앞 단계가 끝나야 다음이 성립한다.

---

## 0. 전제 — "DNS 양도" 가 무엇이고 무엇이 아닌가

**레코드 교체 방식이다.** 정보통신처가 `yonsei.ac.kr` 존의 `me` 레코드를 우리 서버로
바꿔 준다. 존 위임(NS)도, 도메인 양도도 아니다 — `.ac.kr` 기관 도메인이라 양도 자체가
불가능하고 네임서버 4대는 계속 학교가 운영한다. **우리는 DNS 레코드를 직접 편집할 수 없고,
레코드 하나를 바꾸려면 매번 요청해야 한다.** 아래 선택들의 이유는 전부 이 제약이다.

### 실측 현황 (2026-09-12)

```
yonsei.ac.kr.          3600  NS     ns / ns2 / ns3 / yumciris .yonsei.ac.kr
yonsei.ac.kr.           900  SOA    ns.yonsei.ac.kr  network.yonsei.ac.kr   ← 요청 보낼 곳
me.yonsei.ac.kr.       3600  CNAME  devcms2.yonsei.ac.kr.    ← 구 지니웍스 CMS
devcms.yonsei.ac.kr.         CNAME  devcms2.yonsei.ac.kr.    ← 같은 서버의 다른 별칭
devcms2.yonsei.ac.kr.        A      165.132.13.47
CAA 레코드 없음 (yonsei.ac.kr · ac.kr 양쪽)   ← Let's Encrypt 발급 차단 요소 없음

aquaelle06.mycafe24.com. 1800  A    172.238.20.160           ← 우리 서버
```

여기서 파생되는 제약 두 가지. 이것만 이해하면 나머지는 기계적이다.

1. **`me` 가 CNAME 이라 같은 이름에 TXT 를 둘 수 없다** (RFC 1034 §3.6.2 — CNAME 이 있는
   이름은 다른 레코드 타입을 가질 수 없다). 그래서 **구글 서치 콘솔 도메인 속성(DNS TXT
   확인)은 불가능하다.** URL 접두어 속성 + HTML 파일 확인으로 간다 —
   `public/google956aa36490a985bf.html` 이 이미 저장소에 있어 컷오버 즉시 통과한다.
   교체 요청에서 **CNAME 이 아니라 A 로 바꿔 달라고 명시**하는 이유도 이것이다. A 는 TXT 와
   공존하므로 나중에 검증 레코드를 얹을 여지가 남는다.

2. **`_acme-challenge` TXT 를 우리가 갱신할 수 없다.** 90일마다 학교에 요청하는 건 현실성이
   없으므로 인증서 **갱신은 HTTP-01** 로 간다. 최초 발급만 무중단으로 처리하는 방법은 2-②.

---

## 1. D-7 ~ D-1 — 사전 준비

### 1-1. 정보통신처에 보낼 요청 (부록 A 에 문안)

| # | 요청 | 시점 | 왜 |
| --- | --- | --- | --- |
| ① | `me.yonsei.ac.kr` **TTL 을 300 으로** | D-1 | 지금 3600. 문제 시 롤백이 1시간이 아니라 5분이 된다 |
| ② | `me.yonsei.ac.kr` **CNAME → A 172.238.20.160** 으로 교체 | D-DAY | 본 전환. **A 로** 달라고 명시(위 0-1) |
| ③ | `_acme-challenge.me.yonsei.ac.kr` **TXT 1회 등록** | D-3 | 무중단 인증서 사전 발급용(2-② 참고). 생략 가능 |
| ④ | `me.yonsei.ac.kr` 관련 **기존 레코드 전부 회신** | D-7 | MX 등이 붙어 있는데 빠뜨리면 메일이 죽는다. SEO 보다 큰 사고 |
| ⑤ | 구 서버(`devcms2`)를 **3개월 더 유지** 요청 | D-7 | 매핑 구멍이 나왔을 때 원본 대조용. `devcms.yonsei.ac.kr` 별칭이 살아 있으면 교수 상세의 '교원정보시스템' 링크도 계속 산다(`src/lib/faculty.ts:150`) |
| ⑥ | 구 사이트 **GSC 속성 소유자 추가** | D-7 | 과거 검색어·색인 데이터 확보. 없어도 치명적이진 않다 |

> ⚠️ ⑤ 는 요청일 뿐 보장이 아니다. 학교가 `me` 테넌트를 정리하는 순간 `devcms` 별칭도
> 함께 죽을 수 있다. 그래서 자산은 이미 R2 로 미러링해 두었다(1-3).

### 1-2. 서버 준비 (레코드가 바뀌기 **전에** 끝나 있어야 한다)

- [ ] nginx `server_name` 에 `me.yonsei.ac.kr` 추가. 인증서 없이 **80 포트만** 응답해도 된다.
      `/.well-known/acme-challenge/` 가 열려 있어야 한다 — 레코드가 바뀌는 순간
      certbot 이 이 경로로 검증한다.
- [ ] 이 vhost 가 없으면 전환 직후 요청이 기본 vhost 로 떨어져 **엉뚱한 페이지가 me 도메인으로
      색인된다.** 전환 전에 `curl -H 'Host: me.yonsei.ac.kr' http://172.238.20.160/ko` 로
      미리 확인한다.
- [ ] `/etc/yonsei_me/env` 에 들어갈 값을 미리 적어 둔다(2-④ 목록).

### 1-3. 구 사이트 자산·링크 잔량 확인

DNS 가 바뀌는 순간 `me.yonsei.ac.kr` 의 이미지·첨부·링크는 전부 우리 404 가 된다.
이미 미러링·재작성을 돌렸더라도 **잔량을 다시 센다**(둘 다 기본이 드라이런, DB 를 쓰지 않는다).

```bash
node scripts/mirror-legacy-assets.mjs     # 남은 me/devcms 자산 URL 집계
node scripts/rewrite-legacy-links.mjs     # 남은 구 사이트 링크 집계
# 0 이 아니면 --apply 로 반영한 뒤 다시 0 을 확인한다
```

### 1-4. 구 URL 리졸버 표본 검증

컷오버 후 구글·백링크가 들고 오는 주소는 전부 `/me/…` 로 들어온다. 리졸버는
`src/lib/legacy-me.ts`(게시물 3,544 · 첨부 2,217 매핑)이고, 지금 도메인에서도 그대로 돈다.

```bash
# 게시판 목록 · 정적 페이지 · 글 상세를 각각 표본으로. 전부 1홉 308 이어야 한다
for u in /me/community/notice.do /me/faculty/professor_list.do /me/graduate/labs.do; do
  curl -sI "https://<현재도메인>$u" | head -2
done
```

- [ ] 308 이고 `Location` 이 실재하는 경로인가 (302·200·404 면 매핑을 고친다)
- [ ] 홉이 하나인가 (308 뒤에 또 308 이 붙으면 크롤 예산을 먹는다)

---

## 2. D-DAY — 전환

**순서를 지킨다.** ①이 끝나야 ②, ②가 끝나야 ③이 의미 있다.

### ① 구 게시판 동기화 루틴 해제 (전환 직전)

컷오버 전까지 학과 담당자는 구 사이트에 글을 올렸고, `board-sync` 가 그것을 매일
우리 DB 로 옮겨 왔다(`tools/automation-phase3.md` 8절). 전환 뒤에는 정본이 우리 CMS 이므로
**반드시 해제한다** — 안 하면 매일 "구 사이트가 응답하지 않는다" 실패 이슈가 쌓인다.

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File tools/automation/register-tasks.ps1 -Unregister -Only board-sync
```

- [ ] 해제 확인. 전환 당일 구 사이트에 올라온 글이 있으면 **손으로** CMS 에 옮긴다.

### ② 인증서 — 두 갈래

**(권장) 무중단: 사전 발급.** 1-1 ③ 을 요청했다면, 레코드를 바꾸기 **전에** DNS-01 으로
인증서를 받아 둘 수 있다. 구 서버가 아직 `me` 를 서빙하는 상태에서도 발급된다.

```bash
certbot certonly --manual --preferred-challenges dns -d me.yonsei.ac.kr
# 출력된 TXT 값을 정보통신처에 전달 → 등록 확인 후 엔터
```
> ⚠️ ACME 주문은 7일 안에 검증돼야 만료된다. 학교 회신이 그 안에 온다는 보장이 없으면
> 아래 (차선)으로 간다. 갱신은 어차피 HTTP-01 이므로 이 TXT 는 한 번 쓰고 버린다.

**(차선) 1~2분 공백: 전환 직후 즉시 발급.** 레코드가 바뀌자마자 실행한다.
Let's Encrypt 는 권위 서버에 직접 질의하므로 **전파를 기다릴 필요가 없다** — TTL 3600 과
무관하게 바로 통과한다.

```bash
certbot --nginx -d me.yonsei.ac.kr    # 레코드 교체 확인 즉시. 미리 명령을 띄워 놓고 대기
```

- [ ] `certbot renew --dry-run` 으로 **갱신 경로(HTTP-01)** 가 도는지 확인. 최초 발급을
      DNS-01 으로 했다면 갱신 설정을 HTTP-01 로 바꿔 둬야 90일 뒤 사고가 안 난다.

### ③ 레코드 교체 확인

```bash
python3 - <<'PY'
import socket
print(socket.gethostbyname_ex("me.yonsei.ac.kr"))   # 172.238.20.160 이어야 한다
PY
curl -sI https://me.yonsei.ac.kr/ko | head -3        # 200, 인증서 오류 없음
```

### ④ 환경변수 + 재배포

`/etc/yonsei_me/env` 를 고치고 **재빌드**한다. `NEXT_PUBLIC_*` 은 빌드 시점에 코드로
구워지고 `generateMetadata` 도 정적 생성 때 평가되므로, **재시작만으로는 반영되지 않는다.**

```bash
NEXT_PUBLIC_SITE_URL=https://me.yonsei.ac.kr        # ← 이 한 줄이 핵심
GOOGLE_SITE_VERIFICATION=<새 속성 토큰>              # 파일 확인으로 통과하면 생략 가능
NAVER_SITE_VERIFICATION=<네이버 토큰>
NEXT_PUBLIC_CF_BEACON_TOKEN=<me.yonsei.ac.kr 로 새로 만든 토큰>
```

```bash
ssh appuser@aquaelle06.mycafe24.com /opt/yonsei_me/bin/deploy.sh
```

`NEXT_PUBLIC_SITE_URL` 하나로 canonical · hreflang · `sitemap.xml` · `robots.txt` · JSON-LD ·
OG 가 **한꺼번에** 새 도메인을 가리킨다(`src/lib/site.ts` 가 단일 출처). 코드 수정은 없다.

> ⚠️ Cloudflare Web Analytics 토큰은 **등록 호스트명 단위**다(`src/app/[locale]/layout.tsx:263`).
> 새 도메인으로 토큰을 다시 만들지 않으면 집계가 0 이 된다.

### ⑤ 구 호스트 301 — 저장소에 아직 없는 유일한 항목

`aquaelle06.mycafe24.com` 과 `yonsei-me.vercel.app` 이 계속 200 을 내면 같은 사이트가
세 도메인으로 색인돼 서로 중복 판정을 받는다. **경로를 유지한 채** 301 한다.

```nginx
server {
    server_name aquaelle06.mycafe24.com;
    return 301 https://me.yonsei.ac.kr$request_uri;
}
```

- [ ] Vercel 프로젝트: `yonsei-me.vercel.app` → `me.yonsei.ac.kr` 리다이렉트 설정
      (또는 프로젝트를 정지). 병행 운영을 끝낼 시점이다.
- [ ] `http://me.yonsei.ac.kr` → `https://` 301 확인.

### ⑥ 전환 검증 (10분)

```bash
curl -sI https://me.yonsei.ac.kr/me/community/notice.do   # 308 → /ko/news/notices, 1홉
curl -s  https://me.yonsei.ac.kr/robots.txt               # Sitemap 줄이 새 도메인
curl -s  https://me.yonsei.ac.kr/sitemap.xml | head -20   # <loc> 이 새 도메인
curl -s  https://me.yonsei.ac.kr/ko | grep -o 'rel="canonical"[^>]*'
curl -sI https://yonsei-me.vercel.app/ko                  # 301 → me.yonsei.ac.kr
curl -s  https://me.yonsei.ac.kr/api/health               # 200
```

- [ ] 관리자 콘솔 로그인(GitHub·카카오) — OAuth 콜백 URL 에 새 도메인이 등록돼 있는가.
      **카카오는 주소 불일치면 코드를 거부한다.** GitHub OAuth App 과 카카오 개발자 콘솔
      양쪽의 redirect URI 를 미리 추가해 둔다.
- [ ] 게시판 첨부 다운로드 1건, 교수 상세 1건, 히어로 이미지 — 깨진 자산이 없는가.

---

## 3. D+0 ~ D+1 — 검색엔진

- [ ] **GSC**: `https://me.yonsei.ac.kr/` **URL 접두어 속성** 추가 → "HTML 파일" 방식 선택.
      토큰이 `public/google956aa36490a985bf.html` 과 같으면 즉시 통과, 다르면 새 파일을
      `public/` 에 **추가로** 커밋한다(기존 파일은 지우지 않는다 — 지우면 구 속성의 소유권이 풀린다).
- [ ] **GSC 주소 변경 도구**: 구 `yonsei-me.vercel.app` 속성 → 새 속성. 2-⑤ 의 301 이
      걸려 있어야 동작한다.
- [ ] **사이트맵 제출**: GSC · 네이버 서치어드바이저 · Bing 에 `https://me.yonsei.ac.kr/sitemap.xml`.
- [ ] **네이버**: `NAVER_SITE_VERIFICATION` 메타로 소유 확인 → robots.txt·사이트맵 제출 →
      "웹페이지 수집" 요청. 네이버엔 주소 변경 도구가 없어 재수집 요청이 유일한 수단이다.
      학과 사이트는 네이버 유입 비중이 크므로 건너뛰지 않는다.
- [ ] **Bing**: GSC 에서 가져오기.
- [ ] **URL 검사 → 색인 요청**을 홈·주요 랜딩 10~20개에만 수동으로(전체는 사이트맵이 한다).

---

## 4. D+1 ~ D+8주 — 모니터링

**정상 경로**: GSC 에서 "리디렉션이 있는 페이지" 가 늘고 "색인 생성됨" 이 구 `.do` URL 에서
새 URL 로 옮겨 간다. 노출·순위는 2~4주 흔들리는 것이 정상이고, 6~8주 넘게 회복되지 않으면
그때 리다이렉트 체인과 canonical 을 의심한다.

- [ ] **주 1회**: nginx access log 에서 `/me/*.do` 중 **404 가 난 경로 상위 목록**을 뽑아
      `src/lib/legacy-me.ts` 의 `STATIC_PAGES` · `BOARD_LISTS` 에 추가한다. 실제 크롤러·백링크가
      들고 있는 구멍만 정확히 메우는 방법이고, 이 시기 SEO 작업 중 효과가 가장 크다.

      ```bash
      awk '$9==404 {print $7}' /var/log/nginx/access.log | grep '^/me' | sort | uniq -c | sort -rn | head -40
      ```
- [ ] **기준선 비교**: 컷오버 전 측정치는 **색인 127 / 미색인 2,520** 이었다. `koOnly` /en
      제외 조치(`src/lib/seo.ts`)의 효과가 여기서 드러난다.
- [ ] UptimeRobot 감시 대상을 새 도메인으로 (`/api/health`, `/api/health/ops`).
- [ ] 학교 본부(`www.yonsei.ac.kr`)·공대 사이트의 학과 링크가 구 `.do` 주소면 갱신 요청.
      308 로 살긴 하지만 홉이 줄고 신호가 깔끔해진다.

---

## 5. 롤백

TTL 을 300 으로 낮춰 두었으므로(1-1 ①) 되돌리는 데 5분이면 된다.

1. 정보통신처에 `me.yonsei.ac.kr` 을 `CNAME devcms2.yonsei.ac.kr` 로 복구 요청.
2. `/etc/yonsei_me/env` 의 `NEXT_PUBLIC_SITE_URL` 을 지우고 재배포
   (기본값이 `https://yonsei-me.vercel.app` 로 돌아간다 — `src/lib/site.ts:8`).
3. `board-sync` 작업 재등록 (2-① 의 역순).

> 검증 파일·메타 태그는 롤백해도 **지우지 않는다.** 지우면 속성 소유권이 풀려 다음 시도 때
> 처음부터 다시 해야 한다.

---

## 6. 하지 말 것

- **구 URL 을 전부 홈으로 301** — 구글이 soft 404 로 처리해 색인을 통째로 버린다. 지금 리졸버는
  매핑 실패 시 제 게시판 목록으로 내리고, 정말 없으면 404/410 을 낸다. 이 설계를 바꾸지 않는다.
- **전환 직후 robots.txt 전체 차단** — 테스트한다고 막았다가 잊는 사고가 가장 흔하다.
- **컷오버와 동시에 URL 구조를 또 변경** — 한 번에 하나만.
- **사이트맵에 리다이렉트 URL 싣기** — 지금 코드는 이미 제외하고 있다(`src/app/sitemap.xml/route.ts`).
- **검증 파일·TXT·메타 태그 삭제** — 구글은 주기적으로 재확인한다.

---

## 부록 A. 정보통신처 요청 문안

> 기계공학부 홈페이지 개편에 따라 `me.yonsei.ac.kr` 이 가리키는 서버를 교체하고자 합니다.
>
> **1. (D-1) TTL 조정**
> `me.yonsei.ac.kr` 의 TTL 을 3600 → **300** 으로 낮춰 주십시오. 전환 중 문제 발생 시
> 신속히 원복하기 위함이며, 전환 안정화 후 원래 값으로 되돌려도 무방합니다.
>
> **2. (D-DAY) 레코드 교체**
> ```
> 현재:  me.yonsei.ac.kr.  CNAME  devcms2.yonsei.ac.kr.
> 변경:  me.yonsei.ac.kr.  A      172.238.20.160
> ```
> CNAME 이 아니라 **A 레코드**로 부탁드립니다. 검색엔진 소유확인용 TXT 레코드를 같은
> 이름에 추가해야 하는데, CNAME 은 다른 레코드 타입과 공존할 수 없기 때문입니다.
>
> **3. (선택, D-3) SSL 인증서 사전 발급용 TXT 1회 등록**
> ```
> _acme-challenge.me.yonsei.ac.kr.  TXT  "<별도 전달하는 값>"
> ```
> 전환 순간의 HTTPS 접속 단절을 없애기 위한 것으로, 발급 후 삭제하셔도 됩니다.
> 이후 갱신은 웹서버 방식(HTTP-01)으로 처리하므로 추가 요청은 없습니다.
>
> **4. 회신 요청**
> `me.yonsei.ac.kr` 및 그 하위에 현재 설정된 레코드 전체(A/AAAA/MX/TXT/CNAME)를 알려
> 주십시오. 메일 등 웹 외의 용도가 걸려 있는지 확인이 필요합니다.
>
> **5. 협조 요청**
> 기존 서버(`devcms2.yonsei.ac.kr`)를 전환 후 **3개월간 유지**해 주시면 감사하겠습니다.
> 이전 데이터 대조와 교원정보시스템 연동 링크에 사용됩니다.

연락처는 존 SOA 에 `network@yonsei.ac.kr` 로 등록돼 있다.

## 부록 B. DNS 조회 (이 환경엔 dig 가 없다)

```bash
python3 - <<'PY'
import socket
print(socket.gethostbyname_ex("me.yonsei.ac.kr"))
PY
```

레코드 타입별 조회가 필요하면 `nslookup -type=NS me.yonsei.ac.kr 8.8.8.8` 또는
`dig` 가 있는 환경에서 확인한다.
