import React, { useState, useEffect } from 'react';
import {
  CheckSquare, Clock, X, User, Hash, Database, Download, Upload,
  Wand2, Sparkles, Bot
} from 'lucide-react';
import { CONFIG } from '../config.js';
import { formatDate } from '../utils.js';
import { useStore } from '../store/workspaceStore.js';
import { selectCurrentUser } from '../store/selectors.js';
import { AiService } from '../services/ai.js';
import { RichText } from '../components/RichText.jsx';

// ============================================================================
// 13. Modals (완벽한 SRP 분리)
// ============================================================================
export function TaskModalShell({ task, isEditMode, onClose, onEdit, onSave, onAddComment }) {
  const currentUser = useStore(selectCurrentUser);
  const [formData, setFormData] = useState(task);
  const [activeTab, setActiveTab] = useState('comments');

  // Stale State 방지: 모달 재사용 시 데이터 강제 동기화
  useEffect(() => { setFormData(task); }, [task]);

  const handleSubmit = (e) => { e.preventDefault(); onSave(formData); };

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-2 md:p-4 animate-in fade-in duration-200">
      <div className="bg-surface rounded-lg shadow-elevated border border-line w-full max-w-5xl h-[95vh] md:h-[85vh] flex flex-col md:flex-row overflow-hidden animate-in fade-in zoom-in-95 duration-200">
        <div className="flex-1 flex flex-col border-r-0 md:border-r border-line overflow-y-auto">
          <div className="sticky top-0 bg-surface/95 backdrop-blur z-10 px-4 py-3 border-b border-line flex justify-between items-center">
            <div className="flex items-center gap-2 text-xs font-semibold text-fg-muted"><CheckSquare size={14} className="text-accent"/> {task.id ? '작업 세부 정보' : '새 작업 만들기'}</div>
            <button onClick={onClose} className="p-1 hover:bg-surface-hover rounded-full text-fg-faint"><X size={18}/></button>
          </div>
          <div className="p-5 md:p-8 flex-1">
            {isEditMode ? <TaskEditor formData={formData} setFormData={setFormData} /> : <TaskViewer formData={formData} />}
          </div>
          <div className="sticky bottom-0 border-t border-line p-3 md:p-4 flex justify-between items-center z-10 bg-surface-2/80 backdrop-blur">
            <div className="text-[10px] text-fg-faint hidden sm:block">작성: {formData.author} • 최근: {formatDate(formData.updatedAt)}</div>
            <div className="flex gap-2 w-full sm:w-auto">
              <button onClick={onClose} className="flex-1 sm:flex-none px-4 py-2 text-xs font-medium text-fg-muted bg-surface-hover hover:bg-line rounded-md transition active:scale-95">닫기</button>
              {isEditMode ? <button type="button" onClick={handleSubmit} className="flex-1 sm:flex-none bg-accent hover:bg-accent-strong text-white px-6 py-2 rounded-md text-xs font-medium transition active:scale-95">저장</button>
                          : <button type="button" onClick={onEdit} className="flex-1 sm:flex-none bg-surface-hover hover:bg-line text-fg border border-line px-6 py-2 rounded-md text-xs font-medium transition active:scale-95">수정</button>}
            </div>
          </div>
        </div>
        {!isEditMode && task.id && (
          <div className="w-full md:w-80 h-[40vh] md:h-auto bg-surface-2 flex flex-col border-t md:border-t-0 md:border-l border-line shrink-0">
            <div className="flex border-b border-line bg-surface shrink-0">
              <button onClick={() => setActiveTab('comments')} className={`flex-1 py-3 text-xs font-semibold transition-colors ${activeTab === 'comments' ? 'border-b-2 border-accent text-accent-text' : 'text-fg-muted hover:bg-surface-hover'}`}>댓글 ({(formData.comments || []).length})</button>
              <button onClick={() => setActiveTab('activity')} className={`flex-1 py-3 text-xs font-semibold transition-colors ${activeTab === 'activity' ? 'border-b-2 border-accent text-accent-text' : 'text-fg-muted hover:bg-surface-hover'}`}>활동 기록</button>
            </div>
            <div className="flex-1 overflow-y-auto p-4">{activeTab === 'comments' ? <CommentPanel comments={formData.comments} /> : <ActivityPanel logs={formData.activityLog} />}</div>
            {activeTab === 'comments' && <CommentInput onAdd={onAddComment} />}
          </div>
        )}
      </div>
    </div>
  );
}

