'use client';

// PostBodyEditor — 게시판 본문 에디터 v2 (구명 BoardEditor 에서 개명: 목록 화면
// admin/BoardEditor.tsx 와 이름이 충돌했다) (Tiptap v3 + Tiptap UI Components).
//
// 목적: 구형 학과 CMS(Froala 2.5.0, devcms2 실측 2026-08-18)의 툴바를 순서·형식까지
// 재현하고, 껍데기만 UI Components 스톡 룩으로 — "구형 서식 + 신형 UX"(사용자 지정).
// 구형에 없던 컨트롤(형식·줄간격·인용·첨자·찾기)은 사용자 지시로 툴바에서 뺐다
// (확장은 유지 — 기존 게시물의 해당 서식이 편집 중 증발하면 안 된다).
//
// 툴바(실측 그대로):
//   인쇄 | B I U S | 글꼴(A▾) 크기(Tt▾) ‖ 색(물방울: 글자/배경 두 탭, 27색+해제) ‖
//   링크 이미지 비디오 표 ‖ 정렬▾ OL UL 내어 들여 구분선 ‖
//   실행취소 다시실행 서식지우기 전체선택 코드뷰(</>)
//
// 문서 스키마·저장 계약은 RichTextEditor(구판)와 동일 — rte-schema 확장을 그대로
// 쓰므로 저장 HTML 형식이 변하지 않고, PostForm 프롭 그대로 스왑된다.
// 내용 영역 타이포는 prose-content(사이트 본문과 동일) — 진짜 WYSIWYG.
// 폭까지 진짜다: 편집 영역을 PostCanvas 로 감싸 게시물 설계 폭(1022px)으로 레이아웃하고,
// 폼이 그보다 좁으면 zoom 으로 통째로 줄인다 — 글자 크기는 실치수가 아니지만(사용자 승인)
// 줄바꿈이 공개 화면과 한 글자도 어긋나지 않는다.
// 표 보조 바·이미지 보조 바는 2026-08 시안(1a/1d)으로 다시 그렸다 — 툴바와 같은 면에
// 붙는 인라인 바 + 아이콘·라벨 버튼, 색/테두리/여백은 "표 스타일" 팝오버 한 곳.
// 명령 자체는 구판 그대로다(새로 만든 에디터 명령 없음).
// 새 표의 초기 디자인은 구형 기본(1px 연회색 격자·좁은 여백).

import { useCallback, useEffect, useRef, useState } from 'react';
import { EditorContent, EditorContext, useEditor, type Editor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Highlight from '@tiptap/extension-highlight';
import Subscript from '@tiptap/extension-subscript';
import Superscript from '@tiptap/extension-superscript';
import TextAlign from '@tiptap/extension-text-align';
import { TextStyle, Color, FontFamily, FontSize, LineHeight } from '@tiptap/extension-text-style';
import Youtube from '@tiptap/extension-youtube';
import { CharacterCount, Placeholder } from '@tiptap/extensions';

import { PostCanvas } from '../PostCanvas';
import { RteRowResize } from '@/lib/admin/rte-row-resize';
import {
  IMAGE_CAPTION_MAX,
  RteImage,
  RteParagraphRole,
  RteStyleCarry,
  RteTable,
  RteTableCell,
  RteTableHeader,
  RteTableRow,
  RteTableView,
  TABLE_BORDER_COLORS,
  type ParagraphRole,
  type TableBorder,
  type TableBorderColor,
  type TableCellpad,
} from '@/lib/admin/rte-schema';
import { cn } from '@/lib/utils';

// ── UI Components (스톡 룩) ──
import { Button } from '@/components/tiptap-ui-primitive/button';
import { Spacer } from '@/components/tiptap-ui-primitive/spacer';
import {
  Toolbar,
  ToolbarGroup,
  ToolbarSeparator,
} from '@/components/tiptap-ui-primitive/toolbar';
import {
  Popover,
  PopoverTrigger,
  PopoverContent,
} from '@/components/tiptap-ui-primitive/popover';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
} from '@/components/tiptap-ui-primitive/dropdown-menu';
import { Input } from '@/components/tiptap-ui-primitive/input';
import { MarkButton } from '@/components/tiptap-ui/mark-button';
import { ListButton } from '@/components/tiptap-ui/list-button';
import { UndoRedoButton } from '@/components/tiptap-ui/undo-redo-button';

// ── 아이콘 ──
import { ChevronDownIcon } from '@/components/tiptap-icons/chevron-down-icon';
import { AlignLeftIcon } from '@/components/tiptap-icons/align-left-icon';
import { AlignCenterIcon } from '@/components/tiptap-icons/align-center-icon';
import { AlignRightIcon } from '@/components/tiptap-icons/align-right-icon';
import { AlignJustifyIcon } from '@/components/tiptap-icons/align-justify-icon';
import { ImagePlusIcon } from '@/components/tiptap-icons/image-plus-icon';
import { LinkIcon } from '@/components/tiptap-icons/link-icon';
import { ExternalLinkIcon } from '@/components/tiptap-icons/external-link-icon';

// ── 스타일 — UI Components 토큰·키프레임. 에디터 컴포넌트에서만 임포트해
//    관리자 번들에 격리한다(공개 사이트 CSS 무오염). 본문 노드 스타일은
//    prose-content(globals.css)가 담당하므로 노드 scss 는 가져오지 않는다. ──
import '@/styles/_variables.scss';
import '@/styles/_keyframe-animations.scss';

import {
  AlignIcon,
  BORDER_COLOR_SWATCHES,
  BORDER_WIDTH_TILE_LABELS,
  BORDER_WIDTHS,
  CalloutIcon,
  CELL_BGS,
  CELLPAD_OPTIONS,
  CodeViewIcon,
  COLORS_STEP,
  CTX_CAPTION,
  CtxBtn,
  CtxDivider,
  DropletIcon,
  EraserIcon,
  FONT_FAMILIES,
  FONT_SIZES,
  FROALA_COLORS,
  GRID_COLS,
  GRID_ROWS,
  ImageWidthFullIcon,
  ImageWidthHalfIcon,
  IndentIcon,
  INTERVIEW_TEMPLATE,
  InterviewTemplateIcon,
  PANEL_BTN,
  PANEL_INPUT,
  PrinterIcon,
  QuoteIcon,
  REQUIREMENTS_CALLOUT,
  SelectAllIcon,
  TableColAddIcon,
  TableColDeleteIcon,
  TableDeleteIcon,
  TableHeaderRowIcon,
  TableIcon,
  TableMergeIcon,
  TableRowAddIcon,
  TableRowDeleteIcon,
  TableSplitIcon,
  TableStyleIcon,
  YoutubeIcon,
  borderWidthPreviewStyle,
  cleanPastedHtml,
  normalizeUrl,
  runOnSelection,
  type SelectOption,
} from './lib';

