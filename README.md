# ⛪ 교회 청년부 워크스페이스 (Church Workspace)

교회 청년부, 임원진, 각 사역 팀을 위한 서버리스(Serverless) 기반의 무료 온라인 협업 툴입니다. 노션(Notion)과 슬랙(Slack)의 핵심 기능을 차용하여, 예산 부담 없이 자체적인 업무 플로우를 구축하기 위해 개발되었습니다.

## ✨ 주요 기능 (Features)

- **팀별/프로젝트별 칸반 보드**: 업무 상태(시작 전, 진행 중, 완료) 드래그 앤 드롭 지원 — 드래그 중인 카드·놓을 컬럼·드롭 존이 시각적으로 표시되고, 카드를 화면 가장자리로 끌면 컬럼이 자동으로 가로 스크롤됩니다. 놓으면 카드가 부드럽게 자리 잡아요. 팀 필터는 여러 개를 동시에 선택할 수 있어요(OR 조건).
- **프로젝트 캘린더**: 보드/캘린더 뷰를 전환하며 마감일이 걸린 업무를 달력에서 확인합니다. ‹ › 버튼으로 올해부터 2030년까지 월 단위로 이동하고, '오늘' 버튼으로 즉시 이번 달로 돌아올 수 있어요. 마감일은 노션 톤의 커스텀 데이트피커로 요일까지 함께 표시·선택합니다.
- **프로젝트 리소스 링크**: 기획안·시트 같은 외부 링크를 프로젝트 상단에 고정(핀)해두고, 추가·삭제할 수 있습니다.
- **마스터 대시보드**: 전체 프로젝트 진척도 및 팀별 남은 업무 통계 시각화
- **실시간 소통 & 멘션**: 업무별 댓글 피드 및 @이름 멘션 기능
- **Time-Travel (Undo/Redo)**: 자체 구현한 상태 관리를 통한 실행 취소/다시 실행 기능 — 칸반에서 카드를 실수로 옮기거나 잘못 저장했을 때 헤더의 버튼으로 즉시 되돌립니다.
- **프로필(닉네임·팀)**: 사이드바 하단에서 표시 이름과 소속 팀을 설정합니다. 로그인 사용 시 첫 로그인 직후 설정 창이 자동으로 열려요.
- **서버리스 클라우드 동기화**: 구글 Apps Script를 활용하여 관리자의 구글 드라이브를 자체 DB로 활용
- **Gemini AI 통합**: 업무 내용 3줄 요약, 문맥 다듬기, 부드러운 댓글 톤앤매너 교정 기능

## 🛠️ 기술 스택 (Tech Stack)

