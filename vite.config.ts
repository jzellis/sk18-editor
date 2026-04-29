import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import electron from 'vite-plugin-electron'
import renderer from 'vite-plugin-electron-renderer'
import { resolve } from 'path'

export default defineConfig({
  server: {
    port: 5200,
    strictPort: true
  },
  plugins: [
    react(),
    electron([
      {
        entry: 'src/main/main.ts',
        onstart(options) {
          options.startup(['--no-sandbox', '--disable-gpu', '.'])
        },
        vite: {
          build: {
            outDir: 'dist-electron',
            rollupOptions: {
              external: ['electron', 'serialport', '@serialport/bindings-cpp', '@serialport/stream']
            }
          }
        }
      },
      {
        entry: 'src/main/preload.ts',
        onstart(options) {
          options.reload()
        },
        vite: {
          build: {
            outDir: 'dist-electron',
            rollupOptions: {
              external: ['electron']
            }
          }
        }
      }
    ]),
    renderer()
  ],
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src/renderer'),
      '@shared': resolve(__dirname, 'src/shared')
    }
  }
})
