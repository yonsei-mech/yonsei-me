// '자세히' 전용 편집기(리소스별 미러 편집기)가 공유하는 props 계약.
//
// CollectionEditor 는 resource.detailView 값에 따라 RecordForm 대신 이 계약을 만족하는
// 편집기를 끼운다. props 는 RecordForm 과 **같은 모양**이라, 편집기를 갈아 끼워도
// 상위(저장·업로드·요약 로딩·변경 트레이)는 손대지 않는다.
//
// ⚠️ 저장 규칙은 여기서 정하지 않는다 — 편집기는 폼 값을 모아 onSubmit 으로 올리기만
// 하고, 도메인 레코드 직렬화는 resources.ts 의 fromForm 한 곳이 책임진다.

import type { FieldDef, FormRecord } from '@/lib/admin/resources';
import type { UploadProgressHandler } from '@/lib/admin/storage';
import type { LinkedSummaryField } from './RecordForm';

export interface DetailEditorProps {
  /** 리소스 필드 정의 — 편집기는 이 중 자기가 그리는 값만 골라 쓴다 */
  fields: FieldDef[];
  /** 편집 시작 값 (목록의 대기 편집이 얹힌 상태) */
  initial: FormRecord;
  /** 수정(true) / 신규 등록(false) */
  isEdit: boolean;
  busy: boolean;
  onSubmit: (form: FormRecord) => void;
  onCancel: () => void;
  /** 공유 요약 파일 속 이 항목의 레코드 (AI 연구요약) */
  linkedSummary?: LinkedSummaryField | null;
  /** 첫 편집 시 상위에 알린다(이탈 경고·트레이 표시용) */
  onDirty?: () => void;
  /** 이미지 업로드 — 저장할 공개 URL 을 돌려준다 (RecordForm 과 같은 통로) */
  onUploadImage?: (file: File, opts?: { maxDim?: number; folder?: string }) => Promise<string>;
  /** 영상 등 대용량 파일 통로 — 진행률·취소를 지원하고 이미지 압축을 거치지 않는다.
   *  (onUploadImage 는 압축기를 통과시키고 진행률·취소가 없어 수십 MB 파일에 부적합) */
  onUploadFile?: (
    file: File,
    opts: { folder: string; onProgress?: UploadProgressHandler; signal?: AbortSignal },
  ) => Promise<string>;
}
