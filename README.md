---

title: Vue 3 with Bastyon SDK and Service Worker
description: A Vue 3 project integrating Bastyon SDK for decentralized application interactions with Service Worker support for Tor transport
tags:
  - Node
  - Vue 3
  - Vite
  - TypeScript
  - Bastyon SDK
  - Service Worker
  - Tor

---

<p align='center'>
  <img src='./logo.png' alt='PocketNet' width='200'/>
</p>

<h6 align='center'>
<a href="https://github.com/DaniilKimlb/bastyon-miniapp-vue-template">GitHub Repository</a>
</h6>

<h5 align='center'>
<b>Integrate Bastyon SDK in Vue 3 for Decentralized Applications with Privacy-First Design</b>
</h5>

---

## Features

- 🚀 [Vue 3](https://github.com/vuejs/core), [Vite](https://github.com/vitejs/vite), [pnpm](https://pnpm.io/) - Fast and modern front-end tools
- 🌐 [Bastyon SDK](https://bastyon.com/application?id=app.pocketnet.docs&p=6465762f617070732f6d696e69617070732f73646b2e68746d6c) - Decentralized, censorship-resistant platform integration
- 🔒 **Privacy-First** - Automatic Tor routing for external requests when available
- 📂 [File-based routing](./src/pages) - Auto-configured routing
- 📥 [Components auto importing](./src/components) - Automatically import components
- ⚡ **Zero Configuration** - Works out of the box with enhanced privacy

---

## **Directory Structure**

```bash
src/
├── composables/
│   ├── sdkService.ts     # Contains logic for interacting with the Bastyon SDK
│   ├── dark.ts           # Handles dark mode toggle functionality
│   └── index.ts          # Exports utilities and composables from the directory
├── components/
│   ├── TheFooter.vue     # Footer component for the app
│   ├── TheCounter.vue    # Counter component
│   └── TheInput.vue      # Input component for handling user inputs
├── pages/
│   ├── index.vue         # Main page of the application
│   ├── [...all].vue      # Catch-all route handler
│   └── hi/[name].vue     # Dynamic route for user-specific pages
├── router/
│   └── index.ts          # Vue Router configuration
├── styles/
│   └── main.css          # Global styles for the application
├── App.vue               # Root Vue component
└── main.ts               # Entry point of the application
public/
├── miniapp-service-worker.js  # Service Worker for request proxying
├── b_manifest.json            # Mini-app metadata
└── b_icon.png                 # Application icon
```

---

## **Bastyon SDK**

This project includes Bastyon SDK integration, which is essential for building mini-applications that interact with the decentralized Bastyon platform. The SDK enables your application to:

- Access and use the Bastyon API for various functionalities
- Manage application state and listen to platform events
- Perform secure interactions, such as RPC calls and user actions
- **Automatic privacy enhancement** through integrated Service Worker

The SDK is the primary tool for integrating mini-applications into the Bastyon ecosystem, allowing seamless communication between your app and the platform.

### **TypeScript Support**

The Bastyon SDK offers full TypeScript support through a dedicated type definitions package. These definitions provide strongly typed interfaces for SDK events, methods, and responses, allowing you to:

- Write safer and more predictable code
- Detect potential issues during development
- Enjoy a smoother integration process with Bastyon API

For detailed information about available types and how to use them, refer to the official type definitions package:

- 📘 [Type Definitions for Bastyon SDK](https://github.com/DaniilKimlb/types-bastyon-sdk/blob/master/README.md)

### **Learn More**:

- 📘 [Bastyon SDK Reference Documentation](https://bastyon.com/application?id=app.pocketnet.docs&p=6465762f617070732f6d696e69617070732f73646b2e68746d6c)
- 📘 [How to Create Web Applications on Bastyon](https://bastyon.com/application?id=app.pocketnet.docs)

---

## **Example Usage**

### **Basic Initialization**

The Bastyon SDK and Service Worker can be initialized at the very beginning of your application lifecycle.

#### Example in `src/main.ts`:

```typescript
import { createApp } from 'vue'
import { createRouter, createWebHistory } from 'vue-router/auto'
import App from './App.vue'

import '@unocss/reset/tailwind.css'
import './styles/main.css'
import 'uno.css'

const app = createApp(App)
const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
})

app.use(router)
app.mount('#app')

// Initialize the Bastyon SDK
const SDK = new BastyonSdk()
await SDK.init()

// Optionally register Service Worker for enhanced privacy
SDK.serviceWorker.register().then((registration) => {
  if (registration)
    console.log('🔒 Service Worker registered - external requests will use Tor when available')
  else
    console.log('ℹ️ Service Worker not available or Tor not supported')
}).catch((error) => {
  console.log('ℹ️ Service Worker registration failed:', error.message)
})
```

### **Service Worker Management**

The new Service Worker API provides complete control over privacy features:

```typescript
// Initialize SDK
const SDK = new BastyonSdk()
await SDK.init()

// Register Service Worker for enhanced privacy
await SDK.serviceWorker.register()

// Check Service Worker status
const status = SDK.serviceWorker.getStatus()
console.log('Supported:', status.supported)
console.log('Registered:', status.registered)
console.log('Active:', status.active)

// Check if Service Worker is currently active
if (SDK.serviceWorker.isActive())
  console.log('🔒 Privacy mode active - external requests are being proxied')

// Unregister Service Worker if needed
await SDK.serviceWorker.unregister()

// Legacy aliases still work for backward compatibility
await SDK.registerServiceWorker() // Same as serviceWorker.register()
const isActive = SDK.isServiceWorkerActive() // Same as serviceWorker.isActive()
```

### **Making API Requests**

Your existing code doesn't need to change - enhanced privacy works automatically:

```typescript
// This request will automatically be proxied through Tor if Service Worker is active
fetch('https://api.github.com/users/octocat')
  .then(response => response.json())
  .then((data) => {
    console.log('✅ Data received through Tor:', data)
  })

// This request to Bastyon will NOT be proxied (direct for performance)
fetch('https://bastyon.com/api/some-endpoint')
  .then(response => response.json())
  .then((data) => {
    console.log('✅ Direct request to Bastyon:', data)
  })
```

### **Basic SDK Methods**

After initialization, you can use the following methods to interact with the Bastyon platform:

1. **Opening an External Link**:

   ```typescript
   SDK.openExternalLink('https://example.com')
   ```

2. **Fetching Application Information**:

   ```typescript
   SDK.get.appinfo().then((info) => {
     console.log('App Info:', info)
     console.log('Tor Available:', info.alttransport)
     console.log('Service Worker Support:', info.supportsServiceWorkerProxy)
   })
   ```

3. **Performing an RPC Call**:

   ```typescript
   SDK.rpc('getnodeinfo').then((info) => {
     console.log('Node Info:', info)
   }).catch((error) => {
     console.error('RPC Call Failed:', error)
   })
   ```

4. **Adding Event Listeners**:

   ```typescript
   SDK.on('balance', (data) => {
     console.log('Balance updated:', data)
   })
   ```

5. **Requesting Permissions**:
   ```typescript
   SDK.permissions.request(['account', 'payment']).then(() => {
     console.log('Permissions granted')
   }).catch((error) => {
     console.error('Permission request failed:', error)
   })
   ```

---

## **Privacy & Service Worker Integration**

### **Enhanced Privacy Through Tor**

This template can automatically route external API requests through Bastyon's Tor network when available, providing:

- 🔒 **IP Anonymization** - Your real IP is hidden from external services
- 🌍 **Censorship Resistance** - Access APIs even in restricted networks
- ⚡ **Optional Configuration** - Enable privacy features when needed
- 🔄 **Smart Filtering** - Only external requests are proxied

### **How It Works**

1. **Optional Registration**: Service Worker is registered when you call `SDK.serviceWorker.register()`
2. **Request Interception**: All external HTTP/HTTPS requests are intercepted
3. **Smart Filtering**: Only external API requests are proxied - local and Bastyon requests are passed through normally
4. **Tor Integration**: Requests are automatically routed through Tor when available in Bastyon
5. **Transparent Operation**: Your application code remains unchanged - `fetch()` works as usual

### **What Gets Proxied**

✅ **Proxied through Tor (when Service Worker is active):**

- `https://api.github.com/users/octocat`
- `https://jsonplaceholder.typicode.com/posts`
- Any external API calls

❌ **Direct requests (never proxied):**

- `https://bastyon.com/js/lib/apps/sdk.js` - Bastyon resources
- `http://localhost:3000/` - Your application
- `chrome-extension://...` - Browser extensions
- `blob:` and `data:` URLs

### **Service Worker Configuration Options**

```typescript
// Simple registration
await SDK.serviceWorker.register()

// Check if Tor is available before registering
const appInfo = await SDK.get.appinfo()
if (appInfo.alttransport && appInfo.supportsServiceWorkerProxy) {
  await SDK.serviceWorker.register()
  console.log('🔒 Privacy mode enabled')
}
else {
  console.log('ℹ️ Tor not available, using direct requests')
}

// Advanced status monitoring
const status = SDK.serviceWorker.getStatus()
console.log(`Service Worker Status:
  Supported: ${status.supported}
  Registered: ${status.registered}
  Active: ${status.active}
  Scope: ${status.scope}
`)
```

### **Security Considerations**

- ✅ Service Worker only processes external HTTP/HTTPS requests
- ✅ Bastyon and local resources use direct connections for performance
- ✅ Browser extensions and special protocols are never intercepted
- ✅ Graceful fallback to direct requests when Tor is unavailable
- ✅ Service Worker can be disabled/unregistered at any time

---

## **Important Note for Publication**

When publishing your project, ensure that the following files are included in the **`public`** directory:

1. **[`b_manifest.json`](https://docs.bastyon.com/dev/apps/miniapps/get-started.html#b-manifest-json)** – This file is essential for describing your mini-application and its settings
2. **[`b_icon.png`](https://docs.bastyon.com/dev/apps/miniapps/get-started.html#b-icon-png)** – This icon will be displayed as the app icon within the platform
3. **`miniapp-service-worker.js`** – Service Worker file that handles request proxying through Tor (optional, only needed if using privacy features)

### **Service Worker Configuration**

When included, the Service Worker is automatically configured to:

- ✅ Proxy external API requests through Tor
- ✅ Allow direct access to Bastyon resources
- ✅ Skip browser extensions and local resources
- ✅ Provide graceful fallback when Tor is unavailable

The Service Worker is completely optional - your app will work perfectly without it!

### **HTTPS Requirements**

Bastyon requires all applications, including those tested locally, to run on **HTTPS**. This is especially important for Service Workers, which only work over HTTPS.

1. **Use Self-Signed SSL Certificates:** Generate certificates for local development
2. **Specify a Dev Domain:** Required for adding local domains to Bastyon

### How to Generate Self-Signed Certificates:

1. **Generate Certificates Using OpenSSL**:

   ```bash
   openssl req -x509 -newkey rsa:4096 -keyout localhost-key.pem -out localhost.pem -days 365 -nodes
   ```

2. **Configure Vite for HTTPS with Service Worker support**:

   ```typescript
   import fs from 'node:fs'
   import { defineConfig } from 'vite'

   export default defineConfig({
     server: {
       https: {
         key: fs.readFileSync('./localhost-key.pem'),
         cert: fs.readFileSync('./localhost.pem'),
       },
       headers: {
         'Service-Worker-Allowed': '/'
       }
     },
     build: {
       rollupOptions: {
         input: {
           main: 'index.html',
           sw: 'public/miniapp-service-worker.js'
         }
       }
     }
   })
   ```

### **Example Directory Structure**

```bash
project-root/
├── public/
│   ├── b_manifest.json            # Mini-app metadata (required)
│   ├── b_icon.png                 # Application icon (required)
│   └── miniapp-service-worker.js  # Service Worker for Tor proxying (optional)
├── src/
│   └── composables/
│       └── serviceWorker.ts       # Service Worker management (if using privacy features)
├── dist/                          # Built application
├── localhost-key.pem              # Self-signed private key for HTTPS
├── localhost.pem                  # Self-signed certificate for HTTPS
└── package.json
```

---

## Additional Tools

### UI Frameworks

- 🛠️ [UnoCSS](https://github.com/antfu/unocss) - Instant on-demand atomic CSS engine for efficient styling

### Icons

- 🎨 [Iconify](https://iconify.design) - Use icons from any icon sets
- 🔍 [Icônes](https://icones.netlify.app/) - Search and use icons from multiple icon sets
- 💻 Pure CSS Icons via UnoCSS - Style icons directly with CSS using UnoCSS

### Plugins

- 🗺️ [Vue Router](https://github.com/vuejs/vue-router) - Manages app routing
- 🗂️ [`unplugin-vue-router`](https://github.com/posva/unplugin-vue-router) - File system-based routing for easy route management
- 🔧 [`unplugin-auto-import`](https://github.com/antfu/unplugin-auto-import) - Automatically import Vue Composition API and other utilities without manually importing
- 🧩 [`unplugin-vue-components`](https://github.com/antfu/unplugin-vue-components) - Automatically import components, simplifying usage across the app
- 🔨 [`unplugin-vue-macros`](https://github.com/sxzz/unplugin-vue-macros) - Extend macros and add more syntax sugar to Vue
- 🧰 [VueUse](https://github.com/antfu/vueuse) - A collection of useful Vue Composition APIs to enhance functionality

---

## How to Run

To start developing with this project, install the dependencies:

```bash
pnpm install
```

Run the development server:

```bash
pnpm run dev
```

Your application will be available at `https://localhost:3000` with optional Service Worker support for enhanced privacy.

Build the project for production:

```bash
pnpm run build
```

The production build will be available in the `dist/` folder, including the Service Worker if you choose to use privacy features.

---

## License

This project is licensed under the Apache-2.0 License. See the [LICENSE](./LICENSE) file for more information.

---
