import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// В браузере касса открывается по адресу /pos/, в Android-приложении — из файлов (base './')
export default defineConfig(({ mode }) => ({
  base: mode === 'android' ? './' : '/pos/',
  plugins: [react()],
  server: { port: 5174, proxy: { '/api': 'http://localhost:3000' } },
}));
