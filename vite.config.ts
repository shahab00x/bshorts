/// <reference types="vitest" />

import path from 'node:path'
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
