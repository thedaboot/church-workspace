import React, { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { GalleryHorizontalEnd } from 'lucide-react';
import './index.css';
import { ServiceStory } from './components/worshipStory.jsx';
import { ServiceSheetOne, ServiceSheetTwo, paperDate } from './components/paper.jsx';
import { BTN } from './components/buttons.js';
import { loadPassage } from './services/bible.js';
import { churchSeason } from './services/churchYear.js';
import { kindLabel, PRAISE_TEAM, PUBLIC_MISSING as MISSING } from './services/serviceView.js';

// ============================================================================
// 주보 공개 보기 — 로그인 없이 여는 페이지 (사용자 결정 2026-09-26)
// ----------------------------------------------------------------------------
// 입구는 `service-view.html`이고, 서버(api/service-view.js)가 서명을 확인한 뒤 **필요한 칸만** 골라
// `<script type="application/json" id="service-data">`로 끼워 보낸다(serviceView.publicService가 그 목록의
// 정본 · 이름은 서버가 명단 본명 + 호칭으로 이미 풀었다). **이 페이지는 Supabase에 붙지 않는다** —
// supabase 클라이언트를 import하는 모듈(worship.js·people.js·groupsParts…)을 부르지 않는다
// (tests/logcheck가 import 줄을 따라가며 본다). 본문 말씀은 정적 파일(`/bible/*.json`)에서 받는다.
//
// 화면은 **넘기면서 보기와 같은 부품**(components/worshipStory.jsx) 그대로다 — 닫을 곳이 없어 X·Esc는
// 없고, 마지막 장의 `주보 전체 보기`는 **종이 보기**(앱의 주보 탭과 같은 두 쪽 · components/paper.jsx)로
// 간다. 종이 위의 `넘기면서 보기`로 돌아온다. 수정·다른 주보·앱 안으로 가는 링크는 없다.
// 폰 기준이고 데스크톱에서는 가운데 세로 판(30rem)이다.
// ============================================================================

function readData() {
  try {
    const el = document.getElementById('service-data');
    const data = el ? JSON.parse(el.textContent || 'null') : null;
    return data && data.id ? data : null;
  } catch { return null; }
}

// 데이터가 없다(서명이 틀렸거나 발행 전 — 서버는 404 페이지를 따로 내지만, 껍데기를 직접 연 경우) · 문구는 서버 404와 같다
function NotFound() {
  return (
    <main className="min-h-dvh grid place-items-center p-6 bg-canvas text-fg">
      <p className="service-view-missing text-[14px] font-semibold text-fg-muted">{MISSING}</p>
    </main>
  );
}

const nameAsIs = (name) => String(name || '');

function PaperView({ service, verses, onStory }) {
  const date = paperDate(service.service_date);
  const kind = kindLabel(service.kind);
  const season = useMemo(() => churchSeason(service.service_date), [service.service_date]);
  useEffect(() => { window.scrollTo(0, 0); }, []);
  return (
    <main className="service-view-paper min-h-dvh bg-canvas text-fg px-4 pt-4 pb-10">
      <div className="paper-box w-full max-w-[560px] mx-auto">
        <div className="flex items-center gap-1.5 mb-3">
          <button type="button" onClick={onStory} className={`service-view-story inline-flex items-center gap-1.5 ${BTN}`}>
            <GalleryHorizontalEnd size={13} />
            <span>넘기면서 보기</span>
          </button>
        </div>
        <div className="flex flex-col gap-4">
          <div className="rounded-lg overflow-hidden border border-line">
            <ServiceSheetOne date={date} kind={kind} title={service.title} season={season}
              refStr={service.passage_ref} preacher={service.preacher} verses={verses} />
          </div>
          <div className="rounded-lg overflow-hidden border border-line">
            <ServiceSheetTwo date={date} kind={kind} team={PRAISE_TEAM} season={season}
              leader={service.praise_leader} songs={service.songs} roles={service.roles}
              notices={service.notices} nameOf={nameAsIs} />
          </div>
        </div>
      </div>
    </main>
  );
}

function ServiceViewApp() {
  const data = useMemo(readData, []);
  const [verses, setVerses] = useState(null);
  const [mode, setMode] = useState('story');

  useEffect(() => {
    if (!data) return undefined;
    let alive = true;
    if (!data.passage_ref) { setVerses([]); return undefined; }
    loadPassage(data.passage_ref)
      .then(p => { if (alive) setVerses(p?.verses?.length ? p.verses : []); })
      .catch(() => { if (alive) setVerses([]); });
    return () => { alive = false; };
  }, [data]);

  if (!data) return <NotFound />;
  // 본문이 오기 전에는 장을 나눌 재료가 없다(앱에서도 그동안 버튼이 잠긴다) — 빈 바탕만
  if (verses === null) return <main className="service-view-wait min-h-dvh bg-canvas" aria-busy="true" />;
  if (mode === 'paper') return <PaperView service={data} verses={verses} onStory={() => setMode('story')} />;
  return (
    <ServiceStory service={data} verses={verses} nameOf={nameAsIs} realName={null} cover={data.cover}
      closable={false} onAll={() => setMode('paper')}
      rootClassName="md:left-1/2 md:right-auto md:w-[30rem] md:-translate-x-1/2" />
  );
}

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ServiceViewApp />
  </React.StrictMode>,
);
