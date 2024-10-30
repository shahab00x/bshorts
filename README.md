---

title: Vue 3 with Bastyon SDK
description: A Vue 3 project integrating Bastyon SDK for decentralized application interactions
tags:
  - Node
  - Vue 3
  - Vite
  - TypeScript
  - Bastyon SDK

---

<p align='center'>
  <img src='./logo.png' alt='PocketNet' width='200'/>
</p>

<h6 align='center'>
<a href="https://github.com/DaniilKimlb/bastyon-miniapp-vue-template">GitHub Repository</a>
</h6>

<h5 align='center'>
<b>Integrate Bastyon SDK in Vue 3 for Decentralized Applications</b>
</h5>

## Features

- 🚀 [Vue 3](https://github.com/vuejs/core), [Vite](https://github.com/vitejs/vite), [pnpm](https://pnpm.io/) - Fast and modern front-end tools.
- 🌐 [Bastyon SDK](https://bastyon.com) - Decentralized, censorship-resistant platform integration.
- 📂 [File-based routing](./src/pages) - Auto-configured routing.
- 📥 [Components auto importing](./src/components) - Automatically import components.

## Directory Structure

```bash
src/
├── composables/
│   └── sdkService.ts  # Contains logic for interacting with the Bastyon SDK
│   └── dark.ts  # Handles dark mode toggle functionality
│   └── index.ts  # Exports utilities and composables from the directory
├── components/
│   └── TheFooter.vue  # Footer component for the app
│   └── TheCounter.vue  # Counter component
│   └── TheInput.vue  # Input component for handling user inputs
├── pages/
│   └── index.vue  # Main page of the application
│   └── [...all].vue  # Catch-all route handler
│   └── hi/[name].vue  # Dynamic route for user-specific pages
├── router/
│   └── index.ts  # Vue Router configuration
├── styles/
│   └── main.css  # Global styles for the application
├── App.vue  # Root Vue component
└── main.ts  # Entry point of the application
```

## Bastyon SDK

This project includes Bastyon SDK integration to communicate with the decentralized platform. The SDK allows you to manage application state, trigger events, and interact with the Bastyon API.

### Key SDK Features

- **State Management**: Handle and listen to state changes via SDK events.
- **Decentralized Actions**: Communicate with the Bastyon platform for user actions, balance updates, and more.
- **App Info**: Retrieve relevant information from the Bastyon app.

## Example Usage

### Initialization of Bastyon SDK

In `src/main.ts`, you will find how the Bastyon SDK is initialized and configured:

```typescript
import { createApp } from 'vue'
import App from './App.vue'
import router from './router'
import SdkService from './composables/sdkService'

const app = createApp(App)
const sdkService = new SdkService()

sdkService.init().then(() => {
  sdkService.emitLoaded()
  // Other SDK methods...
})

app.use(router).mount('#app')
```

## Full API Integration

For more advanced use cases, such as the full API implementation, it is recommended to deploy an Express.js server. A ready-to-use template is available here:

- [Express.js Bastyon MiniApp Template](https://github.com/DaniilKimlb/bastyon-miniapp-expressjs-template)

## **Important Note for Publication**

When publishing your project, ensure that the following two files are included in the **`public`** directory:

1. **`b_manifest`** – This file is essential for describing your mini-application and its settings.
2. **`b_icon.png`** – This icon will be displayed as the app icon within the platform.

Make sure both files are placed in the `public/` directory before publishing to avoid any issues with deployment.

Example directory structure for publication:

```
project-root/
├── public/
│   ├── b_manifest      # Mini-app metadata
│   ├── b_icon.png      # Application icon
├── src/
├── dist/
└── package.json
```

These files will ensure the smooth deployment and visibility of your app on the platform.

## Additional Tools

### UI Frameworks

- 🛠️ [UnoCSS](https://github.com/antfu/unocss) - Instant on-demand atomic CSS engine for efficient styling.

### Icons

- 🎨 [Iconify](https://iconify.design) - Use icons from any icon sets.
- 🔍 [Icônes](https://icones.netlify.app/) - Search and use icons from multiple icon sets.
- 💻 Pure CSS Icons via UnoCSS - Style icons directly with CSS using UnoCSS.

### Plugins

- 🗺️ [Vue Router](https://github.com/vuejs/vue-router) - Manages app routing.
- 🗂️ [`unplugin-vue-router`](https://github.com/posva/unplugin-vue-router) - File system-based routing for easy route management.
- 🔧 [`unplugin-auto-import`](https://github.com/antfu/unplugin-auto-import) - Automatically import Vue Composition API and other utilities without manually importing.
- 🧩 [`unplugin-vue-components`](https://github.com/antfu/unplugin-vue-components) - Automatically import components, simplifying usage across the app.
- 🔨 [`unplugin-vue-macros`](https://github.com/sxzz/unplugin-vue-macros) - Extend macros and add more syntax sugar to Vue.
- 🧰 [VueUse](https://github.com/antfu/vueuse) - A collection of useful Vue Composition APIs to enhance functionality.

## How to Run

To start developing with this project, install the dependencies:

```bash
pnpm install
```

Run the development server:

```bash
pnpm run dev
```

Build the project for production:

```bash
pnpm run build
```

The production build will be available in the `dist/` folder.

## License

This project is licensed under the Apache-2.0 License. See the [LICENSE](./LICENSE) file for more information.

---
