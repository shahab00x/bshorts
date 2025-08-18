/**
 * Bastyon SdkService: Simplified integration with Bastyon SDK.
 * Documentation: https://bastyon.com/application?id=app.pocketnet.docs&p=6465762f617070732f6d696e69617070732f73646b2e68746d6c
 *
 * For secure execution of payments and RPC calls, it is recommended to use the ready-to-use Express.js template:
 * https://github.com/DaniilKimlb/bastyon-miniapp-expressjs-template.
 * This template already includes the `pocketnet-proxy-api` library, simplifying interaction with the Bastyon API.
 */
export class SdkService {
  private static sdk: BastyonSdk | null = null
  // Session cache to avoid repeated permission prompts
  private static permissionCache: Map<string, boolean> = new Map()

  /**
   * Initializes the Bastyon SDK at the very start of the application lifecycle.
   * Must be called before any other SDK interactions.
   * Emits the `loaded` event to notify the platform that the application is ready.
   *
   * @example
   * await SdkService.init();
   */
  public static async init(): Promise<void> {
    if (this.sdk) {
      console.warn('Bastyon SDK is already initialized.')
      return
    }

    try {
      this.sdk = new window.BastyonSdk()
      // The host BastyonSdk (pocketnet.gui/js/lib/apps/sdk.js) does not expose an init() method.
      // Guard in case a future/alternate host provides it.
      const sdkUnknown: unknown = this.sdk
      const hasInit = (o: unknown): o is { init: () => Promise<void> | void } => {
        return typeof (o as { init?: unknown }).init === 'function'
      }
      const hasSWRegister = (o: unknown): o is { serviceWorker: { register: () => Promise<void> | void } } => {
        const sw = (o as { serviceWorker?: { register?: unknown } }).serviceWorker
        return !!sw && typeof sw.register === 'function'
      }

      if (hasInit(sdkUnknown))
        await sdkUnknown.init()

      // Notify the platform that the app is ready
      this.sdk.emit('loaded')

      // The host SDK does not expose serviceWorker on the BastyonSdk instance.
      // Registration is handled by the host app (see pocketnet.gui/js/pwa-service-worker.js).
      if (hasSWRegister(sdkUnknown))
        await sdkUnknown.serviceWorker.register()

      console.log('Bastyon SDK successfully initialized (compatible mode).')

      // Optional debug: inventory exposed SDK methods/properties
      // Enable by setting VITE_SDK_DEBUG=true
      if (import.meta?.env?.VITE_SDK_DEBUG) {
        try {
          const proto = Object.getPrototypeOf(this.sdk)
          const protoKeys = Object.getOwnPropertyNames(proto)
          const ownKeys = Object.keys(this.sdk as any)
          const hasAction = typeof (this.sdk as any)?.action === 'function'
          console.log('[SDK DEBUG] proto keys:', protoKeys)
          console.log('[SDK DEBUG] own keys:', ownKeys)
          console.log('[SDK DEBUG] has action():', hasAction)
          console.log('[SDK DEBUG] permissions API:', typeof (this.sdk as any)?.permissions)
          console.log('[SDK DEBUG] get API:', typeof (this.sdk as any)?.get)
        }
        catch (err) {
          console.warn('[SDK DEBUG] failed to introspect SDK:', err)
        }
      }
    }
    catch (error) {
      console.error('Error initializing Bastyon SDK:', error)
      throw error // Re-throw error for handling at a higher level
    }
  }

  /**
   * Signs a raw transaction hex using the host SDK (not via RPC).
   * Requires the 'sign' permission.
   * @param unsignedHex Raw unsigned transaction hex
   * @returns Promise<string> Signed transaction hex
   */
  public static async sign(unsignedHex: string): Promise<string> {
    this.ensureInitialized()
    try {
      if (typeof unsignedHex !== 'string' || !unsignedHex)
        throw new Error('unsignedHex is empty')

      // Ensure permission; ignore errors to allow host to prompt on sign()
      try {
        await this.checkAndRequestPermissions(['sign'])
      }
      catch {}

      const sdkAny = this.sdk as any
      const fn = sdkAny?.sign
      if (typeof fn !== 'function')
        throw new Error('Host SDK does not support sign')

      if (import.meta?.env?.VITE_SDK_DEBUG)
        console.log('[SDK DEBUG] invoking sdk.sign()')

      const res = await fn(unsignedHex)
      const signedHex: unknown = (res && (res.hex ?? res.signed ?? res.result)) ?? (typeof res === 'string' ? res : '')
      if (typeof signedHex !== 'string' || !signedHex)
        throw new Error('Signing failed')
      return signedHex
    }
    catch (error) {
      console.error('Error during SDK sign:', error)
      throw error
    }
  }

