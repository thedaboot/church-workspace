// ============================================================================
// 6. Persistence Layer (클라우드 저장소 계층 추상화)
// ============================================================================
export const CloudRepository = {
  save: async (url, data) => {
    const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(data), redirect: 'follow' });
    if (!response.ok) throw new Error('Network response was not ok');
  },
  load: async (url) => {
    const response = await fetch(url, { redirect: 'follow' });
    if (!response.ok) throw new Error('Network response was not ok');
    return await response.json();
  }
};