// 노션 속성 행: 좌측 라벨 + 우측 값 레이아웃
const PropertyRow = ({ icon, label, children }) => (
  <div className="flex flex-col sm:flex-row sm:items-center gap-1.5 sm:gap-0 py-1.5">
    <div className="w-28 shrink-0 flex items-center gap-1.5 text-xs text-fg-muted">{icon}{label}</div>
    <div className="flex-1 min-w-0">{children}</div>
  </div>
);

const TaskEditor = React.memo(({ formData, setFormData }) => {
  const [isAiLoading, setIsAiLoading] = useState(false);

  const handleChange = (e) => setFormData(prev => ({ ...prev, [e.target.name]: e.target.value }));
  const toggleTeam = (team) => setFormData(prev => ({ ...prev, teams: (prev.teams || []).includes(team) ? prev.teams.filter(t => t !== team) : [...(prev.teams || []), team] }));
  const handleAssignees = (e) => setFormData(prev => ({ ...prev, assignees: e.target.value.split(',').map(s => s.trim()).filter(Boolean) }));

  const handleAiPolish = async () => {
    if (!formData.content) return;
    setIsAiLoading(true);
    const polished = await AiService.polishText(formData.content);
    if (polished) setFormData(prev => ({ ...prev, content: polished }));
    setIsAiLoading(false);
  };

  return (
    <form className="space-y-4">
      <input type="text" name="title" value={formData.title || ''} onChange={handleChange} placeholder="작업 제목 입력" className="w-full text-2xl font-bold tracking-[-0.25px] text-fg placeholder:text-fg-faint bg-transparent border-none outline-none focus:ring-0 p-0" required autoFocus />

      <div className="py-3 border-y border-line divide-y divide-line/60">
        <PropertyRow icon={<CheckSquare size={13} className="text-fg-faint" />} label="상태">
          <div className="flex flex-wrap gap-1.5">
            {CONFIG.STATUSES.map(s => (
              <button key={s} type="button" onClick={() => setFormData(prev => ({ ...prev, status: s }))}
                className={`px-2.5 py-1 rounded-full text-[11px] font-semibold border transition-all active:scale-95 ${(formData.status || '시작 전') === s ? CONFIG.STATUS_STYLES[s] + ' border-transparent shadow-soft' : 'bg-surface text-fg-muted border-line hover:bg-surface-hover'}`}>
                {s}
              </button>
            ))}
          </div>
        </PropertyRow>
        <PropertyRow icon={<Clock size={13} className="text-fg-faint" />} label="마감일">
          <input type="date" name="dueDate" value={formData.dueDate || ''} onChange={handleChange} className="w-full sm:w-44 border border-line rounded-xs text-xs bg-surface text-fg px-2 py-1.5 focus:border-accent focus:shadow-soft outline-none transition-all" />
        </PropertyRow>
        <PropertyRow icon={<Hash size={13} className="text-fg-faint" />} label="담당 팀">
          <div className="flex flex-wrap gap-1.5">
            {Object.entries(CONFIG.TEAMS).map(([team, colorClass]) => {
              const selected = (formData.teams || []).includes(team);
              return (
                <button key={team} type="button" onClick={() => toggleTeam(team)}
                  className={`px-2.5 py-1 rounded-full text-[11px] font-semibold border transition-all active:scale-95 ${selected ? colorClass + ' border-transparent shadow-soft' : 'bg-surface text-fg-muted border-line hover:bg-surface-hover'}`}>
                  {team}
                </button>
              );
            })}
          </div>
        </PropertyRow>
        <PropertyRow icon={<User size={13} className="text-fg-faint" />} label="담당자">
          <input type="text" value={(formData.assignees || []).join(', ')} onChange={handleAssignees} placeholder="이름을 쉼표로 구분해 입력" className="w-full border border-line rounded-xs text-xs bg-surface text-fg placeholder:text-fg-faint px-2 py-1.5 focus:border-accent focus:shadow-soft outline-none transition-all" />
        </PropertyRow>
      </div>

      <div>
        <div className="flex justify-between items-center mb-1.5">
          <label className="block text-xs text-fg-muted">상세 내용</label>
          <button type="button" onClick={handleAiPolish} disabled={isAiLoading || !formData.content} className="flex items-center gap-1 px-2 py-1 bg-tag-purple text-tag-purple-fg hover:opacity-80 rounded-full text-[10px] font-bold transition active:scale-95 disabled:opacity-40">
            {isAiLoading ? <span className="animate-pulse">다듬는 중...</span> : <><Wand2 size={12} /> AI 문맥 다듬기</>}
          </button>
        </div>
        <textarea name="content" value={formData.content || ''} onChange={handleChange} placeholder="내용을 입력하세요. @이름 멘션, 이미지·링크 URL도 붙여넣을 수 있어요." className="w-full h-32 md:h-48 border border-line rounded-md p-3 text-xs leading-relaxed bg-surface text-fg placeholder:text-fg-faint resize-none focus:border-accent focus:shadow-soft outline-none transition-all"></textarea>
      </div>
    </form>
  );
});

