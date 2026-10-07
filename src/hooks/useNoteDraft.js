import { useEffect, useRef } from 'react';
import { writeCache, dropCache } from '../services/cache.js';
import { NOTE_DRAFT_DELAY } from '../services/noteTemplate.js';

// 노트 초안을 브라우저에 남기는 한 벌(사용자 결정 2026-09-14 — 서버 자동 저장은 순원에게 미완성 글을 보인다).
// 예배 노트(worshipNote MyNote)와 말씀 묵상(wordView QtTab)이 쓴다 — 두 화면의 초안 규칙은 이 한 벌이다.
//
//   key    초안 열쇠(noteTemplate.noteDraftKey — 사용자별 · 노트 한 건마다 하나 · §6-24-d)
//   draft  undefined — 아직 아무것도 하지 않는다(서버 값을 기다리는 중)
//          null      — 저장된 글과 같다: 남은 초안을 지운다(되살릴 것이 없는 초안이 자리만 차지하지 않게)
//          { …칸 }   — 고치는 중인 글: NOTE_DRAFT_DELAY 뒤에 `{ …칸, at }`으로 남긴다
//
// **기다리는 동안 떠나면 그 자리에서 남긴다**(2026-09-25 감사 5) — 쓰고 1.2초 안에 목록으로 나가거나
// 다른 노트를 열면 타이머만 치워지고 마지막 글이 사라졌다. 아직 못 남긴 글을 들고 있다가 이 열쇠를
// 떠날 때(열쇠가 바뀜 · 화면을 떠남) 바로 쓴다.
//
// 값이 바뀌었는지는 칸들의 글자로 본다 — 부르는 쪽이 렌더마다 새 객체를 넘겨도 타이머가 다시 걸리지 않는다.
export function useNoteDraft(key, draft) {
  const pending = useRef(null);
  const sig = draft === undefined ? undefined : (draft === null ? null : JSON.stringify(draft));
  useEffect(() => {
    if (sig === undefined) return undefined;
    if (sig === null) { pending.current = null; dropCache(key); return undefined; }
    const value = { ...JSON.parse(sig), at: Date.now() };
    pending.current = { key, value };
    const t = setTimeout(() => { writeCache(key, value); pending.current = null; }, NOTE_DRAFT_DELAY);
    return () => clearTimeout(t);
  }, [key, sig]);
  useEffect(() => () => {
    const p = pending.current;
    if (p && p.key === key) { writeCache(p.key, p.value); pending.current = null; }
  }, [key]);
}
