import type { Metadata } from 'next';
import Image from 'next/image';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { StaffTable } from '@/components/StaffTable';
import { getStaffRuntime } from '@/lib/content-runtime';
import { cn } from '@/lib/utils';
import { SectionTabPage, sectionTabMetadata } from '../../_shared/section-tabs';

// 콘텐츠 소스 전환(Stage A): 행정직원이 데이터 레이어를 읽는다 — ISR 안전망
export const revalidate = 300;

export async function generateMetadata({
  params,
}: {
  params: { locale: string };
}): Promise<Metadata> {
  return sectionTabMetadata(params.locale, 'bk21', 'organization');
}

/** 블록 제목 — .prose-content h2 와 같은 크기·여백. 서체는 탭 제목(TabPageShell)과 같은
 *  Paperlogy(--font-subhead)로 통일한다(사용자 지시 — 본문 sans 와 섞이면 위계가 흐려진다). */
const H2 = 'max-w-3xl text-3xl font-bold leading-tight tracking-tight text-content sm:text-4xl';
const H2_STYLE = { fontFamily: 'var(--font-subhead), var(--font-sans), sans-serif' } as const;

/** 조직도 원본 픽셀 — next/image 에 그대로 넘겨 자리를 미리 잡는다(CLS 0) */
const CHART = { src: '/img/pages/bk21-organization.jpg', width: 1280, height: 720 };

/**
 * BK21 FOUR › 교육연구단 현황 — 조직도 + 행정직원.
 * 조직도는 이미지 한 장으로 둔다(사용자 결정). 사진 속 글자의 대체 텍스트는 alt 한 문장뿐이다 —
 * 이미지 아래에 같은 구조를 목록으로 다시 적었던 것은 사용자 지시로 뺐다.
 */
export default async function Bk21OrganizationPage({ params }: { params: { locale: string } }) {
  setRequestLocale(params.locale);
  const t = await getTranslations({ locale: params.locale, namespace: 'bk21' });
  const staff = await getStaffRuntime();
  // 행정직원은 학부 전체 교직원 명단(content/staff.json)에서 BK21 소속만 걸러 쓴다 —
  // 같은 사람을 두 파일에 적으면 연락처가 갈린다(교직원 탭과 한 원본).
  const bk21Staff = staff.filter((s) => s.role.ko.includes('BK21'));

  return (
    <SectionTabPage locale={params.locale} section="bk21" tab="organization">
      <h2 className={cn(H2, 'mt-0')} style={H2_STYLE}>
        {t('organization.chart')}
      </h2>
      <figure className="mt-8">
        <Image
          src={CHART.src}
          alt={t('organization.chartAlt')}
          width={CHART.width}
          height={CHART.height}
          sizes="(max-width: 1024px) 100vw, 960px"
          className="h-auto w-full border border-surface-border"
        />
      </figure>

      <h2 className={cn(H2, 'mt-16')} style={H2_STYLE}>
        {t('organization.staff')}
      </h2>
      <div className="mt-8">
        <StaffTable staff={bk21Staff} locale={params.locale} />
      </div>
    </SectionTabPage>
  );
}
