import { kstDate } from '../../src/services/wikiCore.js';
import { TEAM_ORDER, AUDIENCE } from './const.js';
import { rosterOf } from './people.js';
import { readAll } from '../_lib.js';

// ── 원본 읽기 (서버 키 — 모두가 읽는 위키라 RLS로 갈리는 것은 넣지 않는다) ───────────────
export async function gather(db, today = kstDate(new Date().toISOString())) {
  const must = (r, what) => { if (r.error) throw new Error(`${what}: ${r.error.message}`); return r.data || []; };
  const monthStart = `${today.slice(0, 7)}-01`;
  const [y, m] = today.split('-').map(Number);
  const nextEnd = new Date(Date.UTC(y, m + 1, 0)).toISOString().slice(0, 10);
  const [projects, cards, cardTeams, comments, files, services, guides, qt, groups, meetings, profiles, people, edits, pages, questions] = await Promise.all([
    db.from('projects').select('id, name, year, archived, position').then(r => must(r, 'projects')),
    readAll(() => db.from('cards').select('id, project_id, title, description, status, start_date, due_date, depends_on, subtasks, updated_at').order('id'), 'cards'),
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
    readAll(() => db.from('dabooti_questions').select('id, question, norm, status, answer, feedback, via, created_at').gte('created_at', new Date(Date.now() - 90 * 864e5).toISOString()).order('created_at').order('id'), 'dabooti_questions'),
  ]);
  const teamsOf = Map.groupBy(cardTeams.filter(ct => ct.teams?.name), ct => ct.card_id);
  for (const c of cards) {
    const all = (teamsOf.get(c.id) || []).map(ct => ct.teams.name);
    c.audience = all.filter(t => AUDIENCE.has(t));
    c.teams = all.filter(t => !AUDIENCE.has(t)).sort((a, b) => TEAM_ORDER.indexOf(a) - TEAM_ORDER.indexOf(b));
  }
  const names = [...profiles.map(p => p.display_name), ...people.map(p => p.name)].filter(Boolean);
  const roster = rosterOf(profiles, people);
  return { today, projects, cards, comments, files, services, guides, qt, groups, meetings, names, roster, profiles, edits, pages, questions };
}
