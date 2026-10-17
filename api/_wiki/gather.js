import { kstDate } from '../../src/services/wikiCore.js';
import { TEAM_ORDER, AUDIENCE } from './const.js';
import { rosterOf } from './people.js';
import { readAll } from '../_lib.js';
import { FACT_COLS } from './learn.js';
import { dropLeaderOnly, leaderCardIdsOf } from '../../src/services/visibility.js';
import { dropLocked } from '../../src/services/cardLock.js';
import { dropTrashed } from '../../src/services/trashItems.js';
import { trashedIds } from '../_trash.js';

// ── 원본 읽기 (서버 키 — 모두가 읽는 위키라 RLS로 갈리는 것은 넣지 않는다) ───────────────
// 리더만 보는 프로젝트(0092)도 그런 것이다 — 그 프로젝트·업무·댓글·첨부를 읽은 자리에서 걷는다(visibility.dropLeaderOnly).
// 걷은 뒤의 값만 돌려주므로 장 뼈대·쓰기·src_hash가 리더 프로젝트를 모른다(바뀌면 그 장이 다시 모인다).
// leaderCards(걷은 업무 id)만은 따로 넘긴다 — 자주 묻는 질문 장이 그 기록에 기댄 다붓이 답을 싣지 않게(_wiki/faq.js · 20차 ⑥).
// 잠긴 업무(0099)도 같은 자리에서 걷는다(업무·댓글·첨부 — services/cardLock.dropLocked). 본문은 이미 비어 있지만(card_secrets로 옮겼다)
// 댓글·첨부가 남는다. 풀면 다음 빌드에 돌아온다. leaderCards에 **잠긴 업무 id도 더한다** — 자주 묻는 질문 장이 그 기록에 기댄 답도 싣지 않게.
// 휴지통(0104)은 맨 먼저 걷는다(trashItems.dropTrashed — 지운 프로젝트·업무와 그 댓글·첨부). 복원하면 다음 빌드에 돌아온다.
export async function gather(db, today = kstDate(new Date().toISOString())) {
  const must = (r, what) => { if (r.error) throw new Error(`${what}: ${r.error.message}`); return r.data || []; };
  const monthStart = `${today.slice(0, 7)}-01`;
  const [y, m] = today.split('-').map(Number);
  const nextEnd = new Date(Date.UTC(y, m + 1, 0)).toISOString().slice(0, 10);
  const [projectsRaw, cardsRaw, cardTeams, commentsRaw, filesRaw, services, guides, qt, groups, meetings, profiles, people, edits, pages, questions, facts, trashed] = await Promise.all([
    db.from('projects').select('id, name, year, archived, position, visibility').then(r => must(r, 'projects')),
    readAll(() => db.from('cards').select('id, project_id, title, description, status, start_date, due_date, depends_on, subtasks, updated_at, locked').order('id'), 'cards'),
    readAll(() => db.from('card_teams').select('card_id, teams(name)').order('card_id').order('team_id'), 'card_teams'),
    readAll(() => db.from('comments').select('id, card_id, parent_id, author_id, body, created_at').order('created_at').order('id'), 'comments'),
    readAll(() => db.from('files').select('id, card_id, service_id, kind, name, mime_type, created_at, view_pw').order('id'), 'files'),
    db.from('services').select('id, kind, service_date, title, passage_ref, songs, published_at').eq('status', 'published').order('service_date').then(r => must(r, 'services')),
    db.from('sun_guides').select('service_id, body').eq('pinned', true).then(r => must(r, 'sun_guides')),
    db.from('qt_schedule').select('qt_date, passage_ref, label').gte('qt_date', monthStart).lte('qt_date', nextEnd).order('qt_date').then(r => must(r, 'qt_schedule')),
    db.from('groups').select('id, type, name, year, note, position').is('removed_at', null).then(r => must(r, 'groups')),
    db.from('group_meetings').select('group_id, meeting_date, title').order('meeting_date').then(r => must(r, 'group_meetings')),
    db.from('profiles').select('id, display_name, approved, removed_at, merged_into').then(r => must(r, 'profiles')),
    db.from('people').select('name, profile_id, gender, is_pastor, removed_at').then(r => must(r, 'people')),
    readAll(() => db.from('wiki_edits').select('page_id, item_key, block_key, text, before, edited_by, edited_at').order('edited_at', { ascending: false }).order('page_id').order('item_key'), 'wiki_edits'),
    db.from('wiki_pages').select('id, kind, src_hash, blocks').then(r => must(r, 'wiki_pages')),
    readAll(() => db.from('dabooti_questions').select('id, question, norm, status, answer, feedback, via, created_at, resolved_at').gte('created_at', new Date(Date.now() - 90 * 864e5).toISOString()).order('created_at').order('id'), 'dabooti_questions'),
    // 다붓이가 배운 것(0098 · 20차 ⑧) — 그 장을 같이 다시 쓴다(_wiki/learn.js learnedPage) · 버린 말은 안 읽는다
    readAll(() => db.from('dabooti_facts').select(FACT_COLS).in('status', ['pending', 'approved']).order('created_at').order('id'), 'dabooti_facts'),
    trashedIds(db),
  ]);
  const { projects: projectsAll, cards: cardsAll, comments: commentsAll, files: filesAll } =
    dropTrashed({ projects: projectsRaw, cards: cardsRaw, comments: commentsRaw, files: filesRaw }, trashed);
  const kept = dropLeaderOnly({ projects: projectsAll, cards: cardsAll, comments: commentsAll, files: filesAll });
  const open = dropLocked(kept);
  // 돌려주는 업무 모양은 예전 그대로(locked 칸 없이) — 뒤쪽이 행을 통째로 다뤄도 장이 칸 하나 때문에 다시 모이지 않게
  const cards = open.cards.map(({ locked: _l, ...c }) => c);
  const { comments, files } = open;
  // 돌려주는 프로젝트 모양은 예전 그대로(visibility 칸 없이) — 뒤쪽이 행을 통째로 다뤄도 장이 괜히 다시 모이지 않게
  const projects = kept.projects.map(({ visibility: _v, ...p }) => p);
  const teamsOf = Map.groupBy(cardTeams.filter(ct => ct.teams?.name), ct => ct.card_id);
  for (const c of cards) {
    const all = (teamsOf.get(c.id) || []).map(ct => ct.teams.name);
    c.audience = all.filter(t => AUDIENCE.has(t));
    c.teams = all.filter(t => !AUDIENCE.has(t)).sort((a, b) => TEAM_ORDER.indexOf(a) - TEAM_ORDER.indexOf(b));
  }
  const names = [...profiles.map(p => p.display_name), ...people.map(p => p.name)].filter(Boolean);
  const roster = rosterOf(profiles, people);
  const leaderCards = new Set([...leaderCardIdsOf({ projects: projectsAll, cards: cardsAll }), ...open.locked]);
  return { today, projects, cards, comments, files, services, guides, qt, groups, meetings, names, roster, profiles, edits, pages, questions, leaderCards, facts };
}