const TaskViewer = React.memo(({ formData }) => {
  const [summary, setSummary] = useState('');
  const [isAiLoading, setIsAiLoading] = useState(false);

  const handleSummarize = async () => {
    setIsAiLoading(true);
    const result = await AiService.summarizeTask(formData);
    setSummary(result);
    setIsAiLoading(false);
  };

  return (
    <div className="space-y-4 md:space-y-5">
      <div className="flex flex-wrap items-center gap-1.5 mb-1"><span className={`px-2.5 py-1 rounded-full text-[10px] font-semibold ${CONFIG.STATUS_STYLES[formData.status]}`}>{formData.status}</span>{formData.teams?.map(t => <span key={t} className={`px-2.5 py-1 rounded-full text-[10px] font-semibold ${CONFIG.TEAMS[t]}`}>{t}</span>)}</div>
      <h2 className="text-xl md:text-2xl font-bold text-fg leading-tight tracking-[-0.25px]">{formData.title}</h2>
      <div className="py-2 border-y border-line divide-y divide-line/60 text-xs">
        <div className="flex items-center gap-0 py-1.5"><span className="w-28 shrink-0 flex items-center gap-1.5 text-fg-muted"><User size={13} className="text-fg-faint" />담당</span><span className="font-medium text-fg">{formData.assignees?.join(', ') || '미지정'}</span></div>
        {formData.dueDate && <div className="flex items-center gap-0 py-1.5"><span className="w-28 shrink-0 flex items-center gap-1.5 text-fg-muted"><Clock size={13} className="text-fg-faint" />마감일</span><span className="inline-flex items-center gap-1 font-semibold text-tag-orange-fg bg-tag-orange px-2 py-0.5 rounded-sm">{new Date(formData.dueDate).toLocaleDateString('ko-KR')}</span></div>}
      </div>

      {/* AI 요약 섹션 (보라 = 장식 전용 스티커 팔레트) */}
      {(summary || isAiLoading) && (
        <div className="bg-tag-purple/40 border border-line rounded-lg p-3 relative mt-4 animate-in fade-in duration-200">
          <div className="text-[10px] font-bold text-tag-purple-fg mb-1 flex items-center gap-1"><Sparkles size={12}/> AI 3줄 요약</div>
          {isAiLoading ? <div className="text-xs text-tag-purple-fg/70 animate-pulse">업무 내용과 댓글을 분석하고 있습니다...</div> : <div className="text-xs text-fg-secondary whitespace-pre-wrap"><RichText content={summary} /></div>}
        </div>
      )}

      <div className="prose prose-sm max-w-none mt-4 bg-surface-2/50 p-4 rounded-lg border border-line min-h-[150px] relative group">
        {!summary && (
           <button onClick={handleSummarize} disabled={isAiLoading} className="absolute top-3 right-3 bg-surface border border-line text-fg-muted hover:text-tag-purple-fg px-2 py-1 rounded-full shadow-soft text-[10px] font-bold flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-all active:scale-95 z-10">
             <Sparkles size={12}/> 3줄 요약
           </button>
        )}
        <RichText content={formData.content} />
      </div>
    </div>
  );
});

// 노션 스타일 플랫 댓글: 아바타 + 이름·시간 + 본문, 카드 대신 헤어라인 구분
const CommentPanel = React.memo(({ comments }) => (
  <div className="divide-y divide-line/60">
    {(comments || []).map(c => (
      <div key={c.id} className="flex items-start gap-2.5 py-3 first:pt-0 animate-in fade-in duration-200">
        <div className="w-6 h-6 rounded-full bg-accent-weak text-accent-text text-[10px] font-bold flex items-center justify-center shrink-0 mt-0.5">{c.author?.[0]}</div>
        <div className="flex-1 min-w-0">
          <div className="flex items-baseline gap-2 mb-0.5"><span className="font-semibold text-[11px] text-fg">{c.author}</span><span className="text-[9px] text-fg-faint">{formatDate(c.timestamp)}</span></div>
          <div className="text-xs text-fg-secondary leading-relaxed"><RichText content={c.text} /></div>
        </div>
      </div>
    ))}
    {(!comments || comments.length === 0) && <div className="text-center text-xs text-fg-faint mt-6">첫 댓글을 남겨보세요!</div>}
  </div>
));

