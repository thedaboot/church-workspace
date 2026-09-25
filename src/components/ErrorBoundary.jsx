import React from 'react';
import { AlertTriangle } from 'lucide-react';

// ============================================================================
// 7. Error Boundary (장애 격리 계층)
// ============================================================================
export class ErrorBoundary extends React.Component {
  constructor(props) { super(props); this.state = { hasError: false, error: null }; }
  static getDerivedStateFromError(error) { return { hasError: true, error }; }
  componentDidCatch(error, errorInfo) { console.error("Error caught by boundary:", error, errorInfo); }
  render() {
    if (this.state.hasError) {
      return (
        // 색은 토큰만 — 예전엔 Tailwind 기본 red(500/600/800/100)를 썼는데 그 값들은
        // 테마를 따라가지 않아서, 다크 모드에서 밝은 red-100 버튼이 그대로 떴다.
        <div className="p-6 bg-surface border border-line rounded-lg shadow-soft m-4 flex items-start gap-3">
          <AlertTriangle className="text-tag-red-fg shrink-0 mt-0.5" />
          <div className="min-w-0">
            {/* 실패 문구는 두 줄(§8) — 원문(`TypeError: …`)은 componentDidCatch가 콘솔에 남긴다.
                `data-error-boundary`는 tests/errhunt가 이 화면을 찾는 자리다(문구에 기대지 않는다). */}
            <h3 data-error-boundary className="text-fg font-bold text-sm">화면을 그리지 못했어요</h3>
            <p className="text-fg-muted text-xs mt-1 break-words">다시 시도해도 같으면 새로고침해주세요</p>
            <button onClick={() => this.setState({ hasError: false })} className="mt-3 px-3 py-1 bg-tag-red text-tag-red-fg hover:opacity-80 text-xs rounded-md font-semibold transition active:scale-95">다시 시도</button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
