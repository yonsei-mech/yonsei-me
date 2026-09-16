import Image from 'next/image';
import { Container, NARROW_MAX_W } from '@/components/Container';

/**
 * 동문 인터뷰 목록 상단의 커버 밴드 — 남색 바 바로 아래, 풀블리드 사진 위에
 * 남색 그라데이션 마스크를 덮고 글을 아래 정렬로 얹는다.
 *
 * 이 페이지의 h1 은 여기 있다(히어로 제목은 섹션명 '동문'이라 p 로 낮춰 둔다) —
 * 한 문서에 큰 제목이 둘이면 구글이 검색결과 제목을 임의로 골라 쓴다.
 *
 * 수치는 디자인 확정본(design-src/Main.src.html · Mobile.src.html) 그대로다:
 * 높이 640/560, 킥커 12/11px tracking .22em, 제목 52/32px(Paperlogy 600),
 * 주제문 17/14.5px, 밑줄 48×2 / 36×2.
 */
export function InterviewCover({
  kicker,
  title,
  lead,
}: {
  kicker: string;
  title: string;
  /** 주제문 — 줄바꿈(\n)은 <br> 로 그린다 */
  lead: string;
}) {
  const lines = lead.split('\n');

  return (
    <section className="relative h-[560px] overflow-hidden bg-[#00285E] text-white md:h-[640px]">
      {/* 커버 사진 — LCP 후보라 priority. 초점은 PC/모바일이 다르다(인물 배치) */}
      <Image
        src="/img/alumni/cover.jpg"
        alt=""
        fill
        priority
        sizes="100vw"
        className="object-cover object-[62%_40%] md:object-[center_34%]"
      />
      {/* 남색 마스크 — 아래로 갈수록 짙어져 글이 사진 위에서도 AA 대비를 갖는다.
          모바일은 글 상자가 더 높이 올라와 중간 정지점을 조금 더 짙게 둔다. */}
      <div
        aria-hidden="true"
        className="absolute inset-0 md:hidden"
        style={{
          backgroundImage:
            'linear-gradient(to top, #00285E 0%, rgba(0,40,94,0.92) 40%, rgba(0,40,94,0.55) 68%, rgba(0,40,94,0.1) 100%)',
        }}
      />
      <div
        aria-hidden="true"
        className="absolute inset-0 hidden md:block"
        style={{
          backgroundImage:
            'linear-gradient(to top, #00285E 0%, rgba(0,40,94,0.9) 32%, rgba(0,40,94,0.52) 62%, rgba(0,40,94,0.1) 100%)',
        }}
      />

      <Container className={`relative flex h-full flex-col items-start justify-end pb-10 md:pb-[84px] ${NARROW_MAX_W}`}>
        <p className="m-0 mb-4 flex items-center gap-2 text-[11px] font-bold tracking-[0.22em] text-white/85 md:mb-[26px] md:gap-2.5 md:text-[12px]">
          <span aria-hidden="true" className="block h-px w-6 bg-white/50 md:w-8" />
          {kicker}
        </p>
        <h1
          style={{ fontFamily: 'var(--font-subhead), var(--font-sans), sans-serif' }}
          className="m-0 text-[32px] font-semibold leading-[1.2] tracking-[-0.02em] text-white md:max-w-[760px] md:text-[52px]"
        >
          {title}
        </h1>
        <p className="mt-[18px] text-[14.5px] leading-[1.8] text-white/[0.86] md:mt-8 md:text-[17px] md:leading-[1.9]">
          {lines.map((line, i) => (
            <span key={i}>
              {i > 0 && <br />}
              {line}
            </span>
          ))}
        </p>
        <span aria-hidden="true" className="mt-6 block h-[2px] w-9 bg-white/55 md:mt-[38px] md:w-12" />
      </Container>
    </section>
  );
}