const ActivityPanel = React.memo(({ logs }) => (
  <div className="space-y-4 relative before:absolute before:inset-y-1 before:left-[3px] before:w-px before:bg-line">
    {(logs || []).slice().reverse().map(l => (
      <div key={l.id} className="relative flex items-start gap-3">
        <div className="mt-1 w-[7px] h-[7px] rounded-full bg-fg-faint ring-4 ring-surface-2 z-10 shrink-0"></div>
        <div className="min-w-0">
          <p className="text-[11px] text-fg-secondary leading-snug"><span className="font-semibold text-fg">{l.author}</span>님이 {l.action}</p>
          <p className="text-[9px] text-fg-faint mt-0.5">{formatDate(l.timestamp)}</p>
        </div>
      </div>
    ))}
    {(!logs || logs.length === 0) && <div className="text-center text-xs text-fg-faint mt-6">아직 활동 기록이 없어요.</div>}
  </div>
));

const CommentInput = ({ onAdd }) => {
  const [val, setVal] = useState('');
  const [isAiLoading, setIsAiLoading] = useState(false);

  const handleAiSuggest = async () => {
    if (!val.trim()) return;
    setIsAiLoading(true);
    const friendlyText = await AiService.friendlyComment(val);
    if (friendlyText) setVal(friendlyText);
    setIsAiLoading(false);
  };

  return (
    <div className="p-3 bg-surface border-t border-line shrink-0 relative">
      {isAiLoading && <div className="absolute inset-0 bg-surface/70 backdrop-blur-[1px] flex items-center justify-center z-10 text-xs font-bold text-tag-purple-fg animate-pulse">댓글 다듬는 중...</div>}
      <textarea value={val} onChange={e => setVal(e.target.value)} placeholder="@이름 으로 멘션..." className="w-full text-xs border border-line rounded-xs p-2 focus:ring-2 focus:ring-accent outline-none resize-none h-14 bg-surface text-fg placeholder:text-fg-faint" onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); if (val.trim()) { onAdd(val); setVal(''); } } }} />
      <div className="flex justify-between mt-2 items-center">
        <button onClick={handleAiSuggest} disabled={!val.trim() || isAiLoading} className="text-tag-purple-fg hover:bg-tag-purple disabled:opacity-50 disabled:hover:bg-transparent px-2 py-1.5 rounded-full text-[10px] font-bold flex items-center gap-1 transition active:scale-95" title="부드러운 어조로 자동 수정">
          <Bot size={14}/> AI 둥글게 둥글게
        </button>
        <button onClick={() => { if (val.trim()) { onAdd(val); setVal(''); } }} disabled={!val.trim()} className="bg-accent hover:bg-accent-strong disabled:bg-line text-white px-3 py-1.5 rounded-md text-[10px] font-bold transition active:scale-95">등록</button>
      </div>
    </div>
  );
};

export function ProfileModal({ onClose, onSave }) {
  const user = useStore(selectCurrentUser);
  const [name, setName] = useState(user.name);
  const [team, setTeam] = useState(user.team);
  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4 animate-in fade-in duration-200"><div className="bg-surface p-5 md:p-6 rounded-lg shadow-elevated border border-line w-full max-w-sm animate-in fade-in zoom-in-95 duration-200"><h3 className="font-bold text-fg mb-1 tracking-[-0.25px]">프로필 설정</h3><p className="text-xs text-fg-muted mb-4">워크스페이스에 표시될 이름(닉네임)과 소속 팀이에요. 언제든 여기서 바꿀 수 있어요.</p><label className="block text-xs font-semibold text-fg-muted mb-1.5">이름</label><input type="text" value={name} onChange={e=>setName(e.target.value)} className="w-full border border-line rounded-xs p-2 mb-4 text-sm bg-surface text-fg focus:ring-2 focus:ring-accent outline-none" /><label className="block text-xs font-semibold text-fg-muted mb-1.5">소속 팀</label><select value={team} onChange={e=>setTeam(e.target.value)} className="w-full border border-line rounded-xs p-2 mb-6 text-sm bg-surface text-fg focus:ring-2 focus:ring-accent outline-none">{Object.keys(CONFIG.TEAMS).map(t=><option key={t}>{t}</option>)}</select><div className="flex gap-2"><button onClick={onClose} className="flex-1 bg-surface-hover hover:bg-line text-fg-muted py-2.5 rounded-md text-sm font-medium transition active:scale-95">취소</button><button onClick={()=>{onSave({name, team}); onClose();}} className="flex-1 bg-accent hover:bg-accent-strong text-white py-2.5 rounded-md text-sm font-medium transition active:scale-95">저장</button></div></div></div>
  );
}

