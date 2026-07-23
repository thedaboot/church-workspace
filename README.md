# ⛪ 교회 청년부 워크스페이스 (Church Workspace)

교회 청년부, 임원진, 각 사역 팀을 위한 서버리스(Serverless) 기반의 무료 온라인 협업 툴입니다. 노션(Notion)과 슬랙(Slack)의 핵심 기능을 차용하여, 예산 부담 없이 자체적인 업무 플로우를 구축하기 위해 개발되었습니다.

## ✨ 주요 기능 (Features)

- **팀별/프로젝트별 칸반 보드**: 업무 상태(시작 전, 진행 중, 완료) 드래그 앤 드롭 지원
- **마스터 대시보드**: 전체 프로젝트 진척도 및 팀별 남은 업무 통계 시각화
- **실시간 소통 & 멘션**: 업무별 댓글 피드 및 @이름 멘션 기능
- **Time-Travel (Undo/Redo)**: 자체 구현한 상태 관리를 통한 실행 취소/다시 실행 기능
- **서버리스 클라우드 동기화**: 구글 Apps Script를 활용하여 관리자의 구글 드라이브를 자체 DB로 활용
- **Gemini AI 통합**: 업무 내용 3줄 요약, 문맥 다듬기, 부드러운 댓글 톤앤매너 교정 기능

## 🏗️ 아키텍처 하이라이트 (Architecture)

이 프로젝트는 복잡한 의존성을 줄이고 성능을 극대화하기 위해 다음과 같은 실무 아키텍처 패턴을 순수 React로 직접 구현했습니다.

1. **상태 정규화 (Normalization) & O(1) 캐싱**: EntityAdapter 패턴을 적용하여 데이터를 `{ byId, allIds }` 형태로 정규화하고, useMemo를 통한 Map 룩업으로 성능을 최적화했습니다.
2. **Context 분리 및 Custom Store**: 불필요한 리렌더링을 막기 위해 Context를 도메인별로 세분화하고, useSyncExternalStore와 결합한 자체 Store 클래스를 구축했습니다.
3. **도메인 분할 (SRP)**: WorkspaceShell → Controller → Service → Persistence Layer(Repository)로 책임을 분리하여 유지보수성을 극대화했습니다.
4. **RichText 파서/렌더러 분리**: 텍스트에서 멘션, 이미지, 링크를 추출하는 Tokenizer와 Renderer를 분리했습니다.

## 🚀 로컬 실행 방법 (Getting Started)

### 1. 프로젝트 클론 및 패키지 설치

```bash
git clone https://github.com/thedaboot/church-workspace.git
cd church-workspace
npm install
```

필요한 라이브러리(React 19, Vite, Tailwind CSS 4, lucide-react)는 `npm install` 한 번으로 모두 설치됩니다.

### 2. 실행

```bash
npm run dev
```

## 🤝 기여하기 (Contributing)

기능 추가나 버그 수정은 언제나 환영합니다! PR(Pull Request)을 날려주시면 리뷰 후 반영하겠습니다. 특히 다음과 같은 부분의 고도화를 환영합니다.

- dnd-kit을 활용한 모바일 터치 드래그 앤 드롭 개선
- Virtualization을 통한 대규모 데이터 렌더링 최적화
