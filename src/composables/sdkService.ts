/**
 * Note: If you need to use the full version of the Proxy API, it is recommended
 * to deploy a server using the Express.js template.
 * Template available here: https://github.com/DaniilKimlb/bastyon-miniapp-expressjs-template
 */

/**
 * SdkService class for initializing and managing Bastyon SDK interactions.
 *
 * This class handles initialization, event listeners, and API calls with the Bastyon SDK.
 */
export default class SdkService {
  private sdk: any
  private static instance: SdkService | null = null

  public static getInstance(): SdkService {
    if (!SdkService.instance)
      SdkService.instance = new SdkService()

    return SdkService.instance
  }

  /**
   * Constructs the SdkService and initializes the Bastyon SDK instance.
   *
   * @remarks
   * If you need to interact with the Bastyon API, this class should be instantiated and initialized.
   */
  constructor() {
    // eslint-disable-next-line ts/ban-ts-comment
    // @ts-expect-error
    this.sdk = new window.BastyonSdk()
  }

  /**
   * Example of how to use RPC calls with the Bastyon SDK.
   *
   * @returns {Promise<any>} A promise that resolves with the node information.
   * @example
   * sdkService.getNodeInfo().then((nodeInfo) => {
   *     console.log('Node Info:', nodeInfo);
   * });
   *
   * @remarks
   * This method demonstrates how to perform an RPC call to fetch node information.
   * You can find other available RPC methods in the documentation here:
   * https://github.com/DaniilKimlb/pocketnet-proxy-api/blob/master/docs/rpc-methods.md
   */
  async getNodeInfo() {
    return this.sdk.rpc('getnodeinfo')
  }

  /**
   * Initializes the Bastyon SDK.
   *
   * @returns {Promise<void>} A promise that resolves when the SDK has been successfully initialized.
   * @example
   * const sdkService = new SdkService();
   * sdkService.init().then(() => {
   *     console.log('SDK initialized');
   * });
   */
  async init(): Promise<void> {
    await this.sdk.init()
    console.log('Bastyon SDK initialized')
  }

  /**
   * Emits the 'loaded' event to notify that the application has been loaded.
   *
   * @example
   * sdkService.emitLoaded();
   */
  emitLoaded(): void {
    this.sdk.emit('loaded')
  }

  /**
   * Sets up a listener for the 'changestate' event.
   * When the state changes, the router will navigate to the corresponding route.
   *
   * @param router - The router instance used for navigation.
   * @example
   * sdkService.onChangeState(router);
   */
  onChangeState(router: any): void {
    this.sdk.on('changestate', (data: any) => {
      router.push(this.sdk.getroute(data))
    })
  }

  /**
   * Sets up a listener for the 'action' event.
   * This event is triggered when a specific action occurs in the application.
   *
   * @example
   * sdkService.onAction();
   */
  onAction(): void {
    this.sdk.on('action', () => {
      console.log('An action occurred in the application.')
    })
  }

  /**
   * Sets up a listener for the 'balance' event.
   * Triggered when the user's balance is updated.
   *
   * @example
   * sdkService.onBalance();
   */
  onBalance(): void {
    this.sdk.on('balance', () => {
      console.log('The user\'s balance has been updated.')
    })
  }

  /**
   * Sets up a listener for the 'state' event.
   * Triggered when the application state changes.
   *
   * @example
   * sdkService.onState();
   */
  onState(): void {
    this.sdk.on('state', () => {
      console.log('The application state has changed.')
    })
  }

  /**
   * Sets up a listener for the 'keyboard' event.
   * Triggered when there is interaction with the keyboard.
   *
   * @example
   * sdkService.onKeyboard();
   */
  onKeyboard(): void {
    this.sdk.on('keyboard', () => {
      console.log('Keyboard interaction detected.')
    })
  }

  /**
   * Fetches the application information from the Bastyon SDK.
   *
   * @returns {Promise<any>} A promise that resolves with the application information.
   * @example
   * sdkService.getAppInfo().then((appInfo) => {
   *     console.log(appInfo);
   * });
   */
  async getAppInfo(): Promise<any> {
    const appInfo = await this.sdk.get.appinfo()
    console.log('Application information:', appInfo)
    return appInfo
  }
}
