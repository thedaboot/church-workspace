import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// SEED Design은 파운데이션 토큰(@seed-design/css/base.css)만 쓴다. 컴포넌트를 하나도
// 쓰지 않으므로 @seed-design/react와 vite 플러그인은 뺐다(플러그인은 컴포넌트 레시피를
// 생성하는 용도다). 다시 컴포넌트를 도입하면 그때 되돌리면 된다.
export default defineConfig({
  plugins: [react(), tailwindcss()],
});