interface Props {
  /** HTML 문자열 (빈 문서는 '') */
  value: string;
  onChange: (html: string) => void;
  /** 파일 → 업로드 후 공개 URL. 없으면 이미지 기능 비활성 */
  onUploadImage?: (file: File) => Promise<string>;
  /** 에디터 인스턴스 노출 — 부모(이미지 풀 '본문 삽입' 등)가 명령을 내릴 때 사용 */
  onEditorReady?: (editor: Editor) => void;
  /** 원문 모드 — 글 단위 설정(양쪽 언어 공통). 켜져 있으면 코드뷰로 열린다 */
  bodyRaw?: boolean;
  /** 원문 모드 토글 — 없으면 체크박스를 그리지 않는다 */
  onBodyRawChange?: (value: boolean) => void;
  placeholder?: string;
  ariaLabel?: string;
  /**
   * 화면별 도구 묶음.
   *  · 'interview'(동문 소식) — 인용·Q·A·인터뷰 틀 버튼이 툴바에 더 붙고, 편집
   *    영역이 상세 페이지와 같은 .prose-interview 외형을 입는다.
   *  · 'requirements'(대학원 졸업요건 STEP 본문) — [유의사항] 버튼 하나가 더 붙고,
   *    편집 영역이 사이트와 같은 .step-prose 외형을 입어 인용구가 파란 줄 콜아웃으로
   *    보인다.
   * 지정하지 않은 게시판의 툴바·외형은 한 글자도 바뀌지 않는다 — 인터뷰 서식(굵은
   * 남색 인용, Q/A 마커)이나 콜아웃이 일반 공지에 새어 들어가면 안 되기 때문이다.
   * ⚠️ 편집 영역 클래스는 에디터 생성 시점에 정해진다(editorProps) — 마운트 뒤
   * preset 을 바꿔도 반영되지 않는다. 게시판 전환은 폼 재마운트가 전제다.
   */
  preset?: 'interview' | 'requirements';
}

/** 코드뷰 표시용 얕은 정형화 — 블록 경계에 줄바꿈만 넣는다(구형 CodeMirror 대응) */
function prettyHtml(html: string): string {
  return html
    .replace(/></g, '>\n<')
    .replace(/\n(<\/(?:td|th|li|p|h[1-5])>)/g, '$1');
}