- **빌드**: Vite 8
- **UI**: React 19
- **스타일링**: Tailwind CSS 4 + [SEED Design](https://seed-design.io/) (파운데이션 토큰)
- **폰트**: Pretendard
- **아이콘**: lucide-react

## 🏗️ 아키텍처 (Architecture)

이 프로젝트는 복잡한 의존성을 줄이고 성능을 극대화하기 위해 다음과 같은 실무 아키텍처 패턴을 순수 React(순수 JS)로 직접 구현했습니다.

1. **상태 정규화 (Normalization) & O(1) 캐싱**: EntityAdapter 패턴을 적용하여 데이터를 `{ byId, allIds }` 형태로 정규화하고, useMemo를 통한 Map 룩업으로 성능을 최적화했습니다.
2. **Context 분리 및 Custom Store**: 불필요한 리렌더링을 막기 위해 Context를 도메인별로 세분화하고, useSyncExternalStore와 결합한 자체 Store 클래스를 구축했습니다.
3. **도메인 분할 (SRP)**: WorkspaceShell → Controller → Service → Persistence Layer(Repository)로 책임을 분리하여 유지보수성을 극대화했습니다.
4. **RichText 파서/렌더러 분리**: 텍스트에서 멘션, 이미지, 링크를 추출하는 Tokenizer와 Renderer를 분리했습니다.

### 폴더 구조

```
src/
├── App.jsx              # 조립(Composition) 진입점
├── main.jsx             # 렌더 부트스트랩
├── config.js            # 상수 · 환경 설정
├── utils.js             # 공용 유틸리티
├── index.css            # 디자인 토큰 · 글로벌 스타일
├── store/               # 상태 관리
│   ├── workspaceStore.js  #   useSyncExternalStore 기반 Custom Store
│   └── selectors.js       #   정규화 상태 셀렉터
├── services/            # 도메인 · 외부 연동
│   ├── domain.js          #   비즈니스 로직
│   ├── cloud.js           #   구글 Apps Script 동기화
│   └── ai.js              #   Gemini AI 통합
├── hooks/               # 컨트롤러
│   └── controllers.js
├── components/          # 공용 컴포넌트
│   ├── ErrorBoundary.jsx
│   ├── RichText.jsx       #   멘션 · 이미지 · 링크 파서/렌더러
│   ├── layout.jsx
│   └── boards.jsx         #   칸반 보드
├── views/               # 화면(뷰)
│   └── views.jsx
├── modals/              # 모달
│   └── modals.jsx
└── assets/              # 브랜드 로고 3종
    ├── logo-light.png
    ├── logo-dark.png
    └── logo-original.png
```

## 🎨 디자인 시스템 (Design System)

앱의 시각 언어는 노션(Notion) 마케팅 사이트를 분석해 추출한 디자인 스펙([`docs/DESIGN.md`](docs/DESIGN.md))을 **단일 기준**으로 삼아, `src/index.css`의 토큰 시스템으로 구현되어 있습니다.

- **웜 페이퍼 캔버스**: 순백(#ffffff) 대신 따뜻한 오프화이트(#f6f5f4)를 기본 캔버스로 사용해 문서 같은 차분함을 줍니다.
- **단일 노션 블루 액센트**: 구조적 색상은 노션 블루(#0075de) 하나뿐입니다. CTA와 링크에만 사용하고, 나머지 크롬은 무채색으로 유지합니다.
- **Hairline + 다층 소프트 그림자**: 1px 헤어라인 테두리를 기본 경계로 삼고, 깊이는 여러 겹의 옅은 마이크로 그림자를 쌓아 "은은하게 떠 있는" 느낌으로 표현합니다.
- **Radius 스케일**: 4px(폼 필드) · 5px(메뉴/리스트) · 8px(유틸리티 버튼) · 12px(카드) · 16px(대형 컨테이너)로 단계화되어 있습니다.
- **Pretendard 폰트 + 네거티브 트래킹**: 라틴부 Inter 기반의 Pretendard를 사용하며, 디스플레이 크기일수록 더 강한 음수 자간(letter-spacing)을 명시 적용해 노션 특유의 조밀한 헤드라인을 재현합니다.
- **라이트/다크 수동 전환**: 헤더의 해/달 버튼으로 언제든 전환할 수 있어요. 처음에는 시스템 설정을 따르고, 선택은 브라우저에 기억됩니다. 다크 팔레트는 웜 무채색 + 단일 블루 원칙을 노션 다크 모드 근사치로 파생했습니다.
- **모션**: 화면 전환·팝업 등장에 은은한 페이드/줌 애니메이션, 버튼에는 스펙의 press scale 효과가 적용되어 있습니다. 칸반 드래그 중에는 카드가 살짝 기울고, 놓을 컬럼과 드롭 존이 강조됩니다.
- **컨트롤 문법**: 주요 액션(새 작업)과 선택형 컨트롤(팀 필터·상태·담당 팀)은 노션 CTA 문법대로 알약(pill) 형태를 씁니다. 상세 입력 폼은 노션 속성 행(좌측 라벨 + 우측 값) 레이아웃입니다.
- **스크롤바**: 시스템 기본 대신 토큰 색을 따르는 얇은 커스텀 스크롤바가 라이트/다크 모두에 적용됩니다.
- **SEED Design 토큰 오버라이드**: SEED Design은 파운데이션 토큰만 사용하며, 위 노션 스펙 값으로 오버라이드해 프로젝트 고유의 톤을 유지합니다.
- **브랜드 로고**: "The 다붓" 로고를 `src/assets`에 라이트/다크 2종으로 두고 테마에 맞춰 노출합니다.

## 🔐 로그인 (Supabase OAuth — 선택)

권한 분리를 위해 Supabase 기반 구글/카카오 로그인을 지원합니다. **설정하지 않으면 로그인 없는 게스트 모드로 동작**하므로 로컬 개발에는 필수가 아닙니다.

1. [supabase.com](https://supabase.com)에서 무료 프로젝트를 만들고, `Settings → API`에서 URL과 anon key를 확인합니다.
2. `Authentication → Providers`에서 Google / Kakao를 활성화합니다(각 개발자 콘솔에서 발급한 클라이언트 ID·시크릿 필요).
3. 프로젝트 루트에서 `.env.example`을 `.env`로 복사하고 두 값을 채웁니다.
4. 개발 서버를 재시작하면 로그인 화면이 나타나고, 로그인한 사용자 이름이 워크스페이스 프로필에 반영됩니다. 첫 로그인 직후에는 표시 이름(닉네임)과 소속 팀을 정하는 창이 자동으로 열리며, 이후에도 사이드바 하단 프로필에서 언제든 바꿀 수 있어요. 댓글·활동 기록은 이 표시 이름으로 작성됩니다.

### 관리자 권한

프로젝트 삭제는 **관리자 전용** 기능입니다. `.env`의 `VITE_ADMIN_EMAILS`에 쉼표로 구분해 관리자 이메일을 지정하면, 해당 계정으로 로그인했을 때만 프로젝트 헤더에 삭제 버튼이 나타납니다. **로그인을 설정하지 않은 게스트 모드에서는 제한 없이** 모두가 삭제할 수 있어요. 삭제하더라도 헤더의 실행 취소(Undo) 버튼으로 프로젝트와 그 안의 업무를 즉시 복구할 수 있으니 안심하세요.

> 구글 드라이브 팀 폴더 동기화는 드라이브 권한 보유자와 함께 진행할 예정으로 보류 상태입니다.

## ☁️ 클라우드 백엔드 (Supabase)

상태·관계 데이터(프로젝트·카드·댓글·팀·리소스 링크)는 **Supabase(Postgres)** 에 저장하고, 첨부 **파일의 실체는 관리자 구글 드라이브**에 두며 DB에는 참조(`files` 테이블: 드라이브 파일 ID·이름·링크)만 보관합니다. 모든 테이블은 RLS(Row Level Security)로 보호되며, 로그인 사용자는 조회·작성이 가능하고 삭제는 작성 본인 또는 관리자(`is_admin()`)로 제한됩니다. 프로젝트 삭제는 관리자만 가능합니다.

### 마이그레이션 적용

스키마는 [`supabase/migrations/0001_init.sql`](supabase/migrations/0001_init.sql) 한 파일에 정리되어 있습니다. 둘 중 한 방법으로 적용하세요.

- **Supabase 대시보드**: `SQL Editor`에 `0001_init.sql` 내용을 붙여넣고 실행.
- **Supabase CLI**: 프로젝트를 링크한 뒤 `supabase db push`.

### 관리자 등록

관리자 권한(프로젝트 삭제 등)은 `admins` 테이블의 이메일 화이트리스트로 판정합니다. 대시보드 SQL Editor에서 관리자 이메일을 추가하세요.

```sql
insert into admins (email) values ('joshua@276holdings.com');
```

> **참고**: 이번 단계는 백엔드 스키마·클라이언트·영속 계층(`src/services/cloud.js`) 구축까지입니다. 실제 화면이 클라우드 데이터를 읽고 쓰도록 하는 **프론트엔드 배선은 다음 단계**에서 진행합니다. 그 전까지 앱은 기존 로컬(게스트) 모드로 동작합니다.

## 🚀 로컬 실행 방법 (Getting Started)

### 1. 프로젝트 클론 및 패키지 설치

```bash
git clone https://github.com/thedaboot/church-workspace.git
cd church-workspace
npm install
```

필요한 라이브러리(React 19, Vite 8, Tailwind CSS 4, SEED Design, Pretendard, lucide-react)는 `npm install` 한 번으로 모두 설치됩니다.

### 2. 개발 서버 실행

```bash
npm run dev
```

### 3. 프로덕션 빌드

```bash
npm run build
```

빌드 결과물은 `dist/`에 생성되며, `npm run preview`로 미리 확인할 수 있습니다.

## 🤝 기여하기 (Contributing)

기능 추가나 버그 수정은 언제나 환영합니다! PR(Pull Request)을 날려주시면 리뷰 후 반영하겠습니다. 특히 다음과 같은 부분의 고도화를 환영합니다.

- dnd-kit을 활용한 모바일 터치 드래그 앤 드롭 개선
- Virtualization을 통한 대규모 데이터 렌더링 최적화
</content>
</invoke>
