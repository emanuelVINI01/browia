import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: {
    outDir: 'dist',
    rollupOptions: {
      input: {
        popup: './index.html', // A página que abre ao clicar no ícone
        background: './src/background.ts',
        offscreen: './offscreen.html',
      },
      output: {
        // Remove os hashes e mantém caminhos previsíveis para o Chrome
        entryFileNames: 'assets/[name].js',
        chunkFileNames: 'assets/[name].js',
        assetFileNames: 'assets/[name].[ext]'
      }
    }
  }
})
