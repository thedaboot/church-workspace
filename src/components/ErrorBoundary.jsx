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
        <div className="p-6 bg-red-50 border border-red-200 rounded-md m-4 flex items-start gap-3">
          <AlertTriangle className="text-red-500 shrink-0 mt-0.5" />
          <div>
            <h3 className="text-red-800 font-bold text-sm">컴포넌트 렌더링 중 오류가 발생했습니다.</h3>
            <p className="text-red-600 text-xs mt-1">{this.state.error?.toString()}</p>
            <button onClick={() => this.setState({ hasError: false })} className="mt-3 px-3 py-1 bg-red-100 hover:bg-red-200 text-red-800 text-xs rounded-md font-medium transition-colors">다시 시도</button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
