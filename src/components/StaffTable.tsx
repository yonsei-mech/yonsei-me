import { getTranslations } from 'next-intl/server';
import { pick } from '@/lib/content';
import type { StaffMember } from '@/lib/content';
import type { Locale } from '@/i18n/routing';

/**
 * 행정 교직원 표 — 학부 소개 > 교직원 탭과 BK21 FOUR > 교육연구단 현황이 함께 쓴다.
 *
 * 두 화면이 같은 표여야 해서 마크업을 여기 한 벌만 둔다(BK21 탭은 같은 content/staff.json
 * 에서 BK21 소속 행만 걸러 넘긴다 — 데이터가 둘로 갈리지 않게).
 * 에디토리얼 표 문법(prose-content table 과 동일): 네이비 상단 룰 + 헤어라인,
 * 배경 없는 작은 헤더, 넉넉한 행(py-5), 첫 컬럼(구분) 볼드 행 라벨.
 *
 * 헤더 라벨은 `about.staffTable.*` 하나를 계속 쓴다 — 표가 같으니 문구도 같아야 한다.
 */
export async function StaffTable({
  staff,
  locale,
}: {
  staff: StaffMember[];
  locale: string;
}) {
  const t = await getTranslations({ locale, namespace: 'about' });

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[560px] text-left text-[15px]">
        <thead className="border-b border-t-2 border-surface-border border-t-yonsei-navy">
          <tr>
            {(['role', 'name', 'phone', 'location', 'email'] as const).map((col) => (
              <th key={col} scope="col" className="whitespace-nowrap px-3 py-3.5 text-left text-xs font-bold text-content-faint">
                {t(`staffTable.${col}`)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {staff.map((s) => (
            <tr key={s.email} className="border-b border-surface-border">
              <td className="whitespace-nowrap px-3 py-5 font-semibold text-content">{pick(s.role, locale as Locale)}</td>
              <td className="whitespace-nowrap px-3 py-5 font-medium text-content">{pick(s.name, locale as Locale)}</td>
              <td className="whitespace-nowrap px-3 py-5 tabular-nums text-content-soft">{s.phone}</td>
              <td className="whitespace-nowrap px-3 py-5 text-content-soft">{pick(s.location, locale as Locale)}</td>
              <td className="px-3 py-5">
                <a href={`mailto:${s.email}`} className="font-medium text-yonsei-blue underline-offset-2 hover:underline">
                  {s.email}
                </a>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
