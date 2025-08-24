/// <reference types="vitest" />

import path from 'node:path'
import fs from 'node:fs/promises'
import { Buffer } from 'node:buffer'
import { defineConfig } from 'vite'
import Vue from '@vitejs/plugin-vue'
import Components from 'unplugin-vue-components/vite'
import AutoImport from 'unplugin-auto-import/vite'
import UnoCSS from 'unocss/vite'
import VueMacros from 'unplugin-vue-macros/vite'
import VueRouter from 'unplugin-vue-router/vite'
import { VueRouterAutoImports } from 'unplugin-vue-router'
import inject from '@rollup/plugin-inject'
import { NodeGlobalsPolyfillPlugin } from '@esbuild-plugins/node-globals-polyfill'

export default defineConfig({
  resolve: {
    alias: {
      '~/': `${path.resolve(__dirname, 'src')}/`,
      // Vendored tx builder library (CommonJS) included in this repo
      'pntx': path.resolve(__dirname, 'src/vendor/pntx/index.js'),
      // Node core polyfills for browser usage (needed by bitcoinjs-lib deps)
      'buffer': 'buffer',
      'node:buffer': 'buffer',
      'stream': 'stream-browserify',
      'node:stream': 'stream-browserify',
      'util': 'util',
      'node:util': 'util',
      'events': 'events',
      'node:events': 'events',
      'process': 'process/browser',
      'crypto': 'crypto-browserify',
      'node:crypto': 'crypto-browserify',
    },
  },
  plugins: [
    // Dev-only API to save feedback locally under ./feedbacks/
    {
      name: 'feedback-api',
      configureServer(server) {
        server.middlewares.use('/api/feedback', async (req, res) => {
          if (req.method !== 'POST') {
            res.statusCode = 405
            res.setHeader('Content-Type', 'text/plain')
            res.end('Method Not Allowed')
            return
          }
          try {
            const chunks: Uint8Array[] = []
            req.on('data', (c: Uint8Array) => chunks.push(c))
            req.on('end', async () => {
              try {
                const raw = Buffer.concat(chunks).toString('utf8')
                const data = raw ? JSON.parse(raw) : {}
                const text = typeof data?.text === 'string' ? data.text.trim() : ''
                if (!text) {
                  res.statusCode = 400
                  res.setHeader('Content-Type', 'text/plain')
                  res.end('Missing feedback text')
                  return
                }
                const dir = path.resolve(__dirname, 'feedbacks')
                await fs.mkdir(dir, { recursive: true })
                const ts = new Date().toISOString().replace(/[:.]/g, '-')
                const file = path.join(dir, `feedback-${ts}.txt`)
                const content = `${new Date().toISOString()}\n\n${text}\n`
                await fs.writeFile(file, content, 'utf8')
                res.statusCode = 200
                res.setHeader('Content-Type', 'text/plain')
                res.end('OK')
              }
              catch (e) {
                res.statusCode = 500
                res.setHeader('Content-Type', 'text/plain')
                res.end('Failed to save feedback')
              }
            })
          }
          catch (e) {
            res.statusCode = 500
            res.setHeader('Content-Type', 'text/plain')
            res.end('Failed to process request')
          }
        })
      },
      // Also enable the same endpoint when serving the built app via `vite preview`
      configurePreviewServer(server) {
        server.middlewares.use('/api/feedback', async (req, res) => {
          if (req.method !== 'POST') {
            res.statusCode = 405
            res.setHeader('Content-Type', 'text/plain')
            res.end('Method Not Allowed')
            return
          }
          try {
            const chunks: Uint8Array[] = []
            req.on('data', (c: Uint8Array) => chunks.push(c))
            req.on('end', async () => {
              try {
                const raw = Buffer.concat(chunks).toString('utf8')
                const data = raw ? JSON.parse(raw) : {}
                const text = typeof data?.text === 'string' ? data.text.trim() : ''
                if (!text) {
                  res.statusCode = 400
                  res.setHeader('Content-Type', 'text/plain')
                  res.end('Missing feedback text')
                  return
                }
                const dir = path.resolve(__dirname, 'feedbacks')
                await fs.mkdir(dir, { recursive: true })
                const ts = new Date().toISOString().replace(/[:.]/g, '-')
                const file = path.join(dir, `feedback-${ts}.txt`)
                const content = `${new Date().toISOString()}\n\n${text}\n`
                await fs.writeFile(file, content, 'utf8')
                res.statusCode = 200
                res.setHeader('Content-Type', 'text/plain')
                res.end('OK')
              }
              catch (e) {
                res.statusCode = 500
                res.setHeader('Content-Type', 'text/plain')
                res.end('Failed to save feedback')
              }
            })
          }
          catch (e) {
            res.statusCode = 500
            res.setHeader('Content-Type', 'text/plain')
            res.end('Failed to process request')
          }
        })
      },
    },
    VueMacros({
      defineOptions: false,
      defineModels: false,
      plugins: {
        vue: Vue({
          script: {
            propsDestructure: true,
            defineModel: true,
          },
        }),
      },
    }),

    // https://github.com/posva/unplugin-vue-router
    VueRouter(),

    // https://github.com/antfu/unplugin-auto-import
    AutoImport({
      imports: [
        'vue',
        '@vueuse/core',
        VueRouterAutoImports,
        {
          // add any other imports you were relying on
          'vue-router/auto': ['useLink'],
        },
      ],
      dts: true,
      dirs: [
        './src/composables',
      ],
      vueTemplate: true,
    }),

    // https://github.com/antfu/vite-plugin-components
    Components({
      dts: true,
    }),

    // https://github.com/antfu/unocss
    // see uno.config.ts for config
    UnoCSS(),

    // Provide globals for node polyfills in dependencies
    inject({
      Buffer: ['buffer', 'Buffer'],
      process: 'process',
    }),
  ],
  server: {
    fs: {
      // No need to allow parent directories now that the builder is vendored
      allow: [
        __dirname,
      ],
    },
  },
  // Provide globals expected by some Node libs
  define: {
    'process.env': {},
    'global': 'globalThis',
  },
  optimizeDeps: {
    include: [
      'buffer',
      'events',
      'util',
      'stream-browserify',
      'process',
      'crypto-browserify',
    ],
    esbuildOptions: {
      define: {
        'global': 'globalThis',
        'process.env': '{}',
      },
      plugins: [
        NodeGlobalsPolyfillPlugin({
          buffer: true,
          process: true,
        }),
      ],
    },
  },
  // https://github.com/vitest-dev/vitest
  test: {
    environment: 'jsdom',
  },
})