export function PostBodyEditor({
  value,
  onChange,
  onUploadImage,
  onEditorReady,
  bodyRaw = false,
  onBodyRawChange,
  placeholder,
  ariaLabel,
  preset,
}: Props) {
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [uploadingCount, setUploadingCount] = useState(0);
  const altRef = useRef<HTMLInputElement | null>(null);
  const captionRef = useRef<HTMLInputElement | null>(null);
  const editorRef = useRef<Editor | null>(null);
  // 코드뷰 — 켜면 본문 대신 HTML 소스를 편집한다(구형 html 버튼 파리티).
  // 원문 모드로 저장된 글은 코드뷰로 열린다 — WYSIWYG 로 들어가는 순간 Tiptap 이
  // 지원하지 않는 마크업을 정규화해 디자인이 깎이기 때문이다.
  const [codeView, setCodeView] = useState(bodyRaw);
  // 원문 모드로 시작할 때는 value 를 **손대지 않고** 그대로 싣는다(정형화조차 하지 않는다 —
  // 바이트가 곧 디자인인 원문이라 <pre> 등에서 줄바꿈 추가가 의미를 바꿀 수 있다).
  const [codeHtml, setCodeHtml] = useState(() => (bodyRaw ? value : ''));

  /** 파일들을 업로드해 본문에 삽입 — 툴바·드롭·붙여넣기 공용 */
  const uploadAndInsert = useCallback(
    async (files: File[], pos?: number) => {
      const ed = editorRef.current;
      if (!ed || !onUploadImage) return;
      const images = files.filter((f) => f.type.startsWith('image/'));
      if (images.length === 0) return;
      setUploadingCount((n) => n + images.length);
      for (const file of images) {
        try {
          // eslint-disable-next-line no-await-in-loop -- 순차 업로드(진행 표시 단순화)
          const url = await onUploadImage(file);
          const chain = ed.chain().focus();
          if (typeof pos === 'number') chain.insertContentAt(pos, { type: 'image', attrs: { src: url } }).run();
          else chain.setImage({ src: url }).run();
        } catch (err) {
          window.alert(err instanceof Error ? err.message : '이미지 업로드에 실패했습니다.');
        } finally {
          setUploadingCount((n) => n - 1);
        }
      }
    },
    [onUploadImage],
  );

  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      // heading·blockquote 등은 툴바에서 뺐지만 스키마에는 남긴다 —
      // 기존 게시물의 해당 서식이 재편집 때 증발하면 안 된다.
      StarterKit.configure({
        heading: { levels: [2, 3, 4] },
        link: { openOnClick: false },
      }),
      TextStyle,
      Color,
      FontFamily,
      FontSize,
      LineHeight,
      Highlight.configure({ multicolor: true }),
      Superscript,
      Subscript,
      TextAlign.configure({ types: ['heading', 'paragraph'] }),
      RteImage,
      RteTable.configure({ resizable: true, cellMinWidth: 48, View: RteTableView }),
      RteTableRow,
      RteTableHeader,
      RteTableCell,
      RteRowResize,
      // 코드뷰로 붙여넣은 구형 디자인 공지의 style 을 WYSIWYG 복귀 때 살려 둔다
      // (값 검사는 저장 경로의 정화가 한다 — rte-schema 주석 참조)
      RteStyleCarry,
      // Q&A 문단 속성(p[data-role]) — preset 과 무관하게 항상 싣는다.
      // 툴바 버튼만 인터뷰 preset 에 가두고 스키마는 열어 둬야, 인터뷰 글을 다른
      // 게시판으로 옮기거나 preset 없이 다시 열어도 Q/A 라벨이 증발하지 않는다.
      RteParagraphRole,
      Youtube.configure({ nocookie: true, width: 640, height: 360 }),
      Placeholder.configure({ placeholder: placeholder ?? '' }),
      CharacterCount,
    ],
    content: value || '',
    editorProps: {
      attributes: {
        // preset 은 공개 화면 래퍼와 같은 클래스를 편집 영역에도 입힌다 — 인용·Q&A·
        // 콜아웃 외형이 편집 중에도 공개 화면과 같아야 "보이는 그대로 고친다"가 된다.
        class: cn(
          'prose-content prose-wide rte-area',
          preset === 'interview' && 'prose-interview',
          preset === 'requirements' && 'step-prose',
        ),
        ...(ariaLabel ? { 'aria-label': ariaLabel } : {}),
      },
      transformPastedHTML: cleanPastedHtml,
      handleDrop: (view, event, _slice, moved) => {
        if (moved || !event.dataTransfer?.files?.length) return false;
        const files = Array.from(event.dataTransfer.files);
        if (!files.some((f) => f.type.startsWith('image/'))) return false;
        event.preventDefault();
        const coords = view.posAtCoords({ left: event.clientX, top: event.clientY });
        void uploadAndInsert(files, coords?.pos);
        return true;
      },
      handlePaste: (_view, event) => {
        const files = Array.from(event.clipboardData?.files ?? []);
        if (!files.some((f) => f.type.startsWith('image/'))) return false;
        event.preventDefault();
        void uploadAndInsert(files);
        return true;
      },
    },
    onUpdate: ({ editor: ed }) => {
      onChange(ed.isEmpty ? '' : ed.getHTML());
    },
  });

  useEffect(() => {
    editorRef.current = editor;
    if (editor) onEditorReady?.(editor);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor]);

  // 외부 value 변경(편집 대상 전환 등) → 에디터 내용 동기화.
  // 코드뷰 중에는 건드리지 않는다 — textarea 가 원본이다.
  useEffect(() => {
    if (!editor || codeView) return;
    const current = editor.isEmpty ? '' : editor.getHTML();
    if (value !== current) {
      editor.commands.setContent(value || '', { emitUpdate: false });
    }
  }, [editor, value, codeView]);

  // 커스텀 드롭다운의 현재값 표시용 — 트랜잭션마다 리렌더
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!editor) return;
    const rerender = () => setTick((t) => t + 1);
    editor.on('transaction', rerender);
    return () => {
      editor.off('transaction', rerender);
    };
  }, [editor]);

  /** 코드뷰 토글 — 나올 때 textarea 내용을 문서로 반영한다(구형과 동일한 왕복) */
  const toggleCodeView = useCallback(() => {
    if (!editor) return;
    if (!codeView) {
      setCodeHtml(prettyHtml(editor.isEmpty ? '' : editor.getHTML()));
      setCodeView(true);
      return;
    }
    // 원문 모드에서 WYSIWYG 로 돌아가면 Tiptap 스키마가 원문을 정규화한다 — 되돌릴 수
    // 없는 손실이라 반드시 한 번 묻는다(수락하면 예전과 같은 왕복).
    if (
      bodyRaw &&
      !window.confirm(
        'WYSIWYG 로 전환하면 에디터가 지원하지 않는 마크업이 정규화되어 디자인이 소실될 수 있습니다.\n계속할까요?',
      )
    ) {
      return;
    }
    editor.commands.setContent(codeHtml, { emitUpdate: true });
    setCodeView(false);
  }, [editor, codeView, codeHtml, bodyRaw]);

  /** 인쇄 — 본문만 담은 숨은 iframe 에 사이트 스타일을 실어 인쇄한다(구형 print 파리티) */
  const printContent = useCallback(() => {
    if (!editor) return;
    const html = codeView ? codeHtml : editor.getHTML();
    const frame = document.createElement('iframe');
    frame.setAttribute('aria-hidden', 'true');
    frame.style.position = 'fixed';
    frame.style.right = '100%';
    frame.style.bottom = '100%';
    document.body.appendChild(frame);
    const doc = frame.contentDocument;
    if (!doc) return;
    const styles = [...document.querySelectorAll('link[rel="stylesheet"], style')]
      .map((n) => n.outerHTML)
      .join('');
    doc.open();
    doc.write(
      `<!doctype html><html><head><meta charset="utf-8">${styles}</head>` +
        `<body><div class="prose-content prose-wide" style="padding:24px">${html}</div></body></html>`,
    );
    doc.close();
    // 스타일 적용 여유를 준 뒤 인쇄 — 끝나면 프레임 제거
    window.setTimeout(() => {
      frame.contentWindow?.focus();
      frame.contentWindow?.print();
      window.setTimeout(() => frame.remove(), 1000);
    }, 150);
  }, [editor, codeView, codeHtml]);

  if (!editor) {
    return (
      <div className="min-h-[380px] border border-surface-border bg-surface p-4 text-sm text-content-faint">
        에디터 불러오는 중…
      </div>
    );
  }

  const inTable = !codeView && editor.isActive('table');
  const onImage = !codeView && editor.isActive('image');
  const tableAttrs = inTable ? editor.getAttributes('table') : {};
  const imageAttrs = onImage ? editor.getAttributes('image') : {};
  const charCount = editor.storage.characterCount.characters();
  const wordCount = editor.storage.characterCount.words();

  /** 대체텍스트·캡션을 한 트랜잭션으로 반영 — 두 칸이 '적용' 버튼 하나를 공유한다.
   *  (칸마다 버튼을 두면 어느 것이 무엇을 적용하는지가 보조 바에서 안 읽힌다) */
  const applyImageMeta = () => {
    const caption = captionRef.current?.value.trim().slice(0, IMAGE_CAPTION_MAX) || null;
    editor
      .chain()
      .focus()
      .updateAttributes('image', { alt: altRef.current?.value.trim() || null, 'data-caption': caption })
      .run();
  };

  /** Q·A 라벨 토글 — 같은 값을 다시 누르면 라벨이 떨어져 평범한 문단으로 돌아간다.
   *  updateAttributes('paragraph') 는 빈 선택(커서)에서도 커서가 든 문단에 닿는다 —
   *  표(RteTable)와 달리 문단은 선택의 **직계 부모**라 조상 사슬을 걸을 필요가 없다. */
  const toggleParagraphRole = (role: ParagraphRole) => {
    editor
      .chain()
      .focus()
      .updateAttributes('paragraph', { role: editor.isActive('paragraph', { role }) ? null : role })
      .run();
  };

  /** 인터뷰 뼈대 삽입 — 빈 문서면 통째로 갈아 끼우고(앞에 빈 문단이 남지 않게),
   *  아니면 커서 자리에 끼워 넣는다. */
  const insertInterviewTemplate = () => {
    if (editor.isEmpty) editor.commands.setContent(INTERVIEW_TEMPLATE, { emitUpdate: true });
    else editor.chain().focus().insertContent(INTERVIEW_TEMPLATE).run();
    editor.commands.focus();
  };

  /** 유의사항 콜아웃 삽입 — 제목 문단('유의사항')은 이미 채워져 있으므로 커서는
   *  **둘째 빈 문단** 안에 둔다(삽입 직후 바로 내용을 쓰게 한다).
   *  · 커서 자리에 끼워 넣을 때: insertContent 가 삽입 끝, 곧 빈 문단에 커서를 남긴다.
   *  · 빈 문서일 때: setContent 뒤 선택이 문서 맨 앞(=제목 문단)이라 'end' 로 옮긴다. */
  const insertRequirementsCallout = () => {
    if (editor.isEmpty) {
      editor.commands.setContent(REQUIREMENTS_CALLOUT, { emitUpdate: true });
      editor.commands.focus('end');
      return;
    }
    editor.chain().focus().insertContent(REQUIREMENTS_CALLOUT).run();
  };

  return (
    <div className="rte board-editor border border-surface-border bg-surface">
      <EditorContext.Provider value={{ editor }}>
        {/* ── 툴바 — Froala 실측 순서·형식. 코드뷰 중에는 코드뷰 버튼만 산다
              (fieldset[disabled] 이 내부 버튼·트리거를 한 번에 잠근다, 구형 동일) ── */}
        <Toolbar aria-label="서식" data-variant="default">
          <fieldset disabled={codeView} className="contents min-w-0 border-0 p-0">
            <ToolbarGroup>
              <Button
                type="button"
                variant="ghost"
                tooltip="인쇄"
                aria-label="인쇄"
                onClick={printContent}
              >
                <PrinterIcon />
              </Button>
              <MarkButton type="bold" tooltip="굵게" aria-label="굵게" />
              <MarkButton type="italic" tooltip="기울임" aria-label="기울임" />
              <MarkButton type="underline" tooltip="밑줄" aria-label="밑줄" />
              <MarkButton type="strike" tooltip="취소선" aria-label="취소선" />
              <FontDropdown
                editor={editor}
                title="글꼴"
                options={FONT_FAMILIES}
                attr="fontFamily"
                apply={(c, v) => (v ? c.setFontFamily(v) : c.unsetFontFamily())}
                previewFont
                trigger={<span aria-hidden="true" className="text-[14px] font-semibold leading-none">A</span>}
              />
              <FontDropdown
                editor={editor}
                title="글자 크기"
                options={FONT_SIZES}
                attr="fontSize"
                apply={(c, v) => (v ? c.setFontSize(v) : c.unsetFontSize())}
                trigger={<span aria-hidden="true" className="text-[13px] font-semibold leading-none">T<span className="text-[10px]">t</span></span>}
              />
            </ToolbarGroup>
            <ToolbarSeparator />
            <ToolbarGroup>
              <ColorPopover editor={editor} />
            </ToolbarGroup>
            <ToolbarSeparator />
            <ToolbarGroup>
              <LinkPopoverK editor={editor} />
              {onUploadImage && (
                <Button
                  type="button"
                  variant="ghost"
                  tooltip="사진 넣기 — 본문에 넣고 첨부에도 함께 담습니다"
                  aria-label="사진 넣기"
                  disabled={uploadingCount > 0}
                  onClick={() => fileRef.current?.click()}
                >
                  <ImagePlusIcon className="tiptap-button-icon" />
                </Button>
              )}
              <YoutubePopover editor={editor} />
              <TableInsertPopover editor={editor} />
            </ToolbarGroup>
            <ToolbarSeparator />
            <ToolbarGroup>
              <AlignDropdown editor={editor} />
              <ListButton type="orderedList" tooltip="번호 목록" aria-label="번호 목록" />
              <ListButton type="bulletList" tooltip="글머리 목록" aria-label="글머리 목록" />
              <Button
                type="button"
                variant="ghost"
                tooltip="내어쓰기"
                aria-label="내어쓰기"
                disabled={!editor.can().liftListItem('listItem')}
                onClick={() => editor.chain().focus().liftListItem('listItem').run()}
              >
                <IndentIcon direction="out" />
              </Button>
              <Button
                type="button"
                variant="ghost"
                tooltip="들여쓰기"
                aria-label="들여쓰기"
                disabled={!editor.can().sinkListItem('listItem')}
                onClick={() => editor.chain().focus().sinkListItem('listItem').run()}
              >
                <IndentIcon direction="in" />
              </Button>
              <Button
                type="button"
                variant="ghost"
                tooltip="구분선"
                aria-label="구분선"
                onClick={() => editor.chain().focus().setHorizontalRule().run()}
              >
                <span aria-hidden="true" className="text-sm font-semibold">—</span>
              </Button>
            </ToolbarGroup>
            {/* ── 인터뷰 도구 (preset='interview' 전용) — 동문 인터뷰 한 편을 쓰는 데
                  필요한 네 가지만. 다른 게시판의 툴바는 이 블록이 통째로 빠져 그대로다. ── */}
            {preset === 'interview' && (
              <>
                <ToolbarSeparator />
                <ToolbarGroup>
                  <Button
                    type="button"
                    variant="ghost"
                    tooltip="인용(풀쿼트) — 본문에서 뽑은 한 문장을 크게"
                    aria-label="인용"
                    data-active-state={editor.isActive('blockquote') ? 'on' : 'off'}
                    onClick={() => editor.chain().focus().toggleBlockquote().run()}
                  >
                    <QuoteIcon />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    tooltip="질문 문단 — 다시 누르면 해제"
                    aria-label="질문 문단"
                    data-active-state={editor.isActive('paragraph', { role: 'q' }) ? 'on' : 'off'}
                    onClick={() => toggleParagraphRole('q')}
                  >
                    <span aria-hidden="true" className="text-[14px] font-bold leading-none">Q</span>
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    tooltip="답변 문단 — 다시 누르면 해제"
                    aria-label="답변 문단"
                    data-active-state={editor.isActive('paragraph', { role: 'a' }) ? 'on' : 'off'}
                    onClick={() => toggleParagraphRole('a')}
                  >
                    <span aria-hidden="true" className="text-[14px] font-bold leading-none">A</span>
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    tooltip="인터뷰 틀 넣기 — 소제목·질문·답변·풀쿼트 뼈대를 깔아 줍니다"
                    aria-label="인터뷰 틀 넣기"
                    onClick={insertInterviewTemplate}
                  >
                    <InterviewTemplateIcon />
                  </Button>
                </ToolbarGroup>
              </>
            )}
            {/* ── 졸업요건 도구 (preset='requirements' 전용) — STEP 본문에서 쓰는 특수
                  서식은 '유의사항' 콜아웃 하나뿐이다. 다른 화면의 툴바는 이 블록이
                  통째로 빠져 그대로다. ── */}
            {preset === 'requirements' && (
              <>
                <ToolbarSeparator />
                <ToolbarGroup>
                  <Button
                    type="button"
                    variant="ghost"
                    tooltip="유의사항 — 파란 줄 콜아웃 박스"
                    aria-label="유의사항 — 파란 줄 콜아웃 박스"
                    onClick={insertRequirementsCallout}
                  >
                    <CalloutIcon />
                  </Button>
                </ToolbarGroup>
              </>
            )}
            <ToolbarSeparator />
            <ToolbarGroup>
              <UndoRedoButton action="undo" tooltip="실행 취소" aria-label="실행 취소" />
              <UndoRedoButton action="redo" tooltip="다시 실행" aria-label="다시 실행" />
              <Button
                type="button"
                variant="ghost"
                tooltip="서식 지우기"
                aria-label="서식 지우기"
                onClick={() => editor.chain().focus().unsetAllMarks().run()}
              >
                <EraserIcon />
              </Button>
              <Button
                type="button"
                variant="ghost"
                tooltip="전체 선택"
                aria-label="전체 선택"
                onClick={() => editor.chain().focus().selectAll().run()}
              >
                <SelectAllIcon />
              </Button>
            </ToolbarGroup>
          </fieldset>
          <ToolbarGroup>
            <Button
              type="button"
              variant="ghost"
              tooltip="코드뷰(HTML)"
              aria-label="코드뷰"
              data-active-state={codeView ? 'on' : 'off'}
              onClick={toggleCodeView}
            >
              <CodeViewIcon />
            </Button>
          </ToolbarGroup>
          {uploadingCount > 0 && (
            <span className="ml-2 self-center text-xs font-medium text-yonsei-blue">
              이미지 업로드 중… ({uploadingCount})
            </span>
          )}
          <Spacer />
        </Toolbar>

        {/* ── 표 보조 바 (2026-08 시안 1a) — 툴바와 같은 면에 붙는 인라인 바.
              캡션(행·열·셀)이 버튼 묶음의 대상을 말하고, 아이콘의 강조면이 작용 지점을 말한다.
              색·테두리·여백은 "표 스타일" 팝오버 한 곳으로 모아 바 길이를 줄였다.
              ⚠️ 크기 초기화 3종(열 너비 초기화·행 높이 같게·행 높이 초기화)은 바에서 뺐다 —
              표 안에서 마우스로 직접 끄는 편이 빠르기 때문이다. rte-schema 의 명령
              (resetColumnWidths·equalizeRowHeights·resetRowHeights)은 그대로 살아 있다. ── */}
        {inTable && (
          <div className="rte-ctxbar relative z-[5] flex flex-wrap items-center gap-0.5 px-2 py-[5px]">
            <span className={CTX_CAPTION}>행</span>
            <CtxBtn
              title="위에 행 추가"
              label="위"
              icon={<TableRowAddIcon where="before" />}
              onClick={() => editor.chain().focus().addRowBefore().run()}
            />
            <CtxBtn
              title="아래에 행 추가"
              label="아래"
              icon={<TableRowAddIcon where="after" />}
              onClick={() => editor.chain().focus().addRowAfter().run()}
            />
            <CtxBtn
              title="행 삭제"
              label="삭제"
              icon={<TableRowDeleteIcon />}
              onClick={() => editor.chain().focus().deleteRow().run()}
            />
            <CtxDivider />
            <span className={CTX_CAPTION}>열</span>
            <CtxBtn
              title="왼쪽에 열 추가"
              label="왼쪽"
              icon={<TableColAddIcon where="before" />}
              onClick={() => editor.chain().focus().addColumnBefore().run()}
            />
            <CtxBtn
              title="오른쪽에 열 추가"
              label="오른쪽"
              icon={<TableColAddIcon where="after" />}
              onClick={() => editor.chain().focus().addColumnAfter().run()}
            />
            <CtxBtn
              title="열 삭제"
              label="삭제"
              icon={<TableColDeleteIcon />}
              onClick={() => editor.chain().focus().deleteColumn().run()}
            />
            <CtxDivider />
            <span className={CTX_CAPTION}>셀</span>
            <CtxBtn
              title="셀 병합"
              label="병합"
              icon={<TableMergeIcon />}
              disabled={!editor.can().mergeCells()}
              onClick={() => editor.chain().focus().mergeCells().run()}
            />
            <CtxBtn
              title="셀 분할"
              label="분할"
              icon={<TableSplitIcon />}
              disabled={!editor.can().splitCell()}
              onClick={() => editor.chain().focus().splitCell().run()}
            />
            <CtxDivider />
            <CtxBtn
              title="머리행 켜기/끄기"
              label="머리행"
              icon={<TableHeaderRowIcon />}
              active={editor.isActive('tableHeader')}
              onClick={() => editor.chain().focus().toggleHeaderRow().run()}
            />
            <CtxDivider />
            <TableStylePopover editor={editor} attrs={tableAttrs} />
            {/* 파괴적 명령은 넓은 구분자 뒤에 홀로 둔다 — 실수 클릭을 거리로 막는다 */}
            <CtxDivider wide />
            <CtxBtn
              title="표 삭제"
              tone="danger"
              icon={<TableDeleteIcon />}
              onClick={() => editor.chain().focus().deleteTable().run()}
            />
          </div>
        )}

        {/* ── 이미지 보조 바 (2026-08 시안 1d) — 표 보조 바와 같은 문법(면·버튼·구분자) ── */}
        {onImage && (
          <div className="rte-ctxbar relative z-[5] flex flex-wrap items-center gap-0.5 px-2 py-[5px]">
            <span className={CTX_CAPTION}>정렬</span>
            {(['left', 'center', 'right'] as const).map((align) => (
              <CtxBtn
                key={align}
                title={`이미지 ${align === 'left' ? '왼쪽' : align === 'center' ? '가운데' : '오른쪽'} 정렬`}
                icon={<AlignIcon variant={align} />}
                active={imageAttrs['data-align'] === align}
                onClick={() => editor.chain().focus().updateAttributes('image', { 'data-align': align }).run()}
              />
            ))}
            <CtxDivider />
            <span className={CTX_CAPTION}>폭</span>
            <CtxBtn
              title="원본 폭"
              label="원본"
              icon={<ImageWidthFullIcon />}
              active={!imageAttrs.widthPct}
              onClick={() => editor.chain().focus().updateAttributes('image', { widthPct: null }).run()}
            />
            <CtxBtn
              title="폭 50%"
              label="50%"
              icon={<ImageWidthHalfIcon />}
              active={imageAttrs.widthPct === 50}
              onClick={() => editor.chain().focus().updateAttributes('image', { widthPct: 50 }).run()}
            />
            <CtxDivider />
            <label className={CTX_CAPTION} htmlFor="board-editor-image-alt">대체텍스트</label>
            <input
              id="board-editor-image-alt"
              key={`alt-${String(imageAttrs.src ?? '')}-${editor.state.selection.from}`}
              ref={altRef}
              type="text"
              defaultValue={(imageAttrs.alt as string | undefined) ?? ''}
              placeholder="사진 설명(화면 낭독기용)"
              className={cn(PANEL_INPUT, 'w-[220px]')}
              onKeyDown={(e) => {
                if (e.key !== 'Enter') return;
                e.preventDefault();
                applyImageMeta();
              }}
            />
            {/* 캡션 — 대체텍스트와 다른 것이다. 대체텍스트는 화면 낭독기만 읽고,
                캡션은 사진 아래에 눈으로 보이는 글이다. 저장은 img[data-caption] 한
                속성이고 공개 화면의 figure/figcaption 은 서버가 만든다. */}
            <label className={CTX_CAPTION} htmlFor="board-editor-image-caption">캡션</label>
            <input
              id="board-editor-image-caption"
              key={`cap-${String(imageAttrs.src ?? '')}-${editor.state.selection.from}`}
              ref={captionRef}
              type="text"
              maxLength={IMAGE_CAPTION_MAX}
              defaultValue={(imageAttrs['data-caption'] as string | undefined) ?? ''}
              placeholder="사진 아래에 보일 설명(비워 두면 안 나옵니다)"
              className={cn(PANEL_INPUT, 'w-[280px]')}
              onKeyDown={(e) => {
                if (e.key !== 'Enter') return;
                e.preventDefault();
                applyImageMeta();
              }}
            />
            <button type="button" className={cn(PANEL_BTN, 'ml-1')} onClick={applyImageMeta}>
              적용
            </button>
          </div>
        )}

        {/* 숨은 파일 입력 — 이미지 버튼용 */}
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          multiple
          className="hidden"
          onChange={(e) => {
            if (e.target.files) void uploadAndInsert(Array.from(e.target.files));
            e.target.value = '';
          }}
        />

        {/* 본문 ↔ 코드뷰 — 에디터 인스턴스는 숨겨서 보존한다(상태·히스토리 유지) */}
        <div className={codeView ? 'hidden' : undefined}>
          <PostCanvas>
            <EditorContent editor={editor} />
          </PostCanvas>
        </div>
        {/* 원문 모드 토글 — 코드뷰 안에서만 보인다(구형처럼 소스를 직접 붙여넣는 자리) */}
        {codeView && onBodyRawChange && (
          <div className="rte-ctxbar flex flex-wrap items-center gap-x-3 gap-y-1 px-2 py-[6px]">
            <label className="flex items-center gap-1.5 text-[12px] font-semibold text-content">
              <input
                type="checkbox"
                checked={bodyRaw}
                onChange={(e) => onBodyRawChange(e.target.checked)}
                className="h-3.5 w-3.5"
              />
              원문 그대로 저장 (정화 최소화)
            </label>
            <span className="text-[11px] leading-snug text-content-faint">
              {bodyRaw
                ? '실행 코드(스크립트)만 제거하고 나머지 HTML·CSS 를 그대로 게시합니다. 레이아웃 충돌·접근성은 보장되지 않습니다.'
                : '아래아한글·워드에서 만든 HTML 을 원래 디자인 그대로 올릴 때만 켜세요.'}
            </span>
          </div>
        )}
        {codeView && (
          <textarea
            value={codeHtml}
            onChange={(e) => {
              setCodeHtml(e.target.value);
              // 코드뷰에서 고친 소스를 폼으로 바로 올린다 — 원문 모드는 WYSIWYG 로
              // 되돌아가지 않고 그대로 저장하는 것이 정상 경로이기 때문이다.
              onChange(e.target.value);
            }}
            aria-label="HTML 소스"
            spellCheck={false}
            className="block min-h-[380px] w-full resize-y bg-[#1E2430] p-4 font-mono text-[12px] leading-relaxed text-[#E6EAF2] outline-none"
          />
        )}

        <div className="border-t border-surface-border px-3 py-1 text-right text-[11px] text-content-faint">
          공백 포함 {charCount}자 · 단어 {wordCount}개
        </div>
      </EditorContext.Provider>
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════════
   커스텀 툴바 컨트롤 — UI Components 프리미티브 조립 (Froala 형식 재현)
   ════════════════════════════════════════════════════════════════════ */

/** 글꼴·크기 드롭다운 — Froala 형식: 트리거는 현재값이 아니라 아이콘(A▾ / Tt▾).
 *  (실측 fontFamilySelection:false, fontSizeSelection:false) */
function FontDropdown({
  editor,
  title,
  options,
  attr,
  apply,
  previewFont = false,
  trigger,
}: {
  editor: Editor;
  title: string;
  options: SelectOption[];
  attr: 'fontFamily' | 'fontSize';
  apply: (
    chain: ReturnType<Editor['chain']>,
    value: string,
  ) => ReturnType<Editor['chain']>;
  previewFont?: boolean;
  trigger: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const raw = (editor.getAttributes('textStyle') as Record<string, string | null>)[attr] ?? '';
  return (
    <DropdownMenu modal={false} open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <Button type="button" variant="ghost" tooltip={title} aria-label={title}>
          {trigger}
          <ChevronDownIcon className="tiptap-button-dropdown-small" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="max-h-72 overflow-y-auto">
        <DropdownMenuGroup>
          {options.map((o) => (
            <DropdownMenuItem key={o.value || '(unset)'} asChild>
              <Button
                type="button"
                variant="ghost"
                data-active-state={raw === o.value || (!raw && !o.value) ? 'on' : 'off'}
                onClick={() => apply(editor.chain().focus(), o.value).run()}
              >
                <span
                  className="text-[13px]"
                  style={previewFont && o.value ? { fontFamily: o.value } : undefined}
                >
                  {o.label}
                </span>
              </Button>
            </DropdownMenuItem>
          ))}
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** 정렬 — Froala 형식(드롭다운 하나). 토글이 아니라 "설정" + 부분 선택 split */
function AlignDropdown({ editor }: { editor: Editor }) {
  const [open, setOpen] = useState(false);
  const ALIGNS = [
    { value: 'left', label: '왼쪽 정렬', Icon: AlignLeftIcon },
    { value: 'center', label: '가운데 정렬', Icon: AlignCenterIcon },
    { value: 'right', label: '오른쪽 정렬', Icon: AlignRightIcon },
    { value: 'justify', label: '양쪽 정렬', Icon: AlignJustifyIcon },
  ] as const;
  const current = ALIGNS.find((a) => editor.isActive({ textAlign: a.value })) ?? ALIGNS[0];
  return (
    <DropdownMenu modal={false} open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <Button type="button" variant="ghost" tooltip="정렬" aria-label="정렬">
          <current.Icon className="tiptap-button-icon" />
          <ChevronDownIcon className="tiptap-button-dropdown-small" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        <DropdownMenuGroup>
          {ALIGNS.map((a) => (
            <DropdownMenuItem key={a.value} asChild>
              <Button
                type="button"
                variant="ghost"
                data-active-state={editor.isActive({ textAlign: a.value }) ? 'on' : 'off'}
                onClick={() => runOnSelection(editor, (c) => c.setTextAlign(a.value))}
              >
                <a.Icon className="tiptap-button-icon" />
                <span className="text-[13px]">{a.label}</span>
              </Button>
            </DropdownMenuItem>
          ))}
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** 색 — Froala 형식 재현: 물방울 버튼 → [배경색|글자색] 두 탭, 27색 그리드(7열) + 해제(✕).
 *  글자색은 Color(span color), 배경색은 Highlight(mark background) — 저장 계약 유지. */
function ColorPopover({ editor }: { editor: Editor }) {
  const [open, setOpen] = useState(false);
  // 실측 colorsDefaultTab: 'text'
  const [tab, setTab] = useState<'text' | 'background'>('text');
  const activeText = editor.getAttributes('textStyle').color as string | undefined;
  const activeBg = editor.getAttributes('highlight').color as string | undefined;
  const isActive = (hex: string) =>
    tab === 'text'
      ? (activeText ?? '').toUpperCase() === hex.toUpperCase()
      : (activeBg ?? '').toUpperCase() === hex.toUpperCase();
  const pick = (hex: string) => {
    const chain = editor.chain().focus();
    if (tab === 'text') chain.setColor(hex).run();
    else chain.setHighlight({ color: hex }).run();
    setOpen(false);
  };
  const clear = () => {
    const chain = editor.chain().focus();
    if (tab === 'text') chain.unsetColor().run();
    else chain.unsetHighlight().run();
    setOpen(false);
  };
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          tooltip="색"
          aria-label="색"
          data-active-state={activeText || activeBg ? 'on' : 'off'}
        >
          <DropletIcon />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="p-2">
        {/* 탭 — Froala 순서 그대로(배경색 | 글자색), 기본 선택은 글자색 */}
        <div className="mb-2 flex gap-1 border-b border-surface-border pb-1">
          {([
            { key: 'background', label: '배경색' },
            { key: 'text', label: '글자색' },
          ] as const).map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => setTab(t.key)}
              className={cn(
                'px-2 py-1 text-[12px] font-semibold',
                tab === t.key ? 'text-yonsei-navy underline underline-offset-4' : 'text-content-faint hover:text-content',
              )}
            >
              {t.label}
            </button>
          ))}
        </div>
        <div className="grid gap-1" style={{ gridTemplateColumns: `repeat(${COLORS_STEP}, 1.5rem)` }}>
          {FROALA_COLORS.map((hex) => (
            <button
              key={hex}
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => pick(hex)}
              title={hex}
              aria-label={`${tab === 'text' ? '글자색' : '배경색'} ${hex}`}
              className={cn(
                'h-6 w-6 border',
                isActive(hex) ? 'border-content ring-1 ring-content' : 'border-surface-border',
              )}
              style={{ backgroundColor: hex }}
            />
          ))}
          {/* 해제(✕) — Froala 팔레트의 REMOVE 셀 */}
          <button
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onClick={clear}
            title="색 해제"
            aria-label={`${tab === 'text' ? '글자색' : '배경색'} 해제`}
            className="grid h-6 w-6 place-items-center border border-surface-border text-[12px] text-content-soft hover:text-content"
          >
            ✕
          </button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

/** 링크 — Froala 형식: 삽입(URL·새 탭) / 링크 위에서는 열기·수정·제거 */
function LinkPopoverK({ editor }: { editor: Editor }) {
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState('');
  const [blank, setBlank] = useState(false);
  const [error, setError] = useState('');
  const onLink = editor.isActive('link');

  const openChange = (v: boolean) => {
    setOpen(v);
    setError('');
    if (v) {
      const attrs = editor.getAttributes('link') as { href?: string; target?: string | null };
      setUrl(attrs.href ?? '');
      setBlank(attrs.target === '_blank');
    }
  };
  const applyLink = () => {
    const href = normalizeUrl(url);
    if (!href) {
      setError('주소를 입력하세요.');
      return;
    }
    const target = blank ? '_blank' : null;
    const chain = editor.chain().focus();
    if (!onLink && editor.state.selection.empty) {
      // 선택이 없으면 주소 텍스트로 링크를 새로 심는다(구형 관례)
      chain
        .insertContent({
          type: 'text',
          text: href,
          marks: [{ type: 'link', attrs: { href, target } }],
        })
        .run();
    } else {
      chain.extendMarkRange('link').setLink({ href, target }).run();
    }
    setOpen(false);
  };
  const removeLink = () => {
    editor.chain().focus().extendMarkRange('link').unsetLink().run();
    setOpen(false);
  };
  const openHref = () => {
    const href = (editor.getAttributes('link').href as string | undefined) ?? normalizeUrl(url);
    if (href) window.open(href, '_blank', 'noopener');
  };

  return (
    <Popover open={open} onOpenChange={openChange}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          tooltip="링크 삽입"
          aria-label="링크 삽입"
          data-active-state={onLink ? 'on' : 'off'}
        >
          <LinkIcon className="tiptap-button-icon" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80 p-3">
        <Input
          type="text"
          value={url}
          placeholder="https://…"
          aria-label="링크 주소"
          onChange={(e: React.ChangeEvent<HTMLInputElement>) => setUrl(e.target.value)}
          onKeyDown={(e: React.KeyboardEvent) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              applyLink();
            }
          }}
        />
        <label className="mt-2 flex items-center gap-1.5 text-[12px] text-content-soft">
          <input
            type="checkbox"
            checked={blank}
            onChange={(e) => setBlank(e.target.checked)}
            className="h-3.5 w-3.5"
          />
          새 탭에서 열기
        </label>
        {error && <p className="mt-1.5 text-[11px] text-red-600">{error}</p>}
        <div className="mt-2.5 flex items-center gap-1.5">
          <Button type="button" variant="primary" onClick={applyLink}>
            {onLink ? '수정' : '삽입'}
          </Button>
          {onLink && (
            <>
              <Button type="button" variant="ghost" onClick={openHref} aria-label="링크 열기">
                <ExternalLinkIcon className="tiptap-button-icon" />
                열기
              </Button>
              <Button type="button" variant="ghost" onClick={removeLink}>
                제거
              </Button>
            </>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

/** 비디오 — Froala 형식(URL 삽입). 주소 해석은 Youtube 확장이 담당 */
function YoutubePopover({ editor }: { editor: Editor }) {
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState('');
  const [error, setError] = useState('');
  const insert = () => {
    const src = normalizeUrl(url);
    const ok = src ? editor.chain().focus().setYoutubeVideo({ src }).run() : false;
    if (!ok) {
      setError('유튜브 주소를 확인해 주세요.');
      return;
    }
    setUrl('');
    setError('');
    setOpen(false);
  };
  return (
    <Popover open={open} onOpenChange={(v) => { setOpen(v); if (!v) setError(''); }}>
      <PopoverTrigger asChild>
        <Button type="button" variant="ghost" tooltip="비디오 삽입" aria-label="비디오 삽입">
          <YoutubeIcon />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80 p-3">
        <div className="flex items-center gap-2">
          <Input
            type="text"
            value={url}
            placeholder="https://youtube.com/watch?v=…"
            aria-label="유튜브 주소"
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setUrl(e.target.value)}
            onKeyDown={(e: React.KeyboardEvent) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                insert();
              }
            }}
          />
          <Button type="button" variant="primary" onClick={insert}>
            삽입
          </Button>
        </div>
        {error && <p className="mt-1.5 text-[11px] text-red-600">{error}</p>}
      </PopoverContent>
    </Popover>
  );
}

/** 표 삽입 — 격자 피커(Froala 형식). 새 표 기본값은 구형 실측 파리티:
 *  1px 연회색(#DDD) 격자 + 좁은 셀 여백. 삽입과 한 체인이라 undo 한 번에 사라진다. */
function TableInsertPopover({ editor }: { editor: Editor }) {
  const [open, setOpen] = useState(false);
  const [hover, setHover] = useState<{ rows: number; cols: number } | null>(null);
  return (
    <Popover open={open} onOpenChange={(v) => { setOpen(v); if (!v) setHover(null); }}>
      <PopoverTrigger asChild>
        <Button type="button" variant="ghost" tooltip="표 삽입" aria-label="표 삽입">
          <TableIcon />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="p-3">
        <div
          className="grid gap-0.5"
          style={{ gridTemplateColumns: `repeat(${GRID_COLS}, 1rem)` }}
          onMouseLeave={() => setHover(null)}
        >
          {Array.from({ length: GRID_ROWS * GRID_COLS }, (_, i) => {
            const rows = Math.floor(i / GRID_COLS) + 1;
            const cols = (i % GRID_COLS) + 1;
            const lit = !!hover && rows <= hover.rows && cols <= hover.cols;
            return (
              <button
                key={i}
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onMouseEnter={() => setHover({ rows, cols })}
                onFocus={() => setHover({ rows, cols })}
                onClick={() => {
                  editor
                    .chain()
                    .focus()
                    .insertTable({ rows, cols, withHeaderRow: false })
                    .setTableAttrs({ border: '1', borderColor: 'lightgray', cellpad: 'narrow' })
                    .run();
                  setHover(null);
                  setOpen(false);
                }}
                title={`${rows} × ${cols}`}
                aria-label={`${rows}행 ${cols}열 표 삽입`}
                className={cn(
                  'h-4 w-4 rounded-[2px] border',
                  lit ? 'border-yonsei-navy bg-yonsei-navy' : 'border-surface-border bg-surface',
                )}
              />
            );
          })}
        </div>
        <p className="mt-2 text-[11px] text-content-faint">
          {hover ? `${hover.rows} × ${hover.cols}` : '표 크기를 짚으세요 (머리행은 표 메뉴에서)'}
        </p>
      </PopoverContent>
    </Popover>
  );
}

/** 표 스타일 — 셀 배경·테두리 굵기·테두리 색·셀 여백을 한 팝오버로 모은다.
 *  보조 바에 스와치를 늘어놓던 구판은 바가 두 줄로 넘쳐 표를 가렸다.
 *  트리거의 칩(굵기 글자 + 색 사각)은 팝오버를 열지 않아도 현재 값을 비춘다. */
function TableStylePopover({ editor, attrs }: { editor: Editor; attrs: Record<string, unknown> }) {
  const [open, setOpen] = useState(false);
  // 열거값 밖은 스키마(pickEnum)가 null 로 정규화하므로 키 조회가 안전하다.
  // null = "미지정" — 굵기는 레거시 기본(줄무늬), 색은 구형 기본(연회색), 여백은 보통.
  const border = (attrs.border as TableBorder | null | undefined) ?? null;
  const borderColor = (attrs.borderColor as TableBorderColor | null | undefined) ?? 'lightgray';
  const cellpad = (attrs.cellpad as TableCellpad | null | undefined) ?? null;

  return (
    <DropdownMenu modal={false} open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          onMouseDown={(e) => e.preventDefault() /* 에디터 선택 유지 */}
          title="표 스타일 (셀 배경·테두리·여백)"
          aria-label="표 스타일"
          className={cn(
            'flex h-[30px] shrink-0 items-center gap-1.5 whitespace-nowrap rounded-[12px] border-0 pl-2 pr-[7px] text-[11.5px] font-semibold leading-none text-content transition-colors',
            open ? 'bg-[rgba(15,22,36,0.05)]' : 'bg-transparent hover:bg-[var(--tt-button-hover-bg-color)]',
          )}
        >
          <TableStyleIcon />
          표 스타일
          <span className="flex items-center gap-1 border-l border-surface-border pl-1.5">
            <span className="text-[11px] font-medium text-content-faint">
              {border === null ? '이전 기본' : `${border}px`}
            </span>
            <span
              aria-hidden="true"
              className="h-3 w-3 rounded-[2px] shadow-[inset_0_0_0_1px_rgba(0,0,0,0.14)]"
              style={{ backgroundColor: BORDER_COLOR_SWATCHES[borderColor].css }}
            />
          </span>
          <ChevronDownIcon className="h-3 w-3" />
        </button>
      </DropdownMenuTrigger>
      {/* 명령이 .focus() 로 에디터를 되잡아도 닫히지 않게 한다 — 굵기·색·여백을
          연달아 만지는 패널이라 한 번 클릭에 닫히면 4번 다시 열어야 한다.
          바깥 클릭·ESC 로는 그대로 닫힌다. */}
      <DropdownMenuContent
        align="end"
        style={{ width: 300, padding: 14 }}
        onFocusOutside={(e) => e.preventDefault()}
      >
        <p className="mb-[7px] text-[11px] font-bold text-content-faint">
          셀 배경 <span className="font-medium">— 선택한 셀에만</span>
        </p>
        <div className="flex gap-1.5">
          {CELL_BGS.map((c) => (
            <button
              key={c.label}
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => editor.chain().focus().setCellAttribute('backgroundColor', c.value).run()}
              title={`셀 배경 ${c.label}`}
              aria-label={`셀 배경 ${c.label}`}
              className={cn(
                'grid h-[26px] w-[26px] place-items-center rounded-[3px] border border-surface-border text-[11px] text-content-faint',
                c.value ? '' : 'bg-surface',
              )}
              style={c.value ? { backgroundColor: c.value } : undefined}
            >
              {c.value ? '' : '×'}
            </button>
          ))}
        </div>

        <p className="mb-[7px] mt-[14px] text-[11px] font-bold text-content-faint">테두리 굵기</p>
        <div className="grid grid-cols-3 gap-1.5">
          {BORDER_WIDTHS.map((o) => {
            const selected = (border ?? '') === o.value;
            return (
              <button
                key={o.value || 'unset'}
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() =>
                  editor
                    .chain()
                    .focus()
                    .setTableAttrs({ border: (o.value || null) as TableBorder | null })
                    .run()
                }
                title={o.label}
                aria-label={`표 테두리 굵기 ${o.label}`}
                aria-pressed={selected}
                className={cn(
                  'flex h-[38px] flex-col items-center justify-center gap-[6px] rounded-[3px] border',
                  selected
                    ? 'border-yonsei-navy bg-surface-soft font-bold text-yonsei-navy'
                    : 'border-surface-border bg-surface font-semibold text-content-faint',
                )}
              >
                <span aria-hidden="true" className="w-[34px]" style={borderWidthPreviewStyle(o.value)} />
                <span className="text-[10.5px] leading-none">{BORDER_WIDTH_TILE_LABELS[o.value]}</span>
              </button>
            );
          })}
        </div>

        <p className="mb-[7px] mt-[14px] text-[11px] font-bold text-content-faint">테두리 색</p>
        <div className="flex flex-wrap gap-1.5">
          {TABLE_BORDER_COLORS.map((name) => (
            <button
              key={name}
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => editor.chain().focus().setTableAttrs({ borderColor: name }).run()}
              title={`테두리 색 ${BORDER_COLOR_SWATCHES[name].label}`}
              aria-label={`표 테두리 색 ${BORDER_COLOR_SWATCHES[name].label}`}
              aria-pressed={borderColor === name}
              className={cn(
                'h-[26px] w-[26px] rounded-[3px] border',
                borderColor === name
                  ? 'border-content shadow-[0_0_0_2px_#fff,0_0_0_3px_#232323]'
                  : 'border-surface-border',
              )}
              style={{ backgroundColor: BORDER_COLOR_SWATCHES[name].css }}
            />
          ))}
        </div>

        <p className="mb-[7px] mt-[14px] text-[11px] font-bold text-content-faint">셀 여백</p>
        <div className="flex">
          {CELLPAD_OPTIONS.map((o, i) => {
            const selected = (cellpad ?? '') === o.value;
            return (
              <button
                key={o.value || 'default'}
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() =>
                  editor
                    .chain()
                    .focus()
                    .setTableAttrs({ cellpad: (o.value || null) as TableCellpad | null })
                    .run()
                }
                aria-label={`셀 여백 ${o.label}`}
                aria-pressed={selected}
                className={cn(
                  'relative h-[28px] border px-3 text-[11.5px] leading-none',
                  i > 0 && '-ml-px',
                  i === 0 && 'rounded-l-[3px]',
                  i === CELLPAD_OPTIONS.length - 1 && 'rounded-r-[3px]',
                  selected
                    ? 'z-[1] border-yonsei-navy bg-yonsei-navy font-bold text-white'
                    : 'border-surface-border bg-surface text-content',
                )}
              >
                {o.label}
              </button>
            );
          })}
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
