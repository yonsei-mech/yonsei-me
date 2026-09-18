/**
 * 학위논문심사 문의처 — 교직원 데이터(staff.json / content_files)의 **대학원 담당** 항목.
 *
 * 화면 B(본인 확인·안내, /graduate/thesis/submit)의 문의 줄과 학생에게 가는 메일 3종
 * (접수 확인·게시 안내·반려 안내)의 문의처가 이 한 곳에서 나온다 — 담당자가 바뀌면
 * CMS 의 교직원 편집만으로 두 곳이 함께 바뀐다. 담당자 이름은 싣지 않는다.
 *
 * 서버 전용(content-runtime·next-intl/server). 클라이언트는 결과 값만 props 로 받는다.
 */
import { getTranslations } from 'next-intl/server';
import { pick } from '@/lib/content';
import { getStaffRuntime } from '@/lib/content-runtime';
import type { Locale } from '@/i18n/routing';

export interface ThesisContact {
  /** '대학원 행정실' — thesisSubmit.guide.contactOffice */
  office: string;
  location: string;
  phone: string;
  email: string;
}

/** 대학원 담당 교직원 연락처. 교직원 데이터에 항목이 없으면 null(문의 줄을 숨긴다) */
export async function thesisContact(locale: Locale = 'ko'): Promise<ThesisContact | null> {
  const [t, staff] = await Promise.all([
    getTranslations({ locale, namespace: 'thesisSubmit' }),
    getStaffRuntime(),
  ]);
  const office = staff.find((s) => s.role?.ko === '대학원');
  return office
    ? {
        office: t('guide.contactOffice'),
        location: pick(office.location, locale),
        phone: office.phone,
        email: office.email,
      }
    : null;
}
