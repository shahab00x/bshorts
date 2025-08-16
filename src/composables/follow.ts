import { SdkService } from './sdkService'

/**
 * Follow (subscribe) helper
 * - Ensures required permissions
 * - Resolves current user's address (actor)
 * - Constructs payload in Pocketnet/Bastyon convention
 * - Invokes host action to sign and broadcast the transaction
 *
 * Payload shape:
 * {
 *   actor: string,
 *   address: { v: string }
 * }
 */
export async function followAddress(addressToFollow: string, opts: { private?: boolean } = {}): Promise<unknown> {
  if (!addressToFollow || typeof addressToFollow !== 'string')
    throw new Error('addressToFollow is required')

  // Verify action is supported inside Bastyon host
  if (!SdkService.supportsAction())
    throw new Error('Host does not support signed actions')

  // Ensure we can access account and sign
  await SdkService.checkAndRequestPermissions(['account', 'sign'])

  // Resolve actor (current user address)
  const actor = await SdkService.getAccountAddress()
  if (!actor)
    throw new Error('Unable to resolve current account address')

  // Build correct payload shape for follow (subscribe)
  const payload = {
    actor,
    address: { v: addressToFollow },
  }

  const method = opts?.private ? 'subscribePrivate' : 'subscribe'
  return await SdkService.action(method, payload)
}
