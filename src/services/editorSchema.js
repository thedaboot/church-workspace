// ============================================================================
// 본문 편집기의 **문서 모양**(노드·마크) 한 벌
// ----------------------------------------------------------------------------
// MarkdownEditor와 같이 쓰기(services/coedit)가 **같은 스키마**를 봐야 한다. 같이 쓰기는
// 편집기를 띄우기 전에 마크다운에서 Yjs 문서를 심는데(coedit/core.seedState · 옛 글 채우기
// scripts/seed-card-docs.mjs), 그 스키마가 편집기와 한 칸이라도 다르면 심은 문서를 편집기가
// 읽다가 그 노드를 버리거나 기본값을 다르게 채운다. 그래서 설정을 여기 한 군데에만 적는다.
//
// 여기에는 **모양을 정하는 것만** 둔다 — 안내 글(Placeholder)·단축키·잠긴 제목 같은 동작은
// MarkdownEditor에 그대로 남는다. 순수 모듈이라 노드에서도 읽힌다(tests/coedit).
//
// `undoRedo: false` — 같이 쓰기에서는 되돌리기를 Collaboration이 가져간다(둘을 같이 켜면
// TipTap이 경고하고, 되돌리기가 남의 글까지 되돌린다).
// ============================================================================
import { getSchema } from '@tiptap/core';
import { StarterKit } from '@tiptap/starter-kit';
import { Highlight } from '@tiptap/extension-highlight';
import { Image } from '@tiptap/extension-image';
// starter-kit이 이미 물고 있는 패키지라 새 다운로드가 없다(3.29.0 동일)
import { TaskList, TaskItem } from '@tiptap/extension-list';

export function bodyExtensions({ undoRedo = true } = {}) {
  return [
    StarterKit.configure({
      heading: { levels: [1, 2, 3, 4] },
      // 우리 마크다운 서브셋에 없는 블록·마크는 비활성화
      blockquote: false, codeBlock: false, code: false,
      // 구분선 — `---`를 치면 바로 선이 된다(StarterKit의 입력 규칙). `***`·`___`도 같이
      // 받는다. 저장 형식은 언제나 `---` 한 줄이다(markdown.js).
      horizontalRule: {},
      // 생 URL은 평문으로 유지해야 하므로 자동 링크화 금지
      link: { openOnClick: false, autolink: false, linkOnPaste: false },
      ...(undoRedo ? {} : { undoRedo: false }),
    }),
    Highlight,
    // 본문 체크리스트 — 저장 형식은 `- [ ]`/`- [x]` 한 줄(markdown.js).
    // nested: false — 중첩 체크리스트는 서브셋에 없다(직렬화가 첫 문단만 본다).
    TaskList,
    TaskItem.configure({ nested: false }),
    Image.configure({ inline: false, allowBase64: false }),
  ];
}

let cached = null;
export const bodySchema = () => (cached ||= getSchema(bodyExtensions()));
