import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { viteStaticCopy } from 'vite-plugin-static-copy'
import { resolve } from 'path'

export default defineConfig({
  plugins: [
    vue(),
    viteStaticCopy({
      targets: [
        // {
        //   src: 'node_modules/@ricky0123/vad-web/dist/vad.worklet.bundle.min.js',
        //   dest: './'
        // },
        // {
        //   src: 'node_modules/@ricky0123/vad-web/dist/silero_vad_v5.onnx',
        //   dest: './'
        // },
        // {
        //   src: 'node_modules/@ricky0123/vad-web/dist/silero_vad_legacy.onnx',
        //   dest: './'
        // },
        {
          src: 'node_modules/@ricky0123/vad-web/dist/*',
          dest: './vad'
        },
        {
          src: 'node_modules/onnxruntime-web/dist/*',
          dest: './'
        }
      ]
    })
  ],
  base: './',
  build: {
    outDir: '../../dist/renderer-app',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html')
      }
    }
  },
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src')
    }
  },
  optimizeDeps: {
    exclude: ['onnxruntime-web']
  }
})
