// ============================================================================
// 2. Utils & Helpers (유틸리티)
// ============================================================================
export const generateId = () => typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `id_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

export const formatDate = (dateString) => {
  if (!dateString) return '';
  return new Date(dateString).toLocaleDateString('ko-KR', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
};

// Entity 정규화 헬퍼 (Redux Toolkit Entity Adapter 패턴)
export const normalize = (array) => array.reduce((acc, item) => {
  acc.byId[item.id] = item;
  acc.allIds.push(item.id);
  return acc;
}, { byId: {}, allIds: [] });
