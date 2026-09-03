// ============================================================================
// 실패 문구 한 곳 — notifyText.js와 같은 성격의 모듈입니다.
// ----------------------------------------------------------------------------
// 화면에는 **무엇이 안 됐고 무엇을 하면 되는지**만 내보냅니다. 원문(Postgres 코드·
// 영어 메시지)은 부르는 쪽이 console.error로 남깁니다.
//
// 예전에는 토스트가 Supabase 에러를 그대로 붙여서 사용자 화면에
//   저장에 실패했어요 (업무 저장) · null value in column "title" of relation
//   "cards" violates not-null constraint · code 23502
// 가 떴습니다(사용자 지적). 쓰는 사람에게는 읽을 수 없는 글이고, 무엇을 고쳐야
// 다시 저장되는지도 알 수 없습니다.
//
// 문구 규칙(§8):
//   `무엇을 못했는지` / `무엇을 하면 되는지` 두 도막 — 문장이 바뀌면 줄을 바꾼다(2026-09-03).
//   앞도막은 부르는 쪽이 정하고(`업무를 저장하지 못했어요`), 뒷도막을 여기가 만듭니다.
//   판정어·번역투를 쓰지 않고, 사람이 할 수 있는 일이 있으면 그것을 말합니다.
//
// 순수 함수만 두어(브라우저 API 없음) `tests/logcheck.mjs`가 노드에서 바로 검사합니다.
// ============================================================================

// not-null 위반은 어느 칸이 비었는지가 유일하게 쓸모 있는 정보입니다.
// 여기 없는 칸은 일반 문구로 떨어집니다 — 영어 컬럼명을 그대로 보여주지 않습니다.
const COLUMN_KO = {
  title: '제목',
  name: '이름',
  content: '내용',
  url: '주소',
  due_date: '마감일',
  project_id: '프로젝트',
  card_id: '업무',
  status: '상태',
};

// 을/를 — 받침 있는 글자면 '을'. 한글 음절 영역에서 (코드-0xAC00) % 28 이 종성입니다.
export function objectParticle(word) {
  const last = String(word || '').slice(-1);
  const code = last.charCodeAt(0);
  if (!(code >= 0xac00 && code <= 0xd7a3)) return '를';
  return (code - 0xac00) % 28 ? '을' : '를';
}

const isOffline = () => typeof navigator !== 'undefined' && navigator.onLine === false;

// 에러 한 건 → 뒷도막 한 줄
export function errorReason(err) {
  if (!err) return '잠시 후 다시 시도해주세요';
  // 우리 서버(api/*)가 이미 사람이 읽을 이유를 한국어로 돌려준 경우에는 그것을 쓴다.
  // 예전에는 이걸 버리고 기본 문구('잠시 후 다시 시도해주세요')로 떨어졌다 —
  // 화면에 이유가 안 나오니 쓰는 사람도, 고치는 사람도 짐작만 하게 됐다
  // (드라이브 업로드가 실패하는데 원인을 알 길이 없었다).
  if (err.human) return String(err.human);
  const code = String(err.code ?? '');
  const msg = `${err.message ?? ''} ${err.details ?? ''} ${err.hint ?? ''}`.toLowerCase();
  const status = Number(err.status ?? err.statusCode ?? 0);

  // 인터넷이 끊긴 경우가 먼저입니다 — 이때는 어떤 코드든 원인이 하나입니다
  if (isOffline() || msg.includes('failed to fetch') || msg.includes('networkerror')
      || msg.includes('network request failed') || code === 'ERR_NETWORK') {
    return '인터넷 연결을 확인하고 다시 시도해주세요';
  }

  switch (code) {
    case '23502': {                                   // not-null 위반
      const m = /column "([^"]+)"/i.exec(err.message || '');
      const ko = m && COLUMN_KO[m[1]];
      return ko ? `${ko}${objectParticle(ko)} 먼저 적어주세요` : '아직 채우지 않은 칸이 있어요';
    }
    case '23505': return '이미 같은 것이 있어요';       // unique 위반
    case '23503': return '연결된 항목이 이미 지워졌어요\n새로고침해주세요'; // FK 위반
    case '23514':                                     // check 위반
    case '22P02': return '넣을 수 없는 값이 들어 있어요';
    case '22001': return '글자가 너무 길어요';
    case '42501': return '권한이 있어야 하는 일이에요'; // RLS·정책
    case 'PGRST301': return '로그인이 풀렸어요\n새로고침하고 다시 로그인해주세요';
    case 'PGRST116': return '이미 지워진 것 같아요\n새로고침해주세요';
    default: break;
  }

  // 코드가 없는 경우(스토리지·네트워크·인증)는 메시지와 상태로 가릅니다
  if (msg.includes('row-level security') || msg.includes('violates row-level')) return '권한이 있어야 하는 일이에요';
  if (msg.includes('jwt') || msg.includes('invalid token') || status === 401) return '로그인이 풀렸어요\n새로고침하고 다시 로그인해주세요';
  if (msg.includes('exceeded the maximum allowed size') || status === 413) return '파일이 너무 커요';
  if (status === 429) return '요청이 한꺼번에 몰렸어요\n잠시 후 다시 시도해주세요';
  if (status >= 500) return '서버가 잠시 불안정해요\n잠시 후 다시 시도해주세요';
  // **아는 게 없으면 원문이라도 보여준다.** 처음에는 Postgres 원문이 코드처럼 뜨는
  // 것이 문제였는데(그건 위에서 전부 사람 말로 바꿨다), 아는 코드가 하나도 없을 때
  // '잠시 후 다시 시도해주세요'만 남으면 **쓰는 사람도 고치는 사람도 원인을 영영
  // 못 본다.** 실제로 첨부가 안 올라가는데 단서가 하나도 없었다(사용자 지적, 두 번).
  // 정보가 없는 것보다 낫다 — 다만 길면 잘라서 한 줄을 넘기지 않는다.
  const raw = String(err.message || '').trim();
  if (raw) return raw.length > 90 ? `${raw.slice(0, 90)}…` : raw;
  return '잠시 후 다시 시도해주세요';
}

// 토스트 한 줄. `what`은 이미 완결된 문장입니다 — '업무를 저장하지 못했어요'
// '무엇을 못 했는지'와 '왜'는 **언제나 줄을 바꿔** 잇는다(사용자 결정 2026-09-03 — 마침표도
// ' · '도 아니다). 토스트가 whitespace-pre-line이라 줄바꿈이 그대로 그려진다.
export function failText(what, err) {
  return `${what}\n${errorReason(err)}`;
}
