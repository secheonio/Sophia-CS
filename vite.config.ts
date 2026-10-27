import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    host: '127.0.0.1',
    port: 3100,
    strictPort: true,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:3002',
        changeOrigin: true,
        // 로컬 개발용 백엔드 포트는 외부 SSH 포트포워딩과 분리해야 합니다.
        headers: { Origin: 'http://127.0.0.1:3002' },
      },
    },
  },
})
