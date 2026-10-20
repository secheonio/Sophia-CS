import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:3001',
        changeOrigin: true,
        // 서버의 출처 검사를 통과하도록 개발 프록시에서만 Origin을 서버 주소로 맞춥니다.
        headers: { Origin: 'http://127.0.0.1:3001' },
      },
    },
  },
})
