import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { seedDesignPlugin } from '@seed-design/vite-plugin';

export default defineConfig({
  plugins: [react(), tailwindcss(), seedDesignPlugin()],
});
