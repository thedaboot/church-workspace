# 수정·입력 화면 감사 반영 — 문서에 옮길 것 (2026-09-25)

HANDOFF·PITFALLS·tests/README에 사람이 옮길 메모. 코드 주석에 이미 이유가 있다.

## 저장 형식 (markdown.js) — PITFALLS에 새 번호로
- **빈 줄을 합치지 않는다**: 빈 문단 N개 = 줄바꿈 N+1개. 끝은 줄바꿈만 걷는다(`\s+$` 아님 — 끝의 빈 항목 `- `가 `-` 글자가 됐다).
- **블록 안 줄바꿈은 공백으로 적는다**(제목·목록·체크). 편집기도 그 자리의 Shift+Enter·Mod+Enter를 Enter처럼 한다(`BlockBreaks`). 문단 안 Shift+Enter는 그대로 줄바꿈.
- **중첩 목록은 평평하게 적는다**, 목록 안 Tab은 들이지 않는다(읽는 쪽이 들여쓰기를 안 본다).
- **이어진 번호 줄은 읽을 때의 차례로 적는다**(`renumberRuns`).
- **문법처럼 생긴 문단 줄은 `\`로 막는다**(`needsEscape`·`unescapeLine`) — 읽는 셋(mdToDoc·RichText·paper `paperBlocks`)이 같은 함수를 쓴다. 새 읽는 자리를 만들면 `unescapeLine`을 먼저 부를 것(안 부르면 `\`가 글자로 찍힌다). 이미지 주소 단독 줄은 막지 않는다.
- 평문 붙여넣기는 `clipboardTextParser`(줄마다 문단 · 빈 줄은 빈 문단).
- 검사: `tests/mdcheck` 뒤 세 절(감사 2·6·7).

## 노트
- `ensureNoteSections`는 도막 사이 줄을 **그대로** 되적는다(`splitRaw`). 종이용 `splitNoteSections`는 도막 앞뒤 **빈 줄만** 걷는다(첫 줄 들여쓰기는 남는다).
- 잠긴 도막 바로 뒤 빈 문단(다음이 제목·끝)에서 Backspace·Delete는 아무 일도 안 한다 + appendTransaction이 빈 문단을 도로 끼운다(`LockedHeadings`).
- 예배 노트 `MyNote`: 같은 주보에서 note만 새로 오면(공유 토글·캐시 뒤 조회) 고치던 글·편집 모드를 건드리지 않는다. **개발 모드 StrictMode의 두 번 돌리기**가 되살린 초안을 덮던 자리 — 같은 note 객체면 건너뛴다.
- 초안: 1.2초 안에 떠나도 `pendingDraft`를 열쇠를 떠날 때 쓴다(말씀·예배 둘 다).

## 읽기 종이 · 업무 보기 = 편집 화면 (사용자 결정 A1)
- HANDOFF §2 '사용자 판단 대기'의 "노트 읽기/편집 종이 높이 차" 항목은 **A1(편집과 같게)로 결정·반영**됐다 — 지울 것.
- 값은 `.note-paper .tiptap`에서 온다: 블록 사이 4px · li 2px · 체크 항목 아래 4px(편집 쪽 `li > div > p`의 margin) · 빈 줄 = 한 줄(`paper-gap`) · break-spaces · 두 열에서 첫 블록 min-height 29px(편집 격자 행이 라벨 높이로 서는 것) · 한 열에서 라벨 line-height 1.6 · row-gap 3px. **`.paper-note` 안쪽만**(주보 종이 불변). 편집 쪽 CSS를 바꾸면 이 값도 같이.
- RichText: 빈 줄 = 빈 문단(댓글·요약도 한 줄), 문단 break-spaces.
- 검사: `tests/word` 마지막 절(1440·375 줄 위치 차 0) · `tests/handoff` 마지막 절(업무 보기↔편집기 · 하위 업무 추가 칸 x — B2).

## 업무 창
- dirty는 **수정을 누른 순간의 스냅숏**과 견준다. 저장은 `utils.mergeTaskEdit` — 내가 바꾼 칸만 내 값, 나머지는 지금 카드. cardPatch는 그대로(보내는 값만 달라짐). 같은 칸 동시 수정은 나중 저장이 이긴다.
- ✕·딤도 푸터와 같은 확인. dirty일 때만 beforeunload.

## 입력 칸
- Enter로 무언가 하는 핸들러는 전부 `utils.imeComposing`부터 본다 — `tests/logcheck`가 소스의 모든 `e.key === 'Enter'` 핸들러에 가드가 있는지 단정한다(새 칸을 만들면 가드를 넣을 것).
- 댓글·답글·댓글 수정: `(pointer: coarse)`에서는 Enter가 줄바꿈, 등록은 버튼.
- `MENTION_TAIL`에 `*=_~` 백틱 추가(끝에 붙은 것만).

## tests/README 표에 덧붙일 것
- `mdcheck`: 빈 줄 보존 · 줄 구조 왕복 안정 · `\` 막기.
- `logcheck`: 담당 업무 도막 value 왕복 · mergeTaskEdit · 조합 가드 소스 단정 · 서식 안 멘션.
- `modalclose`: ✕·딤 확인 · beforeunload · 남의 체크 · 폰 Enter 줄바꿈 · 조합 Enter.
- `word`: 잠긴 도막 백스페이스 · 평문 붙여넣기 · 초안 즉시 남기기 · 읽기=편집 줄 위치.
- `worship`: 편집 중 공유 토글 · 쓰고 곧바로 나가기.
- `handoff`: 업무 보기=편집기 줄 · 하위 업무 추가 칸 x.

## 알게 된 것
- `tests/worship`의 '취소하면 고치던 글을 버린다'(`버릴 글`)는 `.tiptap.focus()`만 하고 쳐서 커서가 첫 도막 제목(잠김)에 앉아 **글이 애초에 안 들어간다** — 지금도 통과하지만 아무것도 재지 않는 줄이다. 문단에 커서를 놓도록 고칠 것(이번에 새로 넣은 줄들은 그렇게 했다).
- S7(주보 자동 저장 경합)은 게스트 저장이 한 번에 끝나서 스위트로 만들 수 없다.
