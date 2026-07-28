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
            <h3 className="text-fg font-bold text-sm">컴포넌트 렌더링 중 오류가 발생했습니다.</h3>
            <p className="text-tag-red-fg text-xs mt-1 break-words">{this.state.error?.toString()}</p>
            <button onClick={() => this.setState({ hasError: false })} className="mt-3 px-3 py-1 bg-tag-red text-tag-red-fg hover:opacity-80 text-xs rounded-md font-semibold transition active:scale-95">다시 시도</button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