export function SyncModal({ onClose, persistence }) {
  const [url, setUrl] = useState(() => localStorage.getItem('church_app_sync_url') || '');
  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4 animate-in fade-in duration-200"><div className="bg-surface p-5 rounded-lg shadow-elevated border border-line w-full max-w-md animate-in fade-in zoom-in-95 duration-200"><div className="flex justify-between items-center mb-4"><h3 className="font-bold text-fg flex items-center gap-2"><Database size={16} className="text-accent"/> 데이터 연동</h3><button onClick={onClose} className="text-fg-faint"><X size={18}/></button></div><div className="bg-accent-weak text-accent-text p-3 rounded-md text-xs leading-relaxed mb-4">구글 Apps Script URL을 입력하여 데이터를 동기화합니다.</div><input type="text" value={url} onChange={e=>{setUrl(e.target.value); localStorage.setItem('church_app_sync_url',e.target.value);}} placeholder="https://script.google.com/..." className="w-full border border-line rounded-xs p-2 mb-4 text-xs bg-surface text-fg placeholder:text-fg-faint focus:ring-2 focus:ring-accent outline-none" /><div className="flex gap-2"><button onClick={()=>persistence.loadFromCloud(url)} disabled={!url || persistence.syncStatus === 'syncing'} className="flex-1 bg-surface-hover hover:bg-line text-fg border border-line py-2 rounded-md text-xs font-medium flex justify-center items-center gap-1 transition active:scale-95"><Download size={14}/> 불러오기</button><button onClick={()=>persistence.syncToCloud(url)} disabled={!url || persistence.syncStatus === 'syncing'} className="flex-1 bg-accent hover:bg-accent-strong text-white py-2 rounded-md text-xs font-medium flex justify-center items-center gap-1 transition active:scale-95"><Upload size={14}/> 덮어쓰기</button></div><p className="text-center text-xs font-bold mt-3 h-4 text-accent-text">{persistence.syncStatus === 'syncing' ? '진행 중...' : persistence.syncStatus === 'success' ? '성공!' : <span className="text-red-500">{persistence.errorMsg}</span>}</p></div></div>
  );
}

export function ProjectModal({ onClose, onSave }) {
  const [title, setTitle] = useState('');
  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4 animate-in fade-in duration-200">
      <div className="bg-surface p-5 md:p-6 rounded-lg shadow-elevated border border-line w-full max-w-sm animate-in fade-in zoom-in-95 duration-200">
        <h3 className="font-bold text-fg mb-4 flex items-center gap-2"><Hash size={18} className="text-accent"/> 새 프로젝트 생성</h3>
        <label className="block text-xs font-semibold text-fg-muted mb-1.5">프로젝트 이름</label>
        <input
          type="text" value={title} onChange={e => setTitle(e.target.value)}
          placeholder="예: 2026 하반기 노방전도"
          className="w-full border border-line p-2.5 rounded-xs mb-6 text-sm bg-surface text-fg placeholder:text-fg-faint focus:ring-2 focus:ring-accent outline-none"
          autoFocus
          onKeyDown={e => { if (e.key === 'Enter' && title.trim()) { onSave(title.trim()); } }}
        />
        <div className="flex gap-2">
          <button onClick={onClose} className="flex-1 bg-surface-hover hover:bg-line text-fg-muted py-2.5 rounded-md text-sm font-medium transition active:scale-95">취소</button>
          <button onClick={() => { if(title.trim()) onSave(title.trim()); }} disabled={!title.trim()} className="flex-1 bg-accent hover:bg-accent-strong disabled:bg-line text-white py-2.5 rounded-md text-sm font-medium transition active:scale-95">생성하기</button>
        </div>
      </div>
    </div>
  );
}