  /**
   * Ensures the SDK is initialized before calling other methods.
   * Throws an error if the SDK is not initialized.
   */
  private static ensureInitialized(): void {
    if (!this.sdk) {
      throw new Error(
        'Bastyon SDK is not initialized. Call SdkService.init() at the start of the application.',
      )
    }
  }

  /**
   * Opens an external link using the Bastyon platform.
   * @param url The URL to open.
   * @example
   * SdkService.openExternalLink('https://example.com');
   */
  public static openExternalLink(url: string): void {
    this.ensureInitialized()
    this.sdk!.openExternalLink(url).catch((error) => {
      console.error('Error opening external link:', error)
    })
  }

  /**
   * Example of an RPC call. It is recommended to use a server for secure execution.
   * @param method The RPC method to call.
   * @param parameters The parameters for the method.
   * @returns Promise<unknown> The result of the RPC call.
   * @example
   * SdkService.rpc('getnodeinfo').then((info) => console.log(info));
   */
  public static async rpc(
    method: string,
    parameters: unknown[] = [],
    options: Record<string, unknown> = {},
  ): Promise<unknown> {
    this.ensureInitialized()
    // Retry transient network/JSON errors a couple of times with a tiny backoff.
    const isTransientError = (err: any): boolean => {
      try {
        const msg = String(err?.message || err).toLowerCase()
        return (
          msg.includes('unexpected end of json')
          || msg.includes('unexpected eof')
          || msg.includes('failed to fetch')
          || msg.includes('networkerror')
          || msg.includes('network error')
          || msg.includes('load failed')
          || msg.includes('aborted')
          || msg.includes('timeout')
        )
      }
      catch {
        return false
      }
    }

    const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms))

    let lastErr: unknown
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        // Ensure options object is defined, and on retries set a small cachetime to reduce load.
        const opts = { ...(options || {}) } as Record<string, unknown>
        if (attempt > 0 && (opts as any).cachetime == null)
          (opts as any).cachetime = 15

        const result = await this.sdk!.rpc(method, parameters, opts)
        return result
      }
      catch (error) {
        lastErr = error
        if (isTransientError(error) && attempt < 2) {
          if (import.meta?.env?.VITE_SDK_DEBUG)
            console.warn('[SDK RPC] transient error, retrying', { method, attempt: attempt + 1 })
          await sleep(150 * (attempt + 1))
          continue
        }
        console.error('Error during RPC call:', error, { method })
        throw error
      }
    }
    throw lastErr
  }

  /**
   * Returns true if the host SDK exposes the action() method (i.e., running inside Bastyon host).
   */
  public static supportsAction(): boolean {
    this.ensureInitialized()
    const sdkUnknown: unknown = this.sdk
    const has = typeof (sdkUnknown as any)?.action === 'function'
    if (import.meta?.env?.VITE_SDK_DEBUG)
      console.log('[SDK DEBUG] supportsAction():', has)
    return has
  }

  /**
   * Performs a signed action via the host SDK (e.g., posting, voting, subscribing).
   * Unlike rpc(), this will create and broadcast a transaction via the host wallet.
   * @param method The action name (e.g., 'subscribe', 'unsubscribe').
   * @param payload The action payload object.
   * @param options Optional options object for the host SDK.
   */
  public static async action(
    method: string,
    payload: Record<string, unknown> = {},
    options: Record<string, unknown> = {},
  ): Promise<unknown> {
    this.ensureInitialized()
    try {
      const sdkUnknown: unknown = this.sdk
      const hasAction = (o: unknown): o is { action: (m: string, p?: any, opt?: any) => Promise<any> } => {
        return typeof (o as { action?: unknown }).action === 'function'
      }
      if (!hasAction(sdkUnknown))
        throw new Error('Host SDK does not support action(). Ensure running inside Bastyon host.')

      // Cast to any to avoid TS error since BastyonSdk type doesn't declare action
      if (import.meta?.env?.VITE_SDK_DEBUG)
        console.log('[SDK DEBUG] invoking action()', { method, payload, options })
      const result = await (this.sdk as any).action(method, payload, options)
      if (import.meta?.env?.VITE_SDK_DEBUG)
        console.log('[SDK DEBUG] action() result:', result)
      return result
    }
    catch (error) {
      console.error('Error during SDK action:', error)
      throw error
    }
  }

  /**
   * Adds an event listener for a specific SDK event.
   * @param event The event name to listen to.
   * @param callback The callback function to handle the event data.
   * @example
   * SdkService.on('balance', (data) => console.log('Balance updated:', data));
   */
  public static on(event: BastyonSdkEvents, callback: (data: unknown) => void): void {
    this.ensureInitialized()
    this.sdk!.on(event, callback)
  }

  /**
   * Removes an event listener for a specific SDK event.
   * @param event The event name to remove the listener from.
   * @param callback The callback function to remove.
   * @example
   * const handler = (data) => console.log('Balance updated:', data);
   * SdkService.on('balance', handler);
   * SdkService.off('balance', handler);
   */
  public static off(event: BastyonSdkEvents, callback: (data: unknown) => void): void {
    this.ensureInitialized()
    this.sdk!.off(event, callback)
  }

  /**
   * Fetches application information from the Bastyon SDK.
   * @returns Promise<ApplicationInfo> The application information.
   * @example
   * SdkService.getAppInfo().then((info) => console.log('App info:', info));
   */
  public static async getAppInfo(): Promise<ApplicationInfo> {
    this.ensureInitialized()
    try {
      const info = await this.sdk!.get.appinfo()
      return info
    }
    catch (error) {
      console.error('Error fetching application information:', error)
      throw error
    }
  }

  /**
   * Returns the current user's account address from the host SDK.
   * Requires the 'account' permission to be granted.
   */
  public static async getAccountAddress(): Promise<string> {
    this.ensureInitialized()
    try {
      const sdkAny = this.sdk as any
      const fn = sdkAny?.get?.account
      if (typeof fn !== 'function')
        throw new Error('Host SDK does not support get.account')

      if (import.meta?.env?.VITE_SDK_DEBUG)
        console.log('[SDK DEBUG] fetching account address via get.account')

      const res = await fn()
      const addr: unknown = res?.address ?? res?.adr ?? res?.a
      if (typeof addr !== 'string' || !addr)
        throw new Error('Account address is empty')
      return addr
    }
    catch (error) {
      console.error('Error getting account address:', error)
      throw error
    }
  }

  /**
   * Opens the Bastyon channel UI for the given address so the user can follow there.
   * Useful as a fallback when signed actions are unavailable.
   */
  public static async openChannel(address: string): Promise<void> {
    this.ensureInitialized()
    try {
      const sdkAny = this.sdk as any
      const fn = sdkAny?.helpers?.channel
      if (typeof fn !== 'function')
        throw new Error('Host SDK does not support helpers.channel')

      if (import.meta?.env?.VITE_SDK_DEBUG)
        console.log('[SDK DEBUG] opening channel for address:', address)

      await fn(address)
    }
    catch (error) {
      console.error('Error opening channel UI:', error)
      throw error
    }
  }

  /**
   * Opens a post by txid in the host UI (which includes the comments view).
   */
  public static async openPost(txid: string): Promise<void> {
    this.ensureInitialized()
    try {
      const sdkAny = this.sdk as any
      const fn = sdkAny?.open?.post
      if (typeof fn !== 'function')
        throw new Error('Host SDK does not support open.post')

      if (import.meta?.env?.VITE_SDK_DEBUG)
        console.log('[SDK DEBUG] opening post:', txid)

      await fn(txid)
    }
    catch (error) {
      console.error('Error opening post in host UI:', error)
      throw error
    }
  }

  /**
   * Checks and requests permissions.
   * @param permissions The list of permissions to check and request if needed.
   * @returns Promise<void>
   * @example
   * SdkService.checkAndRequestPermissions(['account', 'payment']);
   */
  public static async checkAndRequestPermissions(permissions: string[]): Promise<void> {
    this.ensureInitialized()
    try {
      const missing: string[] = []
      for (const permission of permissions) {
        // Use session cache first to avoid repeated prompts
        const cached = this.permissionCache.get(permission)
        if (cached === true)
          continue

        let granted = false
        try {
          granted = await this.sdk!.permissions.check({ permission }) as unknown as boolean
        }
        catch (e) {
          console.warn('permissions.check failed for', permission, e)
        }

        if (granted)
          this.permissionCache.set(permission, true)

        else
          missing.push(permission)
      }

      if (missing.length) {
        if (import.meta?.env?.VITE_SDK_DEBUG)
          console.log('[SDK DEBUG] requesting permissions:', missing)
        await this.sdk!.permissions.request(missing)
        for (const p of missing)
          this.permissionCache.set(p, true)
      }

      console.log('All required permissions granted:', permissions)
    }
    catch (error) {
      console.error('Error checking or requesting permissions:', error)
      throw error
    }
  }
}
