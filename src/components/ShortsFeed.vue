<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'

import HlsVideo from '~/components/HlsVideo.vue'
import PerfOverlay from '~/components/PerfOverlay.vue'
import LoadingSpinner from '~/components/LoadingSpinner.vue'
import { appConfig } from '~/config'
import { SdkService } from '~/composables'

interface PeertubeInfo { hlsUrl: string, apiUrl?: string }

interface VideoItem {
  description?: string
  uploader?: string
  duration?: number
  videoInfo?: { peertube?: PeertubeInfo }
  rawPost?: {
    peertube?: PeertubeInfo
    hashtags?: string[] | string
    description?: string
    title?: string
    caption?: string
    comments?: number
    video_hash?: string
    author_reputation?: number | string
  }
}

const items = ref<VideoItem[]>([])
const loading = ref(true)
const error = ref<string | null>(null)

const cardRefs = ref<(HTMLElement | null)[]>([])
const videoRefs = ref<any[]>([])
const currentIndex = ref(0)
const paused = ref(false)
const soundOn = ref(false)
const showOverlayIcon = ref(false)
let overlayHideTimer: number | null = null
const videoLoading = ref<boolean[]>([])
const progress = ref<{ currentTime: number, duration: number }[]>([])
const buffered = ref<{ ranges: { start: number, end: number }[], duration: number }[]>([])
// Scrubbing & tooltip state
const isScrubbing = ref(false)
const scrubIdx = ref<number | null>(null)
const scrubPct = ref(0)
const scrubRect = ref<DOMRect | null>(null)
const showTooltip = ref(false)
const tooltipIdx = ref<number | null>(null)
const tooltipPct = ref(0)

// Track playback state around opening the host post UI
const wasPlayingBeforeOpenPost = ref(false)

// Drawer state
const showDescriptionDrawer = ref(false)
const showCommentsDrawer = ref(false)
const showSettingsDrawer = ref(false)

// Playlist language selection
const LANGUAGE_STORAGE_KEY = 'bshorts.lang'
const availableLanguages = appConfig.languages
const selectedLanguage = ref<string>(
  (typeof localStorage !== 'undefined' && localStorage.getItem(LANGUAGE_STORAGE_KEY))
  || appConfig.defaultLanguage,
)
// Collapsible state for the Video Language section in Settings
const langOpen = ref(false)
// Collapsible state for the Playback section in Settings
const playbackOpen = ref(false)
// End behavior setting (what to do when a video ends)
const END_BEHAVIOR_STORAGE_KEY = 'bshorts.endBehavior'
type EndBehavior = 'replay' | 'next'
const endBehavior = ref<EndBehavior>(
  (typeof localStorage !== 'undefined' && (localStorage.getItem(END_BEHAVIOR_STORAGE_KEY) as EndBehavior))
  || 'next',
)
// Feedback UI state (Settings drawer)
const feedbackOpen = ref(false)
const feedbackText = ref('')
const feedbackSending = ref(false)
const feedbackStatus = ref<string | null>(null)
const feedbackError = ref<string | null>(null)

// Open developer's profile from the Settings drawer footer
function openDeveloperProfile(ev?: Event) {
  const url = (appConfig as any)?.developerProfileUrl
  if (typeof url === 'string' && url)
    void handleExternalLink(url, ev)
}

async function submitFeedback(ev?: Event) {
  if (ev)
    ev.preventDefault()
  const text = feedbackText.value.trim()
  if (!text || feedbackSending.value)
    return
  feedbackSending.value = true
  feedbackError.value = null
  feedbackStatus.value = null
  try {
    const res = await fetch('/api/feedback', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    })
    if (!res.ok) {
      const msg = await res.text().catch(() => '')
      throw new Error(msg || `HTTP ${res.status}`)
    }
    feedbackText.value = ''
    feedbackStatus.value = 'Thanks for your feedback!'
  }
  catch (e: any) {
    feedbackError.value = e?.message || 'Failed to save feedback'
  }
  finally {
    feedbackSending.value = false
  }
}

// Comments state (cache by post hash)
interface ReplyState { items: any[], loading: boolean, error: string | null }
interface CommentState {
  items: any[]
  loading: boolean
  error: string | null
  fetchedAt: number
  repliesById: Record<string, ReplyState>
  openRepliesById: Record<string, boolean>
}
const commentsByHash = ref<Record<string, CommentState>>({})

// Avatars cache (by address)
const avatarsByAddress = ref<Record<string, string>>({})
// Names cache (by address)
const namesByAddress = ref<Record<string, string>>({})
// Reputation caches
const reputationsByAddress = ref<Record<string, number>>({})
const addressByHash = ref<Record<string, string>>({})
const repLoadingByHash = ref<Record<string, boolean>>({})
const repErrorByHash = ref<Record<string, string | null>>({})
// Ban status cache (by address)
const banActiveByAddress = ref<Record<string, boolean>>({})

// Avatars readiness state per post hash (used by comments drawer)
const avatarsReadyByHash = ref<Record<string, boolean>>({})
const avatarsPreparingByHash = ref<Record<string, boolean>>({})

// Visible comments count per post hash and helper accessor
const visibleCountByHash = ref<Record<string, number>>({})
function getVisibleCount(hash: string): number {
  const n = visibleCountByHash.value[hash]
  return typeof n === 'number' && Number.isFinite(n) ? n : 0
}

// Follow state caches by address
const followedByAddress = ref<Record<string, boolean>>({})
const followLoadingByAddress = ref<Record<string, boolean>>({})
const followErrorByAddress = ref<Record<string, string | null>>({})

// Peertube metadata cache by item key
interface PeerMetaState { loading: boolean, error: string | null, views: number | null, publishedAt: string | null, fetchedAt: number }
const peerMetaByKey = ref<Record<string, PeerMetaState>>({})

// Check if an address currently has an active ban (cached). Uses getbans and compares ending to current block height.
async function isAddressBanned(addr?: string | null, currentHeight?: number): Promise<boolean> {
  if (!addr)
    return false
  if (banActiveByAddress.value[addr] != null)
    return !!banActiveByAddress.value[addr]
  try {
    // Fetch current height if not provided
    let height = currentHeight
    if (typeof height !== 'number' || !Number.isFinite(height)) {
      const hres: any = await SdkService.rpc('getblockcount', [])
      const n = typeof hres === 'number' ? hres : Number(hres)
      height = Number.isFinite(n) ? n : 0
    }
    const res: any = await SdkService.rpc('getbans', [addr])
    let active = false
    if (Array.isArray(res)) {
      for (const rec of res) {
        const ending = typeof rec?.ending === 'number' ? rec.ending : Number(rec?.ending)
        if (Number.isFinite(ending) && ending > (height || 0)) {
          active = true
          break
        }
      }
    }
    banActiveByAddress.value[addr] = active
    return active
  }
  catch {
    // On RPC failure, treat as not banned to avoid over-filtering
    banActiveByAddress.value[addr] = false
    return false
  }
}

// Filter out deleted posts and videos whose authors are currently banned
async function filterOutDeletedAndBannedItems(arr: any[]): Promise<any[]> {
  if (!Array.isArray(arr) || !arr.length)
    return arr
  // Get current height for ban comparison
  let height = 0
  try {
    const hres: any = await SdkService.rpc('getblockcount', [])
    const n = typeof hres === 'number' ? hres : Number(hres)
    height = Number.isFinite(n) ? n : 0
  }
  catch {}

  // Batch query content metadata to detect deletions and inline bans info
  const hashes = Array.from(new Set(
    arr.map((it: any) => it?.rawPost?.video_hash).filter((h: any) => typeof h === 'string' && !!h),
  )) as string[]
  const deletedByHash: Record<string, boolean> = {}
  const addrByHashLocal: Record<string, string> = {}
  try {
    if (hashes.length) {
      const res: any = await SdkService.rpc('getcontent', [hashes, ''])
      const list: any[] = Array.isArray(res) ? res : (Array.isArray(res?.data) ? res.data : [])
      for (const rec of list) {
        const h = (rec?.hash || rec?.video_hash || rec?.txid || rec?.id || '').toString()
        if (h)
          deletedByHash[h] = !!rec?.deleted
        const addr = rec?.address || rec?.Address || rec?.adr
        if (typeof addr === 'string' && addr) {
          addrByHashLocal[h] = addr
          if (!addressByHash.value[h])
            addressByHash.value[h] = addr
        }
        // If bans info present on the content record, compute active state now
        if (addr && rec?.bans && typeof rec.bans === 'object') {
          const endings = Object.values(rec.bans).map((v: any) => Number(v)).filter((v: any) => Number.isFinite(v))
          const active = endings.some((end: number) => end > (height || 0))
          if (active)
            banActiveByAddress.value[addr] = true
          else if (banActiveByAddress.value[addr] == null)
            banActiveByAddress.value[addr] = false
        }
      }
    }
  }
  catch {}

  // Fallback: check bans for any addresses without a known status
  const addrsToCheck = new Set<string>()
  for (const it of arr as any[]) {
    const hash = it?.rawPost?.video_hash
    const direct = getAuthorAddress(it)
    const addr = direct || (hash ? (addrByHashLocal[hash] || addressByHash.value[hash]) : null)
    if (addr && banActiveByAddress.value[addr] == null)
      addrsToCheck.add(addr)
  }
  if (addrsToCheck.size)
    await Promise.all(Array.from(addrsToCheck).map(a => isAddressBanned(a, height)))

  // Finally filter
  return arr.filter((it: any) => {
    const hash = it?.rawPost?.video_hash
    if (hash && deletedByHash[hash])
      return false
    const direct = getAuthorAddress(it)
    const addr = direct || (hash ? (addrByHashLocal[hash] || addressByHash.value[hash]) : null)
    if (addr && banActiveByAddress.value[addr])
      return false
    return true
  })
}

// Descriptions cache (by post hash)
interface DescState { text: string, caption?: string, loading: boolean, error: string | null, fetchedAt: number }
const descriptionsByHash = ref<Record<string, DescState>>({})

// Ensure we know the author address for a given hash (without fetching reputation)
async function ensureAuthorAddressByHash(hash: string): Promise<string | null> {
  if (!hash)
    return null
  if (addressByHash.value[hash])
    return addressByHash.value[hash]
  // Prefer using local JSON item data first (rawPost.author_address) before falling back to RPC
  try {
    const it = items.value.find((x: any) => x?.rawPost?.video_hash === hash) as any
    const localAddr = it ? getAuthorAddress(it) : null
    if (typeof localAddr === 'string' && localAddr) {
      addressByHash.value[hash] = localAddr
      return localAddr
    }
  }
  catch {}
  try {
    const res: any = await SdkService.rpc('getcontent', [[hash], ''])
    if (Array.isArray(res) && res.length > 0) {
      const rec = res[0]
      const a = rec?.address || rec?.Address || rec?.adr
      if (typeof a === 'string' && a) {
        addressByHash.value[hash] = a
        return a
      }
    }
  }
  catch {}
  return null
}

// Preload an image URL and resolve when loaded (or after a short timeout)
function preloadImage(url: string, timeoutMs = 5000): Promise<void> {
  return new Promise((resolve) => {
    if (!url) {
      resolve()
      return
    }
    const img = new Image()
    let done = false
    const finish = () => {
      if (!done) {
        done = true
        resolve()
      }
    }
    const to = setTimeout(finish, timeoutMs)
    img.onload = () => {
      clearTimeout(to)
      finish()
    }
    img.onerror = () => {
      clearTimeout(to)
      finish()
    }
    img.src = url
  })
}

// Build addresses set for a given hash (author + first visible commenters)
function collectAddressesForHash(hash: string): Set<string> {
  const addrs = new Set<string>()
  // Author by item or cached address
  const it = items.value.find((x: any) => x?.rawPost?.video_hash === hash) as any
  const a0 = it ? getAuthorAddress(it) : null
  if (a0)
    addrs.add(a0)
  const cachedAddr = addressByHash.value[hash]
  if (cachedAddr)
    addrs.add(cachedAddr)
  // Visible commenters
  const st = commentsByHash.value[hash]
  const vis = Math.min(getVisibleCount(hash), st?.items?.length || 0)
  for (let i = 0; i < vis; i++) {
    const c = st?.items?.[i]
    const a = resolveCommentAddress(c)
    if (a)
      addrs.add(a)
    // If replies are open for this comment, include their authors as well
    try {
      const id = resolveCommentId(c)
      if (id && st?.openRepliesById?.[id]) {
        const rs = st?.repliesById?.[id]
        const arr = rs?.items || []
        for (const rc of arr) {
          const ra = resolveCommentAddress(rc)
          if (ra)
            addrs.add(ra)
        }
      }
    }
    catch {}
  }
  return addrs
}

// Prepare and wait until avatars for current visible comments (and author) are loaded
async function ensureAvatarsReadyForHash(hash: string) {
  if (!hash)
    return
  if (avatarsReadyByHash.value[hash] || avatarsPreparingByHash.value[hash])
    return
  avatarsPreparingByHash.value[hash] = true
  try {
    const addrs = collectAddressesForHash(hash)
    // Ensure profile URLs are fetched
    await fetchProfiles(addrs)
    await nextTick()
    // Gather URLs and preload images
    const urls: string[] = []
    for (const a of addrs) {
      const u = avatarsByAddress.value[a]
      if (u)
        urls.push(u)
    }
    await Promise.all(urls.map(u => preloadImage(u)))
    avatarsReadyByHash.value[hash] = true
  }
  finally {
    avatarsPreparingByHash.value[hash] = false
  }
}

// Helper: resolve author address of a video item
function getAuthorAddress(it: any): string | null {
  return (
    it?.rawPost?.author_address
    ?? it?.uploaderAddress
    ?? null
  )
}

// Helper: resolve author address using item or cached mapping by hash
function getResolvedAuthorAddress(it: any): string | null {
  const direct = getAuthorAddress(it)
  if (direct)
    return direct
  const hash = it?.rawPost?.video_hash
  if (hash)
    return addressByHash.value[hash] || null
  return null
}

// Helper: resolve address from a comment object (be tolerant to shapes)
function resolveCommentAddress(c: any): string | null {
  if (!c || typeof c !== 'object')
    return null
  // common fields observed in Bastyon
  const direct = c.address || c.a || c.adr || c.addr
  if (typeof direct === 'string' && direct)
    return direct
  if (c.author && typeof c.author === 'object') {
    const aa = c.author.address || c.author.a || c.author.adr
    if (typeof aa === 'string' && aa)
      return aa
  }
  if (c.account && typeof c.account === 'object') {
    const aa = c.account.address || c.account.a || c.account.adr
    if (typeof aa === 'string' && aa)
      return aa
  }
  // last resort: scan values
  for (const v of Object.values(c)) {
    if (v && typeof v === 'object') {
      const aa = (v as any).address || (v as any).a || (v as any).adr
      if (typeof aa === 'string' && aa)
        return aa
    }
  }
  return null
}

function getAddressAvatar(address?: string | null): string {
  if (!address)
    return ''
  return avatarsByAddress.value[address] || ''
}

// Helper mappers for template
function authorAvatarFor(it: any): string {
  return getAddressAvatar(getAuthorAddress(it))
}
function commentAvatarFor(c: any): string {
  return getAddressAvatar(resolveCommentAddress(c))
}

// Resolve author display name: prefer inline uploader, then cached profile name, then short address
function authorNameFor(it: any): string {
  const direct = (it?.uploader || (it?.rawPost as any)?.uploader || (it as any)?.author_name)
  if (typeof direct === 'string' && direct.trim())
    return direct.trim()
  const addr = getResolvedAuthorAddress(it)
  const cached = addr ? namesByAddress.value[addr] : ''
  if (cached)
    return cached
  return shortAddress(addr) || 'Unknown'
}

function isAddressFollowed(addr?: string | null): boolean {
  return !!(addr && followedByAddress.value[addr])
}

function isAuthorFollowed(it: any): boolean {
  const addr = getResolvedAuthorAddress(it)
  return isAddressFollowed(addr)
}

function isFollowLoading(it: any): boolean {
  const addr = getResolvedAuthorAddress(it)
  return !!(addr && followLoadingByAddress.value[addr])
}

function followBtnLabel(it: any): string {
  if (isFollowLoading(it))
    return 'Following…'
  return isAuthorFollowed(it) ? 'Following' : 'Follow'
}

async function followAuthor(it: any) {
  let resolvedAddr: string | null = null
  try {
    resolvedAddr = getAuthorAddress(it)
    // Fallback: resolve from hash when needed
    if (!resolvedAddr) {
      const hash = it?.rawPost?.video_hash
      resolvedAddr = await ensureAuthorAddressByHash(hash)
    }
    if (!resolvedAddr)
      throw new Error('author address not found')

    if (followLoadingByAddress.value[resolvedAddr])
      return

    followErrorByAddress.value[resolvedAddr] = null
    followLoadingByAddress.value[resolvedAddr] = true

    // New flow: build unsigned subscribe tx locally, sign and broadcast via RPC
    try {
      await SdkService.checkAndRequestPermissions(['account', 'sign'])

      // Fetch current user's address for inputs/change
      const spendAddress = await SdkService.getAccountAddress()

      // Prepare a minimal rpc adapter compatible with the tx builder expectations
      const rpc = {
        call: async (method: string, params?: any) => {
          const arr = Array.isArray(params) ? params : (params !== undefined ? [params] : [])
          return await SdkService.rpc(method, arr)
        },
      }

      // Dynamic import of local CommonJS builder
      const pntx: any = await import('pntx')
      const createUnsignedSubscribeTxFromAddress = pntx.createUnsignedSubscribeTxFromAddress || pntx?.default?.createUnsignedSubscribeTxFromAddress
      const NETWORK = pntx.POCKETNET_MAINNET || pntx?.default?.POCKETNET_MAINNET
      if (typeof createUnsignedSubscribeTxFromAddress !== 'function')
        throw new Error('createUnsignedSubscribeTxFromAddress not available')

      if (import.meta?.env?.VITE_SDK_DEBUG)
        console.debug('[follow] building unsigned subscribe tx', { to: resolvedAddr, from: spendAddress })

      const unsignedRes = await createUnsignedSubscribeTxFromAddress({
        rpc,
        spendAddress,
        changeAddress: spendAddress,
        addressToFollow: resolvedAddr,
        network: NETWORK,
      })

      const unsignedHex: string = unsignedRes?.hex
      if (typeof unsignedHex !== 'string' || !unsignedHex)
        throw new Error('Failed to build unsigned transaction')

      if (import.meta?.env?.VITE_SDK_DEBUG)
        console.debug('[follow] signing unsigned tx')

      const signedHex: string = await SdkService.sign(unsignedHex)

      if (import.meta?.env?.VITE_SDK_DEBUG)
        console.debug('[follow] broadcasting signed tx')

      const sendRes: any = await SdkService.rpc('sendrawtransaction', [signedHex])
      if (import.meta?.env?.VITE_SDK_DEBUG)
        console.debug('[follow] broadcast result', sendRes)

      // Success
      followedByAddress.value[resolvedAddr] = true
      return
    }
    catch (err) {
      console.warn('Subscribe via tx builder failed, falling back to channel UI:', err)
      // Fall through to deep-link UI
    }

    // Next fallback: use host action() if available (lets Bastyon wallet perform the subscribe)
    try {
      if (SdkService.supportsAction()) {
        if (import.meta?.env?.VITE_SDK_DEBUG)
          console.debug('[follow] using host action(subscribe)')
        await SdkService.action('subscribe', { address: resolvedAddr })
        // Success
        followedByAddress.value[resolvedAddr] = true
        return
      }
    }
    catch (e) {
      console.warn('Host action(subscribe) failed:', e)
      // continue to final fallback
    }

    // Final fallback: open the author's channel so the user can follow from native UI
    await SdkService.openChannel(resolvedAddr)
  }
  catch (e: any) {
    let msg: string
    if (e instanceof Error && e.message) {
      msg = e.message
    }
    else if (typeof e === 'object') {
      try {
        msg = JSON.stringify(e)
      }
      catch {
        msg = String(e)
      }
    }
    else {
      msg = String(e)
    }
    if (resolvedAddr)
      followErrorByAddress.value[resolvedAddr] = msg
    console.error('Follow failed:', e)
  }
  finally {
    if (resolvedAddr)
      followLoadingByAddress.value[resolvedAddr] = false
  }
}

// Open the author's channel/profile UI (used on avatar/name click)
async function openAuthorChannel(it: any) {
  try {
    let addr = getAuthorAddress(it)
    if (!addr) {
      const hash = it?.rawPost?.video_hash
      addr = hash ? await ensureAuthorAddressByHash(hash) : null
    }
    if (!addr)
      return
    await SdkService.openChannel(addr)
  }
  catch (e) {
    console.error('Open channel failed:', e)
  }
}

function shortAddress(addr?: string | null): string {
  if (!addr)
    return ''
  if (addr.length <= 12)
    return addr
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`
}

function commentNameFor(c: any): string {
  // prefer explicit fields on the comment object
  const direct = c?.name || c?.user?.name || c?.author?.name || c?.account?.name
  if (typeof direct === 'string' && direct.trim())
    return direct.trim()
  // fall back to profile cache
  const addr = resolveCommentAddress(c)
  const cached = addr ? namesByAddress.value[addr] : ''
  if (cached)
    return cached
  return shortAddress(addr) || 'Unknown'
}

// Author reputation helpers
function getAuthorReputation(it: any): number | null {
  // 1) Prefer RPC-cached reputation by address
  const hash = it?.rawPost?.video_hash
  const addr = getAuthorAddress(it)
    || (hash ? addressByHash.value[hash] : null)
  if (addr && reputationsByAddress.value[addr] != null)
    return Math.round(reputationsByAddress.value[addr])

  // Proactively fetch if we have a hash but no cached rep yet
  if (hash && !repLoadingByHash.value[hash] && !repErrorByHash.value[hash])
    void fetchAuthorReputationByHash(hash)

  // 2) Fallback to inline JSON (legacy)
  const v = (
    it?.rawPost?.author_reputation
    ?? (it as any)?.author_reputation
    ?? null
  )
  if (v != null) {
    const n = typeof v === 'string' ? Number(v) : v
    if (Number.isFinite(n))
      return Math.round(n)
  }

  return null
}

function formatReputation(n: number): string {
  const abs = Math.abs(n)
  const trim = (v: number) => {
    const s = v.toFixed(1)
    return s.endsWith('.0') ? s.slice(0, -2) : s
  }
  if (abs >= 1_000_000_000)
    return `${trim(n / 1_000_000_000)}b`
  if (abs >= 1_000_000)
    return `${trim(n / 1_000_000)}m`
  if (abs >= 1_000)
    return `${trim(n / 1_000)}k`
  return String(n)
}

// Generic count formatter for views
function formatCount(n: number): string {
  const abs = Math.abs(n)
  const trim = (v: number) => {
    const s = v.toFixed(1)
    return s.endsWith('.0') ? s.slice(0, -2) : s
  }
  if (abs >= 1_000_000_000)
    return `${trim(n / 1_000_000_000)}b`
  if (abs >= 1_000_000)
    return `${trim(n / 1_000_000)}m`
  if (abs >= 1_000)
    return `${trim(n / 1_000)}k`
  return String(n)
}

// New: format an ISO string or epoch milliseconds into a full date like "15 June 2024"
function formatFullDate(input?: string | number | null): string {
  if (input == null || input === '')
    return ''
  let timeMs: number | null = null
  if (typeof input === 'number') {
    timeMs = Number.isFinite(input) ? input : null
  }
  else if (typeof input === 'string') {
    const maybeNum = Number(input)
    if (Number.isFinite(maybeNum) && input.trim() !== '') {
      timeMs = maybeNum
    }
    else {
      const t = Date.parse(input)
      timeMs = Number.isFinite(t) ? t : null
    }
  }
  if (timeMs == null)
    return ''
  const d = new Date(timeMs)
  if (Number.isNaN(d.getTime()))
    return ''
  // Use user's locale if available
  const fmt = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'long', year: 'numeric' })
  return fmt.format(d)
}

// Extract a best-effort timestamp (ms) from a comment/reply object
function getCommentTimestampMs(c: any): number | null {
  if (!c || typeof c !== 'object')
    return null
  const fields = ['time', 'timestamp', 'ts', 'created', 'createdAt', 'date', 'publishedAt', 'posted', 'when']
  for (const f of fields) {
    const v: any = (c as any)[f]
    if (v == null)
      continue
    if (typeof v === 'number') {
      // Heuristic: values < 1e12 are likely seconds
      const ms = v < 1e12 ? (v * 1000) : v
      if (Number.isFinite(ms))
        return ms
    }
    else if (typeof v === 'string') {
      const trimmed = v.trim()
      if (!trimmed)
        continue
      const asNum = Number(trimmed)
      if (Number.isFinite(asNum)) {
        const ms = asNum < 1e12 ? (asNum * 1000) : asNum
        if (Number.isFinite(ms))
          return ms
      }
      const t = Date.parse(trimmed)
      if (Number.isFinite(t))
        return t
    }
  }
  // Fallback: nested common containers
  const containers = ['comment', 'data']
  for (const key of containers) {
    const v = (c as any)[key]
    if (v && typeof v === 'object') {
      const nested = getCommentTimestampMs(v)
      if (nested != null)
        return nested
    }
  }
  return null
}

function commentDateFor(c: any): string {
  const ms = getCommentTimestampMs(c)
  return ms != null ? formatFullDate(ms) : ''
}

// Fetch author address (if needed) and reputation for a given content hash
async function fetchAuthorReputationByHash(hash: string) {
  if (!hash)
    return
  if (repLoadingByHash.value[hash])
    return
  repLoadingByHash.value[hash] = true
  repErrorByHash.value[hash] = null
  try {
    // Resolve address from cache or via getcontent
    let addr = addressByHash.value[hash]
    // Try to use current item if it matches this hash
    if (!addr) {
      const itLocal = items.value[currentIndex.value] as any
      if (itLocal?.rawPost?.video_hash === hash) {
        const a0 = getAuthorAddress(itLocal)
        if (a0)
          addr = a0
      }
    }
    if (!addr) {
      const res: any = await SdkService.rpc('getcontent', [[hash], ''])
      if (Array.isArray(res) && res.length > 0) {
        const rec = res[0]
        const a = rec?.address || rec?.Address || rec?.adr
        if (typeof a === 'string' && a) {
          addr = a
          addressByHash.value[hash] = a
        }
      }
    }

    if (!addr)
      throw new Error('author address not found')

    // Reputation cache hit?
    if (reputationsByAddress.value[addr] != null)
      return

    // Ensure we also fetch profile (name/avatar) if missing
    if (!(avatarsByAddress.value[addr] && namesByAddress.value[addr]))
      await fetchProfiles(new Set([addr]))

    // Fetch reputation
    const st: any = await SdkService.rpc('getuserstate', [addr])
    const rep = typeof st?.reputation === 'number'
      ? st.reputation
      : typeof st?.reputation === 'string'
        ? Number(st.reputation)
        : null
    if (rep != null && Number.isFinite(rep))
      reputationsByAddress.value[addr] = Math.round(rep)
  }
  catch (e: any) {
    repErrorByHash.value[hash] = e?.message || String(e)
  }
  finally {
    repLoadingByHash.value[hash] = false
  }
}

// Batch fetch profiles and cache avatar URLs by address
async function fetchProfiles(addresses: Set<string>) {
  const todo = Array.from(addresses).filter(a => a && !(avatarsByAddress.value[a] && namesByAddress.value[a]))
  if (todo.length === 0)
    return

  const chunkSize = 70
  for (let i = 0; i < todo.length; i += chunkSize) {
    const chunk = todo.slice(i, i + chunkSize)
    try {
      const params: any[] = [chunk, '1'] // '1' => light profile
      const res: unknown = await SdkService.rpc('getuserprofile', params)
      console.log('getuserprofile:', res)
      if (Array.isArray(res)) {
        for (const p of res) {
          const addr = p?.address
          const url = p?.image || p?.i || p?.avatar_url || ''
          if (addr && url && !avatarsByAddress.value[addr])
            avatarsByAddress.value[addr] = url
          const pname = (p as any)?.name || (p as any)?.n || (p as any)?.nickname || (p as any)?.nick || (p as any)?.profile?.name
          if (addr && typeof pname === 'string' && pname.trim() && !namesByAddress.value[addr])
            namesByAddress.value[addr] = String(pname).trim()
        }
      }
    }
    catch (e) {
      // swallow errors per-chunk; avatars are non-critical
      // console.warn('avatar fetch failed', e)
    }
  }
}

// Collect current author + commenters addresses
function collectAddressesForCurrent(): Set<string> {
  const addrs = new Set<string>()
  const itLocal = items.value[currentIndex.value] as any
  const h = itLocal?.rawPost?.video_hash ?? null
  const st = h ? commentsByHash.value[h] : undefined
  const author = getAuthorAddress(itLocal)
  if (author)
    addrs.add(author)
  const commentItems = st?.items || []
  for (const c of commentItems) {
    const a = resolveCommentAddress(c)
    if (a)
      addrs.add(a)
  }
  return addrs
}

const currentVideoHash = computed<string | null>(() => {
  const it = items.value[currentIndex.value] as any
  return it?.rawPost?.video_hash ?? null
})

// Fetch author reputation whenever the current video changes
watch(currentVideoHash, (h) => {
  if (h)
    void fetchAuthorReputationByHash(h)
})

onMounted(() => {
  const h = currentVideoHash.value
  if (h)
    void fetchAuthorReputationByHash(h)
})

const currentComments = computed<CommentState | undefined>(() => {
  const h = currentVideoHash.value
  return h ? commentsByHash.value[h] : undefined
})

const avatarsReadyForCurrent = computed<boolean>(() => {
  const h = currentVideoHash.value
  return !!(h && avatarsReadyByHash.value[h])
})

// (moved up) visibleCountByHash and getVisibleCount declared earlier

const currentVisibleComments = computed<any[]>(() => {
  const h = currentVideoHash.value
  if (!h)
    return []
  const st = commentsByHash.value[h]
  if (!st?.items)
    return []
  return st.items.slice(0, getVisibleCount(h))
})

function onCommentsScroll(ev: Event) {
  const el = ev.target as HTMLElement | null
  if (!el)
    return
  const bottomGap = el.scrollHeight - (el.scrollTop + el.clientHeight)
  if (bottomGap <= 120) {
    const h = currentVideoHash.value
    if (h) {
      const st = commentsByHash.value[h]
      if (st?.items?.length && getVisibleCount(h) < st.items.length)
        visibleCountByHash.value[h] = Math.min(st.items.length, getVisibleCount(h) + 10)
      // As more comments become visible, prepare their avatars in the background
      void ensureAvatarsReadyForHash(h)
    }
  }
}

function ensureCommentState(hash: string): CommentState {
  if (!commentsByHash.value[hash])
    commentsByHash.value[hash] = { items: [], loading: false, error: null, fetchedAt: 0, repliesById: {}, openRepliesById: {} }
  return commentsByHash.value[hash]
}

function getCommentText(c: any): string {
  if (c == null)
    return ''
  // String case: if looks like JSON, parse and recurse; otherwise return trimmed
  if (typeof c === 'string') {
    const s = c.trim()
    // Always attempt to parse JSON; fall back to raw text if parsing fails
    try {
      const obj = JSON.parse(s)
      const t = getCommentText(obj)
      if (t)
        return t
    }
    catch {}
    // If it looks like a JSON blob but failed to parse, try extracting common fields via regex
    if (s.startsWith('{') && s.includes('"')) {
      // Match JSON-like strings and extract common text fields; avoid unnecessary escapes
      const re = /"(msg|message|text|body|caption|Description)"\s*:\s*"((?:\\.|[^"\\])*)"/i
      const m = s.match(re)
      if (m && m[2] != null) {
        const unescaped = m[2]
          .replace(/\\n/g, '\n')
          .replace(/\\r/g, '\r')
          .replace(/\\t/g, '\t')
          .replace(/\\"/g, '"')
        const trimmed = unescaped.trim()
        if (trimmed)
          return trimmed
      }
    }
    return s
  }
  // Array case: return first non-empty extracted text
  if (Array.isArray(c)) {
    for (const el of c) {
      const t = getCommentText(el)
      if (t)
        return t
    }
    return ''
  }
  // Object case: check likely fields, then nested containers
  if (typeof c === 'object') {
    const fields = ['msg', 'message', 'text', 'body', 'content', 'value', 'Description', 'caption']
    for (const f of fields) {
      const v = (c as any)[f]
      if (v != null) {
        const t = getCommentText(v)
        if (t)
          return t
      }
    }
    for (const nested of ['comment', 'data']) {
      const v = (c as any)[nested]
      if (v != null) {
        const t = getCommentText(v)
        if (t)
          return t
      }
    }
    // Fallback: scan all values for the first meaningful string
    for (const v of Object.values(c)) {
      const t = getCommentText(v as any)
      if (t)
        return t
    }
  }
  return ''
}

async function fetchCommentsFor(hash: string, { force = false }: { force?: boolean } = {}) {
  const state = ensureCommentState(hash)
  if (state.loading)
    return
  if (!force && state.items.length > 0 && !state.error)
    return
  state.loading = true
  state.error = null
  try {
    const res: any = await SdkService.rpc('getcomments', [hash, '', ''])
    console.log('rpc.getcomments results', res)
    let items: any[] = []
    if (Array.isArray(res))
      items = res
    else if (res?.comments && Array.isArray(res.comments))
      items = res.comments
    else if (res?.result && Array.isArray(res.result))
      items = res.result
    else if (res?.data && Array.isArray(res.data))
      items = res.data
    // Sort comments by (scoreUp - scoreDown) descending on first load
    const sorted = items.slice().sort((a, b) => {
      const as = (Number(a?.scoreUp) || 0) - (Number(a?.scoreDown) || 0)
      const bs = (Number(b?.scoreUp) || 0) - (Number(b?.scoreDown) || 0)
      return bs - as
    })
    state.items = sorted
    state.fetchedAt = Date.now()
    if (!visibleCountByHash.value[hash])
      visibleCountByHash.value[hash] = Math.min(10, state.items.length || 10)
    // Start preparing avatars for current visible set
    void ensureAvatarsReadyForHash(hash)
  }
  catch (e: any) {
    state.error = e?.message || String(e)
  }
  finally {
    state.loading = false
  }
}

// ----- Replies helpers -----
function resolveCommentId(c: any): string | null {
  if (!c || typeof c !== 'object')
    return null
  const direct = c.commentid || c.comment_id || c.cid || c.id || c.txid || c.hash || c.rhash
  if (typeof direct === 'string' && direct)
    return direct
  // nested possibilities
  const nested = (c.comment || c.data || c.meta || {}) as any
  const nd = nested.commentid || nested.comment_id || nested.id || nested.txid || nested.hash
  if (typeof nd === 'string' && nd)
    return nd
  return null
}

function hasInlineReplies(c: any): boolean {
  return Array.isArray((c as any)?.replies)
    || Array.isArray((c as any)?.children)
    || Array.isArray((c as any)?.items)
}

function getInlineReplies(c: any): any[] {
  const a = (c as any)?.replies
  if (Array.isArray(a))
    return a
  const b = (c as any)?.children
  if (Array.isArray(b))
    return b
  const d = (c as any)?.items
  if (Array.isArray(d))
    return d
  return []
}

function getReplyCount(c: any): number {
  // Prefer explicit counts
  const fields = ['reply_count', 'repliesCount', 'repliescount', 'commentcnt', 'childrenCount', 'children']
  for (const f of fields) {
    const v = (c as any)?.[f]
    const n = typeof v === 'string' ? Number(v) : v
    if (Number.isFinite(n) && n! >= 0)
      return Number(n)
  }
  // Fallback to inline replies length, if present
  const arr = getInlineReplies(c)
  if (Array.isArray(arr))
    return arr.length
  return 0
}

// Returns any known replies count for a comment: explicit field, inline array length, or fetched cache length
function getKnownReplyCount(c: any): number {
  const n = getReplyCount(c)
  if (n > 0)
    return n
  // If not inline and we have fetched replies, use cached length
  if (!hasInlineReplies(c)) {
    const h = currentVideoHash.value
    const id = resolveCommentId(c)
    if (h && id) {
      const rs = commentsByHash.value[h]?.repliesById?.[id]
      const len = rs?.items?.length || 0
      if (len > 0)
        return len
    }
  }
  return 0
}

// Show toggle if replies are open (to allow hiding) or if we know there are replies to show
function shouldShowRepliesToggle(c: any): boolean {
  if (isRepliesOpen(c))
    return true
  return getKnownReplyCount(c) > 0
}

async function fetchRepliesFor(hash: string, parentId: string): Promise<any[]> {
  const st = ensureCommentState(hash)
  if (!st.repliesById[parentId])
    st.repliesById[parentId] = { items: [], loading: false, error: null }
  const rs = st.repliesById[parentId]
  if (rs.loading)
    return rs.items
  if (rs.items.length)
    return rs.items
  rs.loading = true
  rs.error = null
  try {
    if (import.meta?.env?.VITE_SDK_DEBUG)
      console.debug('[replies] fetchRepliesFor(): start', { hash, parentId })
    // getcomments supports parent comment id as the 2nd param (fallback-friendly)
    const res: any = await SdkService.rpc('getcomments', [hash, parentId, ''])
    let items: any[] = []
    if (Array.isArray(res))
      items = res
    else if (res?.comments && Array.isArray(res.comments))
      items = res.comments
    else if (res?.result && Array.isArray(res.result))
      items = res.result
    else if (res?.data && Array.isArray(res.data))
      items = res.data
    rs.items = items
    if (import.meta?.env?.VITE_SDK_DEBUG)
      console.debug('[replies] fetchRepliesFor(): fetched', { parentId, count: items.length })
    // proactively fetch avatars for reply authors
    const addrs = new Set<string>()
    for (const c of items) {
      const a = resolveCommentAddress(c)
      if (a)
        addrs.add(a)
    }
    if (addrs.size)
      await fetchProfiles(addrs)
    return rs.items
  }
  catch (e: any) {
    rs.error = e?.message || String(e)
    if (import.meta?.env?.VITE_SDK_DEBUG)
      console.warn('[replies] fetchRepliesFor(): error', { parentId, error: rs.error })
    return []
  }
  finally {
    rs.loading = false
    if (import.meta?.env?.VITE_SDK_DEBUG)
      console.debug('[replies] fetchRepliesFor(): done', { parentId })
  }
}

async function toggleRepliesForComment(c: any) {
  const hash = currentVideoHash.value
  if (!hash)
    return
  const id = resolveCommentId(c)
  if (!id)
    return
  const st = ensureCommentState(hash)
  const willOpen = !st.openRepliesById[id]
  st.openRepliesById[id] = willOpen
  if (import.meta?.env?.VITE_SDK_DEBUG)
    console.debug('[replies] toggleRepliesForComment()', { id, willOpen })
  if (willOpen) {
    // If replies are not inline on the comment, fetch them
    if (!hasInlineReplies(c))
      void fetchRepliesFor(hash, id)
    // ensure avatars ready keeps up as replies open
    void ensureAvatarsReadyForHash(hash)
  }
}

function isRepliesOpen(c: any): boolean {
  const h = currentVideoHash.value
  if (!h)
    return false
  const id = resolveCommentId(c)
  if (!id)
    return false
  return !!commentsByHash.value[h]?.openRepliesById[id]
}

function repliesListFor(c: any): any[] {
  if (hasInlineReplies(c))
    return getInlineReplies(c)
  const h = currentVideoHash.value
  if (!h)
    return []
  const id = resolveCommentId(c)
  if (!id)
    return []
  return commentsByHash.value[h]?.repliesById[id]?.items || []
}

function repliesLoading(c: any): boolean {
  if (hasInlineReplies(c))
    return false
  const h = currentVideoHash.value
  const id = resolveCommentId(c)
  if (!h || !id)
    return false
  return !!commentsByHash.value[h]?.repliesById[id]?.loading
}

function repliesError(c: any): string | null {
  if (hasInlineReplies(c))
    return null
  const h = currentVideoHash.value
  const id = resolveCommentId(c)
  if (!h || !id)
    return null
  return commentsByHash.value[h]?.repliesById[id]?.error || null
}

function fetchCommentsForCurrentIfNeeded() {
  const h = currentVideoHash.value
  if (!h)
    return
  void fetchCommentsFor(h)
}

function refreshComments() {
  const h = currentVideoHash.value
  if (!h)
    return
  void fetchCommentsFor(h, { force: true })
}

function refreshDescription() {
  const h = currentVideoHash.value
  if (!h)
    return
  void fetchDescriptionFor(h, { force: true })
}

// Load comments when opening the drawer or switching videos while open
watch(showCommentsDrawer, (open) => {
  if (open)
    fetchCommentsForCurrentIfNeeded()
  if (open) {
    const h = currentVideoHash.value
    if (h && !visibleCountByHash.value[h])
      visibleCountByHash.value[h] = 10
    if (h)
      void ensureAvatarsReadyForHash(h)
  }
})
// Prefetch description on video change and when opening the desc drawer
watch(currentVideoHash, (h) => {
  if (h)
    void fetchDescriptionFor(h)
})
watch(showDescriptionDrawer, (open) => {
  if (open) {
    const h = currentVideoHash.value
    if (h)
      void fetchDescriptionFor(h)
  }
})
watch(currentIndex, () => {
  if (showCommentsDrawer.value)
    fetchCommentsForCurrentIfNeeded()
  if (showCommentsDrawer.value) {
    const h = currentVideoHash.value
    if (h && !visibleCountByHash.value[h])
      visibleCountByHash.value[h] = 10
  }
})

// Avatar fetch triggers
watch(items, (arr) => {
  if (Array.isArray(arr) && arr.length)
    void fetchProfiles(collectAddressesForCurrent())
})
watch(currentIndex, async () => {
  // Ensure current visible avatars
  void fetchProfiles(collectAddressesForCurrent())
  const h = currentVideoHash.value
  if (h)
    void ensureAvatarsReadyForHash(h)
  // Preload next post's author avatar
  const ni = currentIndex.value + 1
  const next = items.value[ni] as any
  if (next) {
    const nHash = next?.rawPost?.video_hash ?? null
    let addr = getAuthorAddress(next)
    if (!addr && nHash)
      addr = addressByHash.value[nHash] || await ensureAuthorAddressByHash(nHash)
    if (addr) {
      await fetchProfiles(new Set([addr]))
      const url = avatarsByAddress.value[addr]
      if (url)
        void preloadImage(url)
    }
  }
})
watch(showCommentsDrawer, (open) => {
  if (open)
    void fetchProfiles(collectAddressesForCurrent())
})
watch(() => currentComments.value?.items, () => {
  void fetchProfiles(collectAddressesForCurrent())
  const h = currentVideoHash.value
  if (h && showCommentsDrawer.value)
    void ensureAvatarsReadyForHash(h)
})

// Drawer drag-to-close state
const draggingWhich = ref<'desc' | 'comments' | null>(null)
const descDragOffset = ref(0)
const commentsDragOffset = ref(0)
let drawerDragStartY = 0
let drawerStartedOnHeader = false
let drawerBodyWasAtTop = false

// Current item helpers
const currentItem = computed(() => items.value[currentIndex.value] || null)

function getCaption(it: any): string {
  return (
    it?.rawPost?.caption
    ?? it?.rawPost?.title
    ?? it?.caption
    ?? it?.title
    ?? ''
  )
}
function getDescription(it: any): string {
  return (
    it?.rawPost?.description
    ?? it?.description
    ?? ''
  )
}

// Helpers for overlay preview: prefer cached RPC caption/description
function getItemHash(it: any): string | null {
  return (it as any)?.rawPost?.video_hash ?? null
}
function getCachedDescStateByItem(it: any): DescState | undefined {
  const h = getItemHash(it)
  return h ? descriptionsByHash.value[h] : undefined
}
function getCaptionForItem(it: any): string {
  const st = getCachedDescStateByItem(it)
  return (st?.caption && st.caption.trim()) ? st.caption : getCaption(it)
}
function getDescForItem(it: any): string {
  const st = getCachedDescStateByItem(it)
  return (st?.text && st.text.trim()) ? st.text : getDescription(it)
}
function truncate(str: string, maxLen = 140): string {
  const s = (str || '').trim()
  if (s.length <= maxLen)
    return s
  return `${s.slice(0, Math.max(0, maxLen - 1)).trimEnd()}…`
}
function overlayPreviewFor(it: any): string {
  const cap = getCaptionForItem(it)
  const desc = getDescForItem(it)
  const joined = [cap, desc].filter(Boolean).join(' — ')
  return truncate(joined, 160)
}

// Description fetching and cache helpers
function ensureDescState(hash: string): DescState {
  if (!descriptionsByHash.value[hash])
    descriptionsByHash.value[hash] = { text: '', caption: '', loading: false, error: null, fetchedAt: 0 }
  return descriptionsByHash.value[hash]
}

async function fetchDescriptionFor(hash: string, { force = false }: { force?: boolean } = {}) {
  if (!hash)
    return
  const st = ensureDescState(hash)
  if (st.loading)
    return
  if (!force && st.text && !st.error)
    return
  st.loading = true
  st.error = null
  try {
    const res: any = await SdkService.rpc('getcontent', [[hash], ''])
    let text = ''
    let caption = ''
    const arr: any[] = Array.isArray(res) ? res : (Array.isArray(res?.data) ? res.data : [])
    if (arr.length > 0) {
      const rec = arr[0]
      // m: description/message, c: caption/title per Bastyon compact fields
      caption = rec?.c || rec?.caption || rec?.title || ''
      text = (
        rec?.m
        || rec?.description
        || rec?.desc
        || getCommentText(rec?.msg)
        || getCommentText(rec?.message)
        || getCommentText(rec?.data)
        || getCommentText(rec?.body)
        || ''
      )
    }
    st.text = typeof text === 'string' ? text : ''
    st.caption = typeof caption === 'string' ? caption : ''
    st.fetchedAt = Date.now()
  }
  catch (e: any) {
    st.error = e?.message || String(e)
  }
  finally {
    st.loading = false
  }
}
function parseHashtags(val: any): string[] {
  if (!val)
    return []
  // Some playlists store hashtags as a JSON-encoded string
  try {
    if (typeof val === 'string') {
      const trimmed = val.trim()
      if (trimmed.startsWith('[')) {
        const arr = JSON.parse(trimmed)
        return Array.isArray(arr) ? arr.map((s: any) => String(s)) : []
      }
      // Fallback: comma or space separated
      return trimmed
        .replace(/^[#\s]+/, '')
        .split(/[\s,]+/)
        .filter(Boolean)
    }
    if (Array.isArray(val))
      return val.map(v => String(v))
  }
  catch {
    // ignore
  }
  return []
}

// Minimal HTML escaper + linkifier (URLs -> <a>)
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}
function linkify(s: string): string {
  const escaped = escapeHtml(s)
  // Line breaks to <br>
  const withBreaks = escaped.replace(/\n/g, '<br/>')
  // URL regex (simple)
  const urlRe = /(https?:\/\/[^\s<]+)/gi
  return withBreaks.replace(urlRe, m => `<a href="${m}" rel="noopener nofollow">${m}</a>`)
}

// Detect image URLs within a text string
function extractImageUrlsFromText(s: string): string[] {
  if (!s)
    return []
  const urls: string[] = []
  const re = /(https?:\/\/[^\s<>'"()]+\.(?:png|jpg|jpeg|gif|webp|bmp|svg))/gi
  for (let m = re.exec(s); m != null; m = re.exec(s)) {
    urls.push(m[1])
    if (urls.length >= 6)
      break
  }
  return urls
}

function extractImageUrls(c: any): string[] {
  const urls = new Set<string>()
  const push = (u: any) => {
    if (!u)
      return
    const s = String(u)
    if (
      /^data:image\/[a-zA-Z0-9.+-]+;base64,/.test(s)
      || /^https?:\/\/.+\.(?:png|jpe?g|gif|webp|bmp|svg|avif)(?:\?.*)?$/i.test(s)
    )
      urls.add(s)
  }
  // Looser acceptance for msg-derived values (may lack extension)
  const pushAny = (u: any) => {
    if (!u)
      return
    const s = String(u)
    if (/^data:image\//.test(s) || /^https?:\/\//i.test(s))
      urls.add(s)
  }
  // Common fields that might contain images
  const fields = ['image', 'images', 'media', 'attachments', 'files']
  for (const f of fields) {
    const v = (c as any)[f]
    if (!v)
      continue
    if (typeof v === 'string') {
      push(v)
    }
    else if (Array.isArray(v)) {
      for (const el of v) {
        if (typeof el === 'string')
          push(el)
        else if (el && typeof el === 'object')
          push((el as any).url || (el as any).src || (el as any).link)
      }
    }
    else if (typeof v === 'object') {
      push((v as any).url || (v as any).src || (v as any).link)
    }
  }
  // Parse images from RPC msg JSON if present
  const tryParseMsg = (val: any) => {
    if (!val)
      return null
    if (typeof val === 'string') {
      const s = val.trim()
      if (!s)
        return null
      try {
        return JSON.parse(s)
      }
      catch {
        return null
      }
    }
    if (typeof val === 'object')
      return val
    return null
  }
  const msgCandidates = [
    (c as any)?.msg,
    (c as any)?.message,
    (c as any)?.data,
    (c as any)?.comment,
  ]
  for (const cand of msgCandidates) {
    const obj = tryParseMsg(cand)
    if (obj && typeof obj === 'object') {
      const im: any = (obj as any).images
      if (typeof im === 'string') {
        pushAny(im)
      }
      else if (Array.isArray(im)) {
        for (const el of im) {
          if (typeof el === 'string')
            pushAny(el)
          else if (el && typeof el === 'object')
            pushAny((el as any).url || (el as any).src || (el as any).link)
        }
      }
      const single = (obj as any).url || (obj as any).image
      if (single)
        pushAny(single)
    }
  }
  // Also parse from comment text
  try {
    const txt = getCommentText(c)
    for (const u of extractImageUrlsFromText(txt))
      urls.add(u)
  }
  catch {}
  return Array.from(urls).slice(0, 6)
}

const currentDescState = computed(() => {
  const h = currentVideoHash.value
  return h ? descriptionsByHash.value[h] : undefined
})
const descCaption = computed(() => currentDescState.value?.caption || getCaption(currentItem.value))
const descText = computed(() => currentDescState.value?.text || getDescription(currentItem.value))
const descHtml = computed(() => linkify(descText.value || ''))
const descTags = computed(() => parseHashtags(currentItem.value?.rawPost?.hashtags ?? (currentItem.value as any)?.hashtags))

// Comments count for badge (not tied to height)
const commentsCount = computed(() => {
  const c = (currentItem.value as any)?.comments ?? (currentItem.value as any)?.rawPost?.comments
  const n = Number(c)
  return Number.isFinite(n) && n >= 0 ? n : 0
})

// Header should reflect actual loaded count when available, otherwise fallback to metadata count
const commentsHeaderCount = computed(() => {
  const loaded = currentComments.value?.items?.length ?? 0
  if (loaded > 0)
    return loaded
  return commentsCount.value
})

// Dynamic comments drawer height: measure content and cap at 2/3 viewport
const commentsHeaderEl = ref<HTMLElement | null>(null)
const commentsBodyEl = ref<HTMLElement | null>(null)
const commentsHeightVh = ref<number>(28)
const justOpened = ref<boolean>(false)

function recomputeCommentsHeight() {
  // Skip measuring when the drawer is closed to avoid jarring first measurement
  if (!showCommentsDrawer.value)
    return
  const vhPx = window.innerHeight || document.documentElement.clientHeight || 0
  if (!vhPx)
    return
  const headerH = commentsHeaderEl.value?.getBoundingClientRect().height ?? 0
  const bodyEl = commentsBodyEl.value
  let bodyContentH = bodyEl?.scrollHeight ?? bodyEl?.getBoundingClientRect().height ?? 0
  // While loading or right after opening, clamp to avoid forcing max drawer height
  if (currentComments.value?.loading || justOpened.value)
    bodyContentH = 0
  const minBody = 96
  const contentPx = Math.max(bodyContentH, minBody)
  const maxPx = (2 / 3) * vhPx
  const desiredPx = Math.min(headerH + contentPx, maxPx)
  const targetVh = (desiredPx / vhPx) * 100
  const capped = Math.min(targetVh, 66.6667)
  // During loading, only allow the drawer to expand (avoid initial growth from placeholder measurements)
  const next = currentComments.value?.loading
    ? Math.min(capped, commentsHeightVh.value)
    : capped
  commentsHeightVh.value = next
  // After the first recompute post-open, allow normal behavior
  if (justOpened.value)
    justOpened.value = false
}

// Debounced (rAF) comments height recompute to reduce layout thrash
let recomputeRaf = 0
function scheduleRecomputeCommentsHeight() {
  if (recomputeRaf)
    cancelAnimationFrame(recomputeRaf)
  recomputeRaf = requestAnimationFrame(() => {
    recomputeRaf = 0
    recomputeCommentsHeight()
  })
}

// Observe changes
let commentsBodyRO: ResizeObserver | null = null
watch(commentsBodyEl, (el) => {
  if (commentsBodyRO) {
    commentsBodyRO.disconnect()
    commentsBodyRO = null
  }
  if (el && typeof ResizeObserver !== 'undefined') {
    commentsBodyRO = new ResizeObserver(() => {
      scheduleRecomputeCommentsHeight()
    })
    commentsBodyRO.observe(el)
  }
})
watch([() => currentComments.value?.items?.length, showCommentsDrawer], async () => {
  if (showCommentsDrawer.value)
    commentsHeightVh.value = 28

  await nextTick()
  scheduleRecomputeCommentsHeight()
})
// While loading, allow only growth to avoid initial shrink flicker; once loaded, allow shrinking
watch(() => currentComments.value?.loading, async () => {
  if (!showCommentsDrawer.value)
    return
  await nextTick()
  scheduleRecomputeCommentsHeight()
})
watch(currentIndex, async () => {
  await nextTick()
  scheduleRecomputeCommentsHeight()
})
onMounted(() => {
  window.addEventListener('resize', scheduleRecomputeCommentsHeight)
})
onBeforeUnmount(() => {
  window.removeEventListener('resize', scheduleRecomputeCommentsHeight)
  if (commentsBodyRO)
    commentsBodyRO.disconnect()
  if (recomputeRaf)
    cancelAnimationFrame(recomputeRaf)
})

async function toggleCommentsDrawer(ev?: Event) {
  ev?.stopPropagation?.()
  const willOpen = !showCommentsDrawer.value
  if (willOpen)
    commentsHeightVh.value = 28
  if (willOpen)
    justOpened.value = true
  if (willOpen)
    await nextTick()
  showCommentsDrawer.value = !showCommentsDrawer.value
  if (showCommentsDrawer.value)
    showDescriptionDrawer.value = false
}
async function openCommentsInHost(ev?: Event) {
  try {
    ev?.stopPropagation?.()
    // If the current video is playing, pause it before opening the host UI
    wasPlayingBeforeOpenPost.value = isCurrentVideoPlaying()
    pauseCurrentVideo()
    const txid = currentVideoHash.value
    if (!txid) {
      console.warn('No current video hash to open comments for.')
      return
    }
    await SdkService.openPost(txid)
  }
  catch (e) {
    console.warn('Host open.post unavailable; falling back to in-app comments drawer', e)
    // Since we paused for host UI, resume playback if it was previously playing
    if (wasPlayingBeforeOpenPost.value) {
      resumeCurrentVideo()
      wasPlayingBeforeOpenPost.value = false
    }
    await toggleCommentsDrawer(ev)
  }
}
function openDescriptionDrawer(ev?: Event) {
  ev?.stopPropagation?.()
  showDescriptionDrawer.value = true
  showCommentsDrawer.value = false
}
function openSettingsDrawer(ev?: Event) {
  ev?.stopPropagation?.()
  showSettingsDrawer.value = true
  showDescriptionDrawer.value = false
  showCommentsDrawer.value = false
}
function closeAnyDrawer() {
  showDescriptionDrawer.value = false
  showCommentsDrawer.value = false
  showSettingsDrawer.value = false
}

function closeDrawer(which: 'desc' | 'comments') {
  if (which === 'desc')
    showDescriptionDrawer.value = false
  else
    showCommentsDrawer.value = false
}

function onDrawerTouchStart(which: 'desc' | 'comments', ev: TouchEvent, fromHeader = false) {
  const t = ev.touches && ev.touches[0]
  if (!t)
    return
  draggingWhich.value = which
  drawerDragStartY = t.clientY
  drawerStartedOnHeader = !!fromHeader
  // When starting from header, we allow immediate drag
  drawerBodyWasAtTop = true
  if (fromHeader)
    ev.preventDefault()
}

function onDrawerBodyTouchStart(which: 'desc' | 'comments', ev: TouchEvent) {
  const t = ev.touches && ev.touches[0]
  if (!t)
    return
  const el = ev.currentTarget as HTMLElement | null
  draggingWhich.value = which
  drawerDragStartY = t.clientY
  drawerStartedOnHeader = false
  drawerBodyWasAtTop = (el?.scrollTop || 0) <= 0
}

function onDrawerTouchMove(ev: TouchEvent) {
  if (!draggingWhich.value)
    return
  const t = ev.touches && ev.touches[0]
  if (!t)
    return
  const dy = t.clientY - drawerDragStartY
  const allowDrag = drawerStartedOnHeader ? dy > 0 : (drawerBodyWasAtTop && dy > 0)
  if (!allowDrag) {
    // reset offsets while not dragging
    if (draggingWhich.value === 'desc')
      descDragOffset.value = 0
    else
      commentsDragOffset.value = 0
    return
  }
  // Apply drag offset (only downward)
  const offset = Math.max(0, dy)
  if (draggingWhich.value === 'desc')
    descDragOffset.value = offset
  else
    commentsDragOffset.value = offset
  // prevent page/body scroll while dragging the sheet
  ev.preventDefault()
}

function onDrawerTouchEnd() {
  if (!draggingWhich.value)
    return
  const which = draggingWhich.value
  const offset = which === 'desc' ? descDragOffset.value : commentsDragOffset.value
  const threshold = 60
  if (offset > threshold)
    closeDrawer(which)
  // reset drag state
  descDragOffset.value = 0
  commentsDragOffset.value = 0
  draggingWhich.value = null
}

// Settings drawer (left side) horizontal drag-to-close
const settingsDragging = ref(false)
let settingsDragStartX = 0
const settingsDragOffset = ref(0)
function onSettingsTouchStart(ev: TouchEvent, fromHeader = false) {
  const t = ev.touches && ev.touches[0]
  if (!t)
    return
  settingsDragging.value = true
  settingsDragStartX = t.clientX
  if (fromHeader)
    ev.preventDefault()
}
function onSettingsTouchMove(ev: TouchEvent) {
  if (!settingsDragging.value)
    return
  const t = ev.touches && ev.touches[0]
  if (!t)
    return
  const dx = t.clientX - settingsDragStartX
  // Only allow dragging left to close
  const allow = dx < 0
  settingsDragOffset.value = allow ? Math.max(0, -dx) : 0
  if (allow)
    ev.preventDefault()
}
function onSettingsTouchEnd() {
  if (!settingsDragging.value)
    return
  const threshold = 60
  if (settingsDragOffset.value > threshold)
    showSettingsDrawer.value = false
  settingsDragOffset.value = 0
  settingsDragging.value = false
}

// Pager container + navigation state
const pagerRef = ref<HTMLElement | null>(null)
const isPaging = ref(false)
let lastNavAt = 0
let touchStartY = 0
let touchStartTime = 0

// Pager-mode window derived from current index
const visibleStart = computed(() => Math.max(0, currentIndex.value - 1))
const visibleEnd = computed(() => Math.min(items.value.length - 1, currentIndex.value + appConfig.preloadAhead))
const visibleIndices = computed(() =>
  Array.from({ length: Math.max(0, visibleEnd.value - visibleStart.value + 1) }, (_, i) => visibleStart.value + i),
)
const visibleItems = computed(() => visibleIndices.value.map(idx => ({ idx, item: items.value[idx] })))

function clamp01(n: number) {
  return Math.max(0, Math.min(1, n))
}
function formatTime(sec: number) {
  if (!Number.isFinite(sec) || sec < 0)
    sec = 0
  const s = Math.floor(sec % 60)
  const m = Math.floor((sec / 60) % 60)
  const h = Math.floor(sec / 3600)
  if (h > 0)
    return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
  return `${m}:${String(s).padStart(2, '0')}`
}

function setCardRef(el: HTMLElement | null, idx: number) {
  // Keep refs for potential future use (e.g., focus management)
  cardRefs.value[idx] = el
}

function setVideoRef(el: any, idx: number) {
  videoRefs.value[idx] = el
}

function getHls(item: VideoItem): string | null {
  return item.videoInfo?.peertube?.hlsUrl || item.rawPost?.peertube?.hlsUrl || null
}

function getPeerApiUrl(item: VideoItem | any): string | null {
  return (
    item?.videoInfo?.peertube?.apiUrl
    ?? item?.rawPost?.peertube?.apiUrl
    ?? null
  )
}

function getItemMetaKey(item: VideoItem | any): string | null {
  // Prefer API URL for uniqueness; fall back to Bastyon txid
  return getPeerApiUrl(item) || item?.rawPost?.video_hash || null
}

function inWindow(idx: number) {
  // Render previous 1 and next N items to limit downloads
  // N is configured via appConfig.preloadAhead
  const start = Math.max(0, currentIndex.value - 1)
  const end = currentIndex.value + appConfig.preloadAhead
  return idx >= start && idx <= end
}

function shouldLoad(idx: number) {
  // Load previous 1 and next N (from appConfig.preloadAhead)
  const start = Math.max(0, currentIndex.value - 1)
  const end = currentIndex.value + appConfig.preloadAhead
  return idx >= start && idx <= end
}

function shouldPlay(idx: number) {
  return idx === currentIndex.value && !paused.value
}

function togglePlay() {
  paused.value = !paused.value
  // Show overlay icon immediately on toggle
  showOverlayIcon.value = true
  // Manage fade-out when unpausing
  if (!paused.value) {
    // user resumed playback -> enable sound globally
    soundOn.value = true
    if (overlayHideTimer)
      window.clearTimeout(overlayHideTimer)
    overlayHideTimer = window.setTimeout(() => {
      showOverlayIcon.value = false
      overlayHideTimer = null
    }, 1000)
  }
  else {
    // When paused, keep icon visible
    if (overlayHideTimer) {
      window.clearTimeout(overlayHideTimer)
      overlayHideTimer = null
    }
  }
}

function onSectionClick(idx: number) {
  if (idx === currentIndex.value)
    togglePlay()
}

function enableSound() {
  soundOn.value = true
}

// ----- Playback helpers for pause/resume around opening host UI -----
function getCurrentVideoRef(): any | null {
  return videoRefs.value[currentIndex.value] || null
}

function isCurrentVideoPlaying(): boolean {
  const vr = getCurrentVideoRef()
  const el: HTMLVideoElement | null | undefined = vr?.el
  if (el)
    return !el.paused && !el.ended
  // Fallback to logical state
  return !paused.value
}

function pauseCurrentVideo() {
  try {
    getCurrentVideoRef()?.pause?.()
  }
  catch (err) {
    void err
  }
  paused.value = true
}

function resumeCurrentVideo() {
  // Resume only the current card; ensure global sound on
  soundOn.value = true
  paused.value = false
  try {
    getCurrentVideoRef()?.play?.()
  }
  catch (err) {
    void err
  }
}

function maybeResumeFromHostReturn() {
  if (document.visibilityState === 'visible' && wasPlayingBeforeOpenPost.value && paused.value) {
    resumeCurrentVideo()
    wasPlayingBeforeOpenPost.value = false
  }
}

function onAppFocus() {
  maybeResumeFromHostReturn()
}

function onVisibilityChange() {
  if (document.visibilityState === 'visible')
    maybeResumeFromHostReturn()
}

// Reset feed state and reload playlist for the selected language
async function reloadForLanguage() {
  try {
    // Reset index and clear arrays to avoid flashing stale content
    currentIndex.value = 0
    items.value = []
    videoLoading.value = []
    progress.value = []
    buffered.value = []
    await nextTick()
    await loadPlaylist()
  }
  catch (e) {
    void e
  }
}

function normalizeItem(rec: any): any {
  // If already in expected shape, return as-is
  const hlsExisting = rec?.videoInfo?.peertube?.hlsUrl || rec?.rawPost?.peertube?.hlsUrl
  const apiExisting = rec?.videoInfo?.peertube?.apiUrl || rec?.rawPost?.peertube?.apiUrl
  const hasNewFields = (
    rec?.hls_link != null
    || rec?.peertube_api_link != null
    || rec?.author_address != null
    || rec?.video_hash != null
    || rec?.number_of_comments != null
    || rec?.tags != null
  )
  if (!hasNewFields && (hlsExisting || apiExisting))
    return rec

  const out: any = { ...rec }

  // Ensure nested structures
  out.videoInfo = out.videoInfo || {}
  out.videoInfo.peertube = out.videoInfo.peertube || {}
  out.rawPost = out.rawPost || {}
  out.rawPost.peertube = out.rawPost.peertube || {}

  // Map PeerTube URLs
  if (typeof rec?.hls_link === 'string' && rec.hls_link) {
    out.videoInfo.peertube.hlsUrl = rec.hls_link
    out.rawPost.peertube.hlsUrl = rec.hls_link
  }
  if (typeof rec?.peertube_api_link === 'string' && rec.peertube_api_link) {
    out.videoInfo.peertube.apiUrl = rec.peertube_api_link
    out.rawPost.peertube.apiUrl = rec.peertube_api_link
  }

  // Map identifiers
  if (typeof rec?.video_hash === 'string' && rec.video_hash)
    out.rawPost.video_hash = rec.video_hash
  if (typeof rec?.author_address === 'string' && rec.author_address) {
    out.rawPost.author_address = rec.author_address
    if (!out.uploaderAddress)
      out.uploaderAddress = rec.author_address
  }

  // Map counts
  if (rec?.number_of_comments != null) {
    const n = typeof rec.number_of_comments === 'string' ? Number(rec.number_of_comments) : rec.number_of_comments
    if (Number.isFinite(n)) {
      out.comments = n
      out.rawPost.comments = n
    }
  }

  // Map hashtags/tags (string or array). Keep both rawPost.hashtags and top-level fallback.
  if (rec?.tags != null && out.rawPost.hashtags == null) {
    out.rawPost.hashtags = rec.tags
    if (out.hashtags == null)
      out.hashtags = rec.tags
  }

  // Optional pass-throughs
  if (rec?.author_reputation != null && out.rawPost.author_reputation == null)
    out.rawPost.author_reputation = rec.author_reputation
  if (out.description == null && rec?.description != null)
    out.description = rec.description

  // Seed caches opportunistically
  try {
    const hash = out?.rawPost?.video_hash
    const addr = out?.rawPost?.author_address || out?.uploaderAddress
    if (hash && addr && !addressByHash.value[hash])
      addressByHash.value[hash] = addr
    if (addr && typeof rec?.author_avatar === 'string' && rec.author_avatar) {
      if (!avatarsByAddress.value[addr])
        avatarsByAddress.value[addr] = rec.author_avatar
    }
  }
  catch {}

  return out
}

async function loadPlaylist() {
  try {
    loading.value = true
    error.value = null
    const lang = (selectedLanguage.value || appConfig.defaultLanguage || 'en').toLowerCase()
    const primaryUrl = `/playlists/${lang}/latest.json`

    let loaded: any = []
    // Fetch only the selected language; if missing, show empty state instead of falling back
    const res = await fetch(primaryUrl, { cache: 'no-store' })
    if (res.ok)
      loaded = await res.json()

    const mapped = Array.isArray(loaded) ? loaded.map(normalizeItem) : []
    // Keep only items with playable HLS
    const withHls = mapped.filter((it: VideoItem) => !!getHls(it))
    // Remove deleted posts and videos by authors with an active ban
    const filtered = await filterOutDeletedAndBannedItems(withHls)
    items.value = filtered
    videoLoading.value = items.value.map(() => false)
    progress.value = items.value.map(() => ({ currentTime: 0, duration: 0 }))
    buffered.value = items.value.map(() => ({ ranges: [], duration: 0 }))
  }
  catch (e: any) {
    error.value = e?.message || String(e)
  }
  finally {
    loading.value = false
    await nextTick()
    // Focus pager for keyboard navigation once content is ready
    pagerRef.value?.focus()
  }
}

function onVideoLoadingChange(idx: number, isLoading: boolean) {
  videoLoading.value[idx] = isLoading
}

function onVideoProgress(idx: number, payload: { currentTime: number, duration: number }) {
  progress.value[idx] = payload
}

function onVideoBuffered(idx: number, payload: { ranges: { start: number, end: number }[], duration: number }) {
  buffered.value[idx] = payload
}

function onVideoEnded(idx: number) {
  // Only handle end event for the current video
  if (idx !== currentIndex.value)
    return
  if (endBehavior.value === 'replay') {
    try {
      const vr = videoRefs.value[idx]
      vr?.seekTo?.(0)
      // Ensure playback resumes
      paused.value = false
      vr?.play?.()
    }
    catch (e) {
      void e
    }
    return
  }
  // Otherwise advance to next item, or pause if at the end
  const isLast = idx >= items.value.length - 1
  if (!isLast)
    goToIndex(idx + 1)
  else
    paused.value = true
}

function onSeekClick(idx: number, ev: MouseEvent) {
  ev.stopPropagation()
  ev.preventDefault()
  const target = ev.currentTarget as HTMLElement | null
  if (!target)
    return
  const rect = target.getBoundingClientRect()
  const x = ev.clientX - rect.left
  const pct = Math.max(0, Math.min(1, x / rect.width))
  const dur = progress.value[idx]?.duration || buffered.value[idx]?.duration || 0
  if (dur > 0) {
    const t = pct * dur
    videoRefs.value[idx]?.seekTo?.(t)
  }
}

function onSeekPointerDown(idx: number, ev: PointerEvent) {
  ev.stopPropagation()
  ev.preventDefault()
  const target = ev.currentTarget as HTMLElement | null
  if (!target)
    return
  const rect = target.getBoundingClientRect()
  scrubRect.value = rect
  scrubIdx.value = idx
  isScrubbing.value = true
  target.setPointerCapture?.(ev.pointerId)
  // initial update
  onWindowPointerMove(ev)
  window.addEventListener('pointermove', onWindowPointerMove)
  window.addEventListener('pointerup', onWindowPointerUp, { once: true })
  window.addEventListener('pointercancel', onWindowPointerUp, { once: true })
}

function updateTooltip(idx: number, pct: number) {
  tooltipIdx.value = idx
  tooltipPct.value = clamp01(pct)
  showTooltip.value = true
}
function onTrackHoverMove(idx: number, ev: MouseEvent) {
  const target = ev.currentTarget as HTMLElement | null
  if (!target || isScrubbing.value)
    return
  const rect = target.getBoundingClientRect()
  const pct = clamp01((ev.clientX - rect.left) / rect.width)
  updateTooltip(idx, pct)
}
function onTrackHoverLeave() {
  if (isScrubbing.value)
    return
  showTooltip.value = false
  tooltipIdx.value = null
}
function onWindowPointerMove(ev: PointerEvent) {
  if (!isScrubbing.value || scrubIdx.value == null || !scrubRect.value)
    return
  const pct = clamp01((ev.clientX - scrubRect.value.left) / scrubRect.value.width)
  scrubPct.value = pct
  updateTooltip(scrubIdx.value, pct)
  const idx = scrubIdx.value
  const dur = progress.value[idx]?.duration || buffered.value[idx]?.duration || 0
  if (dur > 0)
    videoRefs.value[idx]?.seekTo?.(pct * dur)
}
function onWindowPointerUp() {
  isScrubbing.value = false
  scrubIdx.value = null
  scrubRect.value = null
  window.removeEventListener('pointermove', onWindowPointerMove)
  // keep tooltip if hovering; otherwise it will be hidden by mouseleave
}

// Pager navigation helpers
function resetOnPageChange() {
  // reset paused when switching items to auto-play the new one
  paused.value = false
  if (overlayHideTimer)
    window.clearTimeout(overlayHideTimer)
  overlayHideTimer = null
  showOverlayIcon.value = false
}
function goToIndex(next: number) {
  if (next < 0 || next >= items.value.length || next === currentIndex.value)
    return
  currentIndex.value = next
  resetOnPageChange()
}
function nextPage() {
  goToIndex(currentIndex.value + 1)
}
function prevPage() {
  goToIndex(currentIndex.value - 1)
}
function onWheel(ev: WheelEvent) {
  // Prevent underlying scroll (host app)
  ev.preventDefault()
  if (isPaging.value)
    return
  const now = performance.now()
  if (now - lastNavAt < 300)
    return
  if (ev.deltaY > 20)
    nextPage()
  else if (ev.deltaY < -20)
    prevPage()
  lastNavAt = now
  isPaging.value = true
  window.setTimeout(() => {
    isPaging.value = false
  }, 220)
}
function onTouchStart(ev: TouchEvent) {
  if (ev.touches.length > 0) {
    touchStartY = ev.touches[0].clientY
    touchStartTime = performance.now()
  }
}
function onTouchEnd(ev: TouchEvent) {
  const touch = ev.changedTouches[0]
  if (!touch)
    return
  const dy = touch.clientY - touchStartY
  const ady = Math.abs(dy)
  const dt = performance.now() - touchStartTime
  // Horizontal swipe to open Settings disabled; use the Settings button instead
  // Vertical swipe: navigate between videos
  if (ady > 50 && dt < 800) {
    if (dy < 0)
      nextPage()
    else
      prevPage()
  }
}
function onKeyDown(ev: KeyboardEvent) {
  if (ev.key === 'ArrowDown' || ev.key === 'PageDown') {
    ev.preventDefault()
    nextPage()
  }
  else if (ev.key === 'ArrowUp' || ev.key === 'PageUp') {
    ev.preventDefault()
    prevPage()
  }
  else if (ev.key === 'Escape') {
    ev.preventDefault()
    closeAnyDrawer()
  }
}

async function handleExternalLink(url: string, ev?: Event) {
  try {
    ev?.preventDefault?.()
    ev?.stopPropagation?.()
    await SdkService.checkAndRequestPermissions(['externallink'])
    SdkService.openExternalLink(url)
  }
  catch (e) {
    console.error('Failed to open external link via SDK:', e)
  }
}

function onDescHtmlClick(ev: MouseEvent) {
  const target = ev.target as HTMLElement | null
  if (!target)
    return
  const a = target.closest('a') as HTMLAnchorElement | null
  if (a && a.href)
    void handleExternalLink(a.href, ev)
}

function onHashtagClick(tag: string, ev?: Event) {
  const url = `https://bastyon.com/index?sst=${encodeURIComponent(tag)}`
  void handleExternalLink(url, ev)
}

// ----- Simple in-app image viewer (lightbox) for comment attachments -----
const imageViewerOpen = ref(false)
const imageViewerItems = ref<string[]>([])
const imageViewerIndex = ref(0)
const wasPlayingBeforeImageViewer = ref(false)

function openCommentImages(c: any, startIdx = 0) {
  try {
    const urls = extractImageUrls(c)
    if (!urls || urls.length === 0)
      return
    wasPlayingBeforeImageViewer.value = isCurrentVideoPlaying()
    pauseCurrentVideo()
    imageViewerItems.value = urls
    imageViewerIndex.value = Math.max(0, Math.min(startIdx, urls.length - 1))
    imageViewerOpen.value = true
    window.addEventListener('keydown', onImageViewerKeyDown)
  }
  catch (e) {
    console.warn('Failed to open image viewer:', e)
  }
}

function closeImageViewer() {
  imageViewerOpen.value = false
  imageViewerItems.value = []
  imageViewerIndex.value = 0
  window.removeEventListener('keydown', onImageViewerKeyDown)
  if (wasPlayingBeforeImageViewer.value) {
    resumeCurrentVideo()
    wasPlayingBeforeImageViewer.value = false
  }
}

function nextImage() {
  const n = imageViewerItems.value.length
  if (n > 1)
    imageViewerIndex.value = (imageViewerIndex.value + 1) % n
}
function prevImage() {
  const n = imageViewerItems.value.length
  if (n > 1)
    imageViewerIndex.value = (imageViewerIndex.value - 1 + n) % n
}

function onImageViewerKeyDown(ev: KeyboardEvent) {
  if (!imageViewerOpen.value)
    return
  if (ev.key === 'Escape') {
    ev.preventDefault()
    closeImageViewer()
  }
  else if (ev.key === 'ArrowRight') {
    ev.preventDefault()
    nextImage()
  }
  else if (ev.key === 'ArrowLeft') {
    ev.preventDefault()
    prevImage()
  }
}

onMounted(() => {
  void loadPlaylist()
  // Resume playback if we paused due to opening the host UI and the app regains focus/visibility
  window.addEventListener('focus', onAppFocus)
  document.addEventListener('visibilitychange', onVisibilityChange)
})

onBeforeUnmount(() => {
  // Safety: remove pointer listeners if scrubbing during unmount
  window.removeEventListener('pointermove', onWindowPointerMove)
  window.removeEventListener('focus', onAppFocus)
  document.removeEventListener('visibilitychange', onVisibilityChange)
})

// ----- Peertube metadata fetching (views + upload date) -----
function ensurePeerMetaForItem(item: any) {
  const url = getPeerApiUrl(item)
  const key = getItemMetaKey(item)
  if (!url || !key)
    return
  const st = peerMetaByKey.value[key]
  if (st?.loading || st?.fetchedAt)
    return
  peerMetaByKey.value[key] = { loading: true, error: null, views: null, publishedAt: null, fetchedAt: 0 }
  void fetchPeertubeMetaFor(key, url)
}

async function fetchPeertubeMetaFor(key: string, url: string) {
  try {
    const res = await fetch(url, { cache: 'no-store' })
    if (!res.ok)
      throw new Error(`Peertube meta HTTP ${res.status}`)
    const json: any = await res.json()
    const views = extractViews(json)
    const publishedAt = extractPublishedAt(json)
    peerMetaByKey.value[key] = {
      loading: false,
      error: null,
      views,
      publishedAt,
      fetchedAt: Date.now(),
    }
  }
  catch (e: any) {
    peerMetaByKey.value[key] = {
      loading: false,
      error: e?.message || String(e),
      views: null,
      publishedAt: null,
      fetchedAt: Date.now(),
    }
  }
}

function extractViews(json: any): number | null {
  if (!json || typeof json !== 'object')
    return null
  if (typeof json.views === 'number')
    return json.views
  if (typeof json.viewCount === 'number')
    return json.viewCount
  const stats = json.stats || json.stat || json.statistics
  if (stats && typeof stats.views === 'number')
    return stats.views
  return null
}

function extractPublishedAt(json: any): string | null {
  if (!json || typeof json !== 'object')
    return null
  const candidates = [
    json.publishedAt,
    json.createdAt,
    json.uploadedAt,
    json.uploadDate,
    json.originallyPublishedAt,
  ]
  for (const c of candidates) {
    if (typeof c === 'string' && c)
      return c
  }
  return null
}

function peerMetaString(item: any): string {
  if (!item)
    return ''
  const key = getItemMetaKey(item)
  const st = key ? peerMetaByKey.value[key] : undefined
  if (!st)
    return ''
  const parts: string[] = []
  if (st.views != null)
    parts.push(`${formatCount(st.views)} views`)
  const full = formatFullDate(st.publishedAt || '')
  if (full)
    parts.push(full)
  return parts.join(' · ')
}

// Trigger fetch for visible items and preloads
watch(visibleIndices, (idxs) => {
  for (const idx of idxs) {
    const it = items.value[idx]
    if (it)
      ensurePeerMetaForItem(it)
  }
}, { immediate: true })

watch(selectedLanguage, async (code) => {
  try {
    if (typeof localStorage !== 'undefined' && code)
      localStorage.setItem(LANGUAGE_STORAGE_KEY, code)
  }
  catch {}
  await reloadForLanguage()
})
// Persist playback end behavior setting
watch(endBehavior, (val) => {
  try {
    if (typeof localStorage !== 'undefined' && val)
      localStorage.setItem(END_BEHAVIOR_STORAGE_KEY, val)
  }
  catch {}
})
</script>

<template>
  <div class="shorts-root">
    <div v-if="loading" class="center-msg">
      Loading…
    </div>
    <div v-else-if="error" class="center-msg text-red">
      {{ error }}
    </div>
    <div v-else-if="items.length === 0" class="center-msg">
      No videos available yet for this Video Language.
    </div>

    <div
      v-else
      ref="pagerRef"
      class="pager-root"
      tabindex="0"
      @wheel="onWheel"
      @touchstart="onTouchStart"
      @touchend="onTouchEnd"
      @keydown="onKeyDown"
    >
      <section
        v-for="vi in visibleItems"
        :key="vi.idx"
        :ref="(el) => setCardRef(el as HTMLElement | null, vi.idx)"
        class="pager-item"
        :class="{ 'is-current': vi.idx === currentIndex, 'is-prev': vi.idx < currentIndex, 'is-next': vi.idx > currentIndex }"
        :data-idx="vi.idx"
        @click="onSectionClick(vi.idx)"
      >
        <HlsVideo
          v-if="inWindow(vi.idx)"
          :ref="(el) => setVideoRef(el, vi.idx)"
          :src="getHls(vi.item)!"
          :loop="endBehavior === 'replay'"
          :muted="!(soundOn && vi.idx === currentIndex && !paused)"
          :should-load="shouldLoad(vi.idx)"
          :should-play="shouldPlay(vi.idx)"
          @loading-change="onVideoLoadingChange(vi.idx, $event)"
          @progress="onVideoProgress(vi.idx, $event)"
          @buffered="onVideoBuffered(vi.idx, $event)"
          @ended="onVideoEnded(vi.idx)"
        />
        <div v-else class="video-placeholder" />

        <!-- Debug performance overlay -->
        <PerfOverlay
          v-if="appConfig.debugPerfOverlay && vi.idx === currentIndex"
          :video-el="videoRefs[vi.idx]?.el ?? null"
          :is-current="vi.idx === currentIndex"
        />

        <!-- Centered play/pause icon shown on user toggle -->
        <div class="overlay-center" :class="{ visible: showOverlayIcon }">
          <div class="play-icon" aria-hidden="true">
            <span v-if="paused">▶</span>
            <span v-else>❚❚</span>
          </div>
        </div>
        <!-- Loading spinner while video is loading/buffering -->
        <div v-if="inWindow(vi.idx) && videoLoading[vi.idx]" class="overlay-loading">
          <LoadingSpinner :size="72" aria-label="Loading video" />
        </div>
        <!-- Tap for sound prompt (only when sound is off for the current item) -->
        <div v-if="vi.idx === currentIndex && !soundOn" class="overlay-sound">
          <button class="sound-btn" aria-label="Tap for sound" @click.stop="enableSound">
            Tap for sound
          </button>
        </div>
        <div class="overlay">
          <div class="meta">
            <div class="author-row">
              <div class="avatar-wrap" title="Open profile" @click.stop="openAuthorChannel(vi.item)">
                <div class="avatar author-avatar" :style="{ backgroundImage: authorAvatarFor(vi.item) ? `url('${authorAvatarFor(vi.item)}')` : '' }">
                  <span v-if="!authorAvatarFor(vi.item)" class="avatar-fallback">👤</span>
                </div>
                <div v-if="getAuthorReputation(vi.item) != null" class="reputation-badge">
                  {{ formatReputation(getAuthorReputation(vi.item)!) }}
                </div>
              </div>
              <div class="uploader" title="Open profile" @click.stop="openAuthorChannel(vi.item)">
                {{ authorNameFor(vi.item) }}
              </div>
              <button
                v-if="appConfig.showFollowButton"
                class="follow-btn"
                :class="{ following: isAuthorFollowed(vi.item), loading: isFollowLoading(vi.item) }"
                :disabled="isFollowLoading(vi.item) || isAuthorFollowed(vi.item)"
                aria-label="Follow author"
                @click.stop="followAuthor(vi.item)"
              >
                {{ followBtnLabel(vi.item) }}
              </button>
            </div>
            <div class="desc" title="View description" @click.stop="openDescriptionDrawer">
              <div class="desc-text-trunc">
                {{ overlayPreviewFor(vi.item) }}
              </div>
              <div v-if="peerMetaString(vi.item)" class="desc-meta-row">
                {{ peerMetaString(vi.item) }}
              </div>
            </div>
          </div>
          <div class="seekbar">
            <div
              class="seekbar-track"
              @click.stop.prevent="onSeekClick(vi.idx, $event)"
              @pointerdown="onSeekPointerDown(vi.idx, $event)"
              @mousemove="onTrackHoverMove(vi.idx, $event)"
              @mouseleave="onTrackHoverLeave"
            >
              <div
                v-for="(r, rIdx) in (buffered[vi.idx]?.ranges || [])"
                :key="rIdx"
                class="buffer-segment"
                :style="{
                  left: buffered[vi.idx]?.duration
                    ? `${((r.start / buffered[vi.idx].duration) * 100).toFixed(2)}%`
                    : '0%',
                  width: buffered[vi.idx]?.duration
                    ? `${(((r.end - r.start) / buffered[vi.idx].duration) * 100).toFixed(2)}%`
                    : '0%',
                }"
              />
              <div
                class="seekbar-fill"
                :style="{
                  width: `${(
                    progress[vi.idx]?.duration
                      ? ((isScrubbing && scrubIdx === vi.idx)
                        ? (scrubPct * 100)
                        : Math.min(100, Math.max(0, (progress[vi.idx].currentTime / progress[vi.idx].duration) * 100)))
                      : 0
                  ).toFixed(2)}%`,
                }"
              />
              <div
                v-if="isScrubbing && scrubIdx === vi.idx"
                class="seekbar-thumb"
                :style="{
                  left: `${(scrubPct * 100).toFixed(2)}%`,
                }"
              />
              <div
                v-if="showTooltip && tooltipIdx === vi.idx"
                class="seekbar-tooltip"
                :style="{ left: `${(tooltipPct * 100).toFixed(2)}%` }"
              >
                {{ formatTime((progress[vi.idx]?.duration || buffered[vi.idx]?.duration || 0) * tooltipPct) }}
              </div>
            </div>
          </div>
        </div>
        <!-- Right-side controls -->
        <div v-if="vi.idx === currentIndex" class="right-controls">
          <button class="comments-btn" aria-label="Open comments" @click.stop="toggleCommentsDrawer">
            💬
            <span v-if="commentsCount" class="comments-badge">{{ commentsCount }}</span>
          </button>
          <button class="open-post-btn" aria-label="Open full post" title="Open full post" @click.stop="openCommentsInHost">
            🗖
          </button>
          <button class="settings-btn" aria-label="Open settings" title="Open settings" @click.stop="openSettingsDrawer">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <path d="M11.049 2.927c.3-1.14 1.975-1.14 2.275 0a1.724 1.724 0 002.573 1.066c.99-.57 2.233.386 1.946 1.47a1.724 1.724 0 001.001 2.088c1.09.45 1.09 2.05 0 2.5a1.724 1.724 0 00-1.001 2.088c.287 1.084-.956 2.04-1.946 1.47a1.724 1.724 0 00-2.573 1.066c-.3 1.14-1.975 1.14-2.275 0a1.724 1.724 0 00-2.573-1.066c-.99.57-2.233-.386-1.946-1.47a1.724 1.724 0 00-1.001-2.088c-1.09-.45-1.09-2.05 0-2.5.587-.242 1.004-.74 1.001-2.088-.287-1.084.956-2.04 1.946-1.47.626.361 1.406.182 2.573-1.066z" />
              <path d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
          </button>
        </div>
      </section>
    </div>
    <!-- Screen tint overlay when any drawer is open -->
    <div
      class="screen-tint"
      :class="{ visible: showDescriptionDrawer || showCommentsDrawer || showSettingsDrawer }"
      @click="closeAnyDrawer"
    />

    <!-- Description Bottom Sheet -->
    <div
      class="drawer-base description-drawer"
      :class="{ open: showDescriptionDrawer, dragging: draggingWhich === 'desc' }"
      :style="draggingWhich === 'desc' ? { transform: `translateY(${descDragOffset}px)` } : null"
      @click.self="closeAnyDrawer"
    >
      <div class="drawer-content" @click.stop>
        <div
          class="drawer-header"
          @touchstart="onDrawerTouchStart('desc', $event, true)"
          @touchmove="onDrawerTouchMove($event)"
          @touchend="onDrawerTouchEnd"
        >
          <h3>Description</h3>
        </div>
        <div
          class="drawer-body"
          @touchstart="onDrawerBodyTouchStart('desc', $event)"
          @touchmove="onDrawerTouchMove($event)"
          @touchend="onDrawerTouchEnd"
        >
          <div
            v-if="descCaption"
            class="desc-title"
          >
            {{ descCaption }}
          </div>
          <div v-if="!currentVideoHash" class="center-msg">
            No post id
          </div>
          <div v-else-if="currentDescState?.loading" class="center-msg">
            <LoadingSpinner :size="32" aria-label="Loading description" />
          </div>
          <div v-else-if="currentDescState?.error" class="center-msg text-red">
            {{ currentDescState?.error }}
            <div style="margin-top: 8px;">
              <button class="retry-btn" @click="refreshDescription">
                Retry
              </button>
            </div>
          </div>
          <div v-else class="desc-text" @click="onDescHtmlClick" v-html="descHtml" />
          <div v-if="peerMetaString(currentItem)" class="desc-meta end">
            {{ peerMetaString(currentItem) }}
          </div>
          <div v-if="descTags.length" class="hashtags-row">
            <a
              v-for="(tag, i) in descTags"
              :key="i"
              class="hashtag"
              :href="`https://bastyon.com/index?sst=${encodeURIComponent(tag)}`"
              rel="noopener"
              @click.prevent="onHashtagClick(tag, $event)"
            >#{{ tag }}</a>
          </div>
        </div>
      </div>
    </div>

    <!-- Comments Drawer (right side) -->
    <div
      class="drawer-base comments-drawer"
      :class="{ 'open': showCommentsDrawer, 'dragging': draggingWhich === 'comments', 'no-anim': justOpened }"
      :style="[
        { height: `${commentsHeightVh}vh` },
        draggingWhich === 'comments' ? { transform: `translateY(${commentsDragOffset}px)` } : null,
      ]"
      @click.self="closeAnyDrawer"
    >
      <div class="drawer-content" @click.stop>
        <div
          ref="commentsHeaderEl"
          class="drawer-header"
          @touchstart="onDrawerTouchStart('comments', $event, true)"
          @touchmove="onDrawerTouchMove($event)"
          @touchend="onDrawerTouchEnd"
        >
          <h3>Comments<span v-if="commentsHeaderCount > 0">({{ commentsHeaderCount }})</span></h3>
        </div>
        <div
          ref="commentsBodyEl"
          class="drawer-body comments-body"
          :class="{ 'no-scroll': currentComments?.loading }"
          @touchstart="onDrawerBodyTouchStart('comments', $event)"
          @touchmove="onDrawerTouchMove($event)"
          @touchend="onDrawerTouchEnd"
          @scroll="onCommentsScroll"
        >
          <div class="comments-notice" role="note">
            <span>Read-only comments. To post or rate, open the full post.</span>
            <button class="open-post-inline-btn" @click="openCommentsInHost">
              Open Post
            </button>
          </div>
          <div v-if="!currentVideoHash" class="no-comments">
            No post id
          </div>
          <div v-else-if="currentComments?.loading" class="center-msg">
            <LoadingSpinner :size="40" aria-label="Loading comments" />
          </div>
          <div v-else-if="currentComments?.error" class="center-msg text-red">
            {{ currentComments?.error }}
            <div style="margin-top: 8px;">
              <button class="retry-btn" @click="refreshComments">
                Retry
              </button>
            </div>
          </div>
          <div v-else-if="!avatarsReadyForCurrent" class="center-msg">
            <LoadingSpinner :size="36" aria-label="Preparing avatars" />
          </div>
          <div v-else-if="(currentComments?.items?.length || 0) === 0" class="no-comments">
            No comments yet
          </div>
          <ul v-else class="comments-list">
            <li v-for="(c, i) in currentVisibleComments" :key="i" class="comment-item">
              <div class="comment-row">
                <div class="avatar comment-avatar" :style="{ backgroundImage: commentAvatarFor(c) ? `url('${commentAvatarFor(c)}')` : '' }">
                  <span v-if="!commentAvatarFor(c)" class="avatar-fallback">👤</span>
                </div>
                <div class="comment-main">
                  <div class="comment-author">
                    {{ commentNameFor(c) }}
                    <span v-if="commentDateFor(c)" class="comment-date"> · {{ commentDateFor(c) }}</span>
                  </div>
                  <div class="comment-text" @click="onDescHtmlClick" v-html="linkify(getCommentText(c))" />
                  <div v-if="extractImageUrls(c).length" class="comment-media">
                    <button
                      v-for="(u, ui) in extractImageUrls(c)"
                      :key="ui"
                      type="button"
                      class="comment-media-item"
                      :aria-label="`View image ${ui + 1}`"
                      @click.prevent.stop="openCommentImages(c, ui)"
                    >
                      <img :src="u" loading="lazy" decoding="async" alt="attachment">
                    </button>
                  </div>
                  <div class="comment-actions" aria-label="Comment ratings (read-only)">
                    <span class="action-btn" title="Thumbs up (open full post to rate)">
                      <span class="icon" aria-hidden="true">👍</span>
                      <span class="count">{{ formatCount((Number(c?.scoreUp) || 0)) }}</span>
                    </span>
                    <span class="action-btn" title="Thumbs down (open full post to rate)">
                      <span class="icon" aria-hidden="true">👎</span>
                      <span class="count">{{ formatCount((Number(c?.scoreDown) || 0)) }}</span>
                    </span>
                  </div>
                  <div v-if="shouldShowRepliesToggle(c)" class="replies-toggle-row">
                    <button class="replies-toggle-btn" @click="toggleRepliesForComment(c)">
                      <template v-if="isRepliesOpen(c)">
                        Hide replies
                      </template>
                      <template v-else>
                        View replies<span v-if="getKnownReplyCount(c) > 0">({{ getKnownReplyCount(c) }})</span>
                      </template>
                    </button>
                  </div>
                  <template v-if="isRepliesOpen(c)">
                    <ul class="replies-list">
                      <li v-for="(rc, ri) in repliesListFor(c)" :key="ri" class="reply-item">
                        <div class="comment-row">
                          <div class="avatar comment-avatar" :style="{ backgroundImage: commentAvatarFor(rc) ? `url('${commentAvatarFor(rc)}')` : '' }">
                            <span v-if="!commentAvatarFor(rc)" class="avatar-fallback">👤</span>
                          </div>
                          <div class="comment-main">
                            <div class="comment-author">
                              {{ commentNameFor(rc) }}
                              <span v-if="commentDateFor(rc)" class="comment-date"> · {{ commentDateFor(rc) }}</span>
                            </div>
                            <div class="comment-text" @click="onDescHtmlClick" v-html="linkify(getCommentText(rc))" />
                            <div v-if="extractImageUrls(rc).length" class="comment-media">
                              <button
                                v-for="(u, ui) in extractImageUrls(rc)"
                                :key="ui"
                                type="button"
                                class="comment-media-item"
                                :aria-label="`View image ${ui + 1}`"
                                @click.prevent.stop="openCommentImages(rc, ui)"
                              >
                                <img :src="u" loading="lazy" decoding="async" alt="attachment">
                              </button>
                            </div>
                            <div class="comment-actions reply-actions" aria-label="Reply ratings (read-only)">
                              <span class="action-btn" title="Thumbs up (open full post to rate)">
                                <span class="icon" aria-hidden="true">👍</span>
                                <span class="count">{{ formatCount((Number(rc?.scoreUp) || 0)) }}</span>
                              </span>
                              <span class="action-btn" title="Thumbs down (open full post to rate)">
                                <span class="icon" aria-hidden="true">👎</span>
                                <span class="count">{{ formatCount((Number(rc?.scoreDown) || 0)) }}</span>
                              </span>
                            </div>
                          </div>
                        </div>
                      </li>
                      <li v-if="!hasInlineReplies(c) && repliesLoading(c)" class="reply-loading">
                        <LoadingSpinner :size="28" aria-label="Loading replies" />
                      </li>
                      <li v-if="!hasInlineReplies(c) && repliesError(c)" class="reply-error text-red">
                        {{ repliesError(c) }}
                      </li>
                    </ul>
                  </template>
                </div>
              </div>
            </li>
          </ul>
        </div>
      </div>
    </div>

    <!-- Settings Drawer (left side) -->
    <div
      class="side-drawer-base settings-drawer"
      :class="{ open: showSettingsDrawer, dragging: settingsDragging }"
      :style="settingsDragging ? { transform: `translateX(-${settingsDragOffset}px)` } : null"
      @click.self="closeAnyDrawer"
    >
      <div class="drawer-content" @click.stop>
        <div
          class="drawer-header"
          @touchstart="onSettingsTouchStart($event, true)"
          @touchmove="onSettingsTouchMove($event)"
          @touchend="onSettingsTouchEnd"
        >
          <h3>Settings</h3>
        </div>
        <div
          class="drawer-body settings-body"
          @touchstart="onSettingsTouchStart($event)"
          @touchmove="onSettingsTouchMove($event)"
          @touchend="onSettingsTouchEnd"
        >
          <div class="lang-section">
            <button
              class="section-title collapsible"
              type="button"
              :aria-expanded="langOpen"
              @click="langOpen = !langOpen"
            >
              <span>Video Language</span>
              <span class="chevron" :class="{ open: langOpen }">▸</span>
            </button>
            <div v-show="langOpen" class="lang-grid">
              <button
                v-for="lang in availableLanguages"
                :key="lang.code"
                class="lang-btn"
                :class="{ active: selectedLanguage === lang.code }"
                type="button"
                :aria-pressed="selectedLanguage === lang.code"
                @click="selectedLanguage = lang.code"
              >
                <span class="flag" aria-hidden="true">{{ lang.flag }}</span>
                <span class="code">{{ lang.code.toUpperCase() }}</span>
                <span class="label">{{ lang.label }}</span>
              </button>
            </div>
            <div v-show="langOpen" class="current-lang">
              Current: {{ selectedLanguage.toUpperCase() }}
            </div>
          </div>
          <div class="playback-section">
            <button
              class="section-title collapsible"
              type="button"
              :aria-expanded="playbackOpen"
              @click="playbackOpen = !playbackOpen"
            >
              <span>Playback</span>
              <span class="chevron" :class="{ open: playbackOpen }">▸</span>
            </button>
            <div v-show="playbackOpen" class="option-group">
              <label class="option-btn" :class="{ active: endBehavior === 'next' }">
                <input
                  v-model="endBehavior"
                  class="radio"
                  type="radio"
                  name="end-behavior"
                  value="next"
                  aria-label="Play next video"
                >
                <span class="label">Play next video</span>
              </label>
              <label class="option-btn" :class="{ active: endBehavior === 'replay' }">
                <input
                  v-model="endBehavior"
                  class="radio"
                  type="radio"
                  name="end-behavior"
                  value="replay"
                  aria-label="Replay current video"
                >
                <span class="label">Replay current video</span>
              </label>
            </div>
            <div v-show="playbackOpen" class="help-text">
              Choose what happens when a video ends.
            </div>
          </div>
          <!-- Feedback section -->
          <div class="feedback-section">
            <button
              class="section-title collapsible"
              type="button"
              :aria-expanded="feedbackOpen"
              @click="feedbackOpen = !feedbackOpen"
            >
              <span>Feedback</span>
              <span class="chevron" :class="{ open: feedbackOpen }">▸</span>
            </button>
            <div v-show="feedbackOpen" class="feedback-form">
              <label class="sr-only" for="feedback-text">Your feedback</label>
              <textarea
                id="feedback-text"
                v-model="feedbackText"
                class="feedback-input"
                rows="4"
                placeholder="Tell us what you think…"
              />
              <div class="feedback-actions">
                <button
                  class="send-btn"
                  type="button"
                  :disabled="feedbackSending || !feedbackText.trim()"
                  @click="submitFeedback($event)"
                >
                  {{ feedbackSending ? 'Sending…' : 'Send feedback' }}
                </button>
              </div>
              <div v-if="feedbackStatus" class="feedback-status" role="status">
                {{ feedbackStatus }}
              </div>
              <div v-if="feedbackError" class="feedback-error text-red" role="alert">
                {{ feedbackError }}
              </div>
            </div>
          </div>
        </div>
        <div class="drawer-footer">
          <a href="#" @click.prevent="openDeveloperProfile($event)">Developer profile</a>
        </div>
      </div>
    </div>

    <!-- Image Viewer Overlay -->
    <template v-if="imageViewerOpen">
      <div class="image-viewer-backdrop" @click.self="closeImageViewer">
        <div class="image-viewer-chrome">
          <button class="iv-close" aria-label="Close" @click.stop="closeImageViewer">
            ✕
          </button>
          <div class="iv-counter">
            {{ imageViewerIndex + 1 }} / {{ imageViewerItems.length }}
          </div>
          <button
            v-if="imageViewerItems.length > 1"
            class="iv-prev"
            aria-label="Previous"
            @click.stop="prevImage"
          >
            ‹
          </button>
          <button
            v-if="imageViewerItems.length > 1"
            class="iv-next"
            aria-label="Next"
            @click.stop="nextImage"
          >
            ›
          </button>
          <a
            v-if="imageViewerItems[imageViewerIndex]"
            class="iv-open"
            :href="imageViewerItems[imageViewerIndex]"
            rel="noopener"
            title="Open externally"
            @click.prevent.stop="handleExternalLink(imageViewerItems[imageViewerIndex], $event)"
          >⤴</a>
        </div>
        <div class="image-viewer-stage" @click.stop>
          <img
            :src="imageViewerItems[imageViewerIndex]"
            class="image-viewer-img"
            alt="image"
            loading="eager"
            decoding="async"
          >
        </div>
      </div>
    </template>
  </div>
</template>

<style scoped>
.shorts-root {
  position: fixed;
  inset: 0;
  background: #000;
}
.center-msg {
  height: 100vh;
  height: 100dvh;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #ddd;
}
.text-red {
  color: #e57373;
}
.pager-root {
  height: 100vh;
  height: 100dvh;
  overflow: hidden;
  touch-action: none; /* let the app handle both vertical and horizontal gestures */
  overscroll-behavior: contain; /* prevent browser/host overscroll effects */
}
.pager-item {
  position: absolute;
  inset: 0;
  height: 100vh;
  height: 100dvh;
  /* Promote to its own layer for smoother animations */
  will-change: transform;
  transform: translateZ(0);
  contain: content;
  backface-visibility: hidden;
  transition: transform 220ms ease;
}
.pager-item.is-current {
  transform: translateY(0%);
}
.pager-item.is-prev {
  transform: translateY(-100%);
}
.pager-item.is-next {
  transform: translateY(100%);
}
.overlay {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  padding: 16px;
  color: #fff;
  background: linear-gradient(
    180deg,
    rgba(0, 0, 0, 0) 0%,
    rgba(0, 0, 0, 0.35) 60%,
    rgba(0, 0, 0, 0.65) 100%
  );
}
.overlay-center {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  pointer-events: none; /* do not block taps */
  opacity: 0;
  transition: opacity 0.25s ease;
  transform: translateY(-8%);
}
.overlay-center.visible {
  opacity: 1;
}
.overlay-loading {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  pointer-events: none; /* do not block taps */
}
.overlay-sound {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: flex-end;
  justify-content: center;
  pointer-events: none; /* allow taps to pass through except the button */
}
.sound-btn {
  pointer-events: auto;
  margin-bottom: 18vh;
  margin-bottom: 18dvh;
  padding: 10px 16px;
  border-radius: 999px;
  border: 1px solid rgba(255, 255, 255, 0.6);
  background: rgba(0, 0, 0, 0.55);
  color: #fff;
  font-weight: 600;
}
.play-icon {
  width: 80px;
  height: 80px;
  border-radius: 50%;
  border: 1px solid rgba(255, 255, 255, 0.5);
  background: rgba(0, 0, 0, 0.45);
  color: #fff;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 36px;
}
.meta {
  max-width: 80ch;
  text-shadow: 0 1px 2px rgba(0, 0, 0, 0.6);
}
.author-row {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 8px;
}
.avatar-wrap {
  position: relative;
  width: 40px;
  height: 40px;
  flex: 0 0 40px;
  cursor: pointer;
}
.avatar {
  width: 100%;
  height: 100%;
  border-radius: 50%;
  background-size: cover;
  background-position: center;
  border: 1px solid rgba(255, 255, 255, 0.5);
  background-color: rgba(0, 0, 0, 0.3);
  display: flex;
  align-items: center;
  justify-content: center;
}
.avatar-fallback {
  font-size: 18px;
}
.reputation-badge {
  position: absolute;
  top: -6px;
  right: -6px;
  padding: 2px 6px;
  height: 18px;
  line-height: 14px;
  font-size: 11px;
  border-radius: 999px;
  background: #222;
  color: #fff;
  border: 1px solid rgba(255, 255, 255, 0.6);
  box-shadow: 0 2px 6px rgba(0, 0, 0, 0.35);
  pointer-events: none;
}
.uploader {
  font-weight: 600;
  margin-bottom: 4px;
  cursor: pointer;
}
.follow-btn {
  padding: 4px 10px;
  border-radius: 999px;
  border: 1px solid rgba(255, 255, 255, 0.6);
  background: rgba(0, 0, 0, 0.35);
  color: #fff;
  font-size: 12px;
  font-weight: 600;
}
.follow-btn.loading,
.follow-btn:disabled {
  opacity: 0.7;
  cursor: default;
}
.follow-btn.following {
  border-color: rgba(255, 255, 255, 0.35);
  background: rgba(0, 0, 0, 0.25);
}
.desc {
  opacity: 0.9;
  font-size: 0.95rem;
  cursor: pointer;
}
.desc-text-trunc {
  display: -webkit-box;
  -webkit-line-clamp: 2;
  line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.desc-meta-row {
  opacity: 0.8;
  font-size: 0.9em;
  color: rgba(255, 255, 255, 0.85);
  margin-top: 4px;
}
.desc-meta {
  opacity: 0.8;
  margin-left: 6px;
  font-size: 0.9em;
  color: rgba(255, 255, 255, 0.85);
}
.seekbar {
  margin-top: 8px;
  position: relative;
  left: -16px; /* extend beyond overlay horizontal padding */
  width: calc(100% + 32px);
}
.seekbar-track {
  width: 100%;
  height: 4px;
  background: rgba(255, 255, 255, 0.25);
  border-radius: 999px;
  overflow: visible; /* allow tooltip/thumb to render outside */
  box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.12);
  position: relative;
  cursor: pointer;
  user-select: none;
  -webkit-user-select: none;
  touch-action: none;
}
.buffer-segment {
  position: absolute;
  top: 0;
  bottom: 0;
  background: rgba(
    110,
    193,
    255,
    0.4
  ); /* translucent light blue for buffered */
}
.seekbar-fill {
  position: relative;
  height: 100%;
  background: #6ec1ff; /* light blue */
  transition: width 120ms linear;
  box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.06) inset;
}
/* Drag handle */
.seekbar-thumb {
  position: absolute;
  top: 50%;
  transform: translate(-50%, -50%);
  width: 12px;
  height: 12px;
  border-radius: 50%;
  background: #6ec1ff;
  box-shadow: 0 0 0 2px rgba(0, 0, 0, 0.3);
  pointer-events: none; /* track handles pointer events */
  z-index: 2;
}
.seekbar-tooltip {
  position: absolute;
  bottom: 100%;
  transform: translateX(-50%);
  margin-bottom: 6px;
  background: rgba(0, 0, 0, 0.8);
  color: #fff;
  padding: 2px 6px;
  border-radius: 4px;
  font-size: 12px;
  white-space: nowrap;
  pointer-events: none;
  z-index: 3;
}
.seekbar-tooltip::after {
  content: '';
  position: absolute;
  top: 100%;
  left: 50%;
  transform: translateX(-50%);
  border: 6px solid transparent;
  border-top-color: rgba(0, 0, 0, 0.8);
}
.video-placeholder {
  width: 100%;
  height: 100%;
  background: #000;
}
.spacer {
  width: 100%;
}

/* Right-side controls */
.right-controls {
  position: absolute;
  right: 10px;
  top: 50%;
  transform: translateY(-50%);
  display: flex;
  flex-direction: column;
  gap: 12px;
  z-index: 8;
}
.comments-btn {
  position: relative;
  width: 44px;
  height: 44px;
  border-radius: 50%;
  border: 1px solid rgba(255, 255, 255, 0.5);
  background: rgba(0, 0, 0, 0.45);
  color: #fff;
  font-size: 20px;
  display: flex;
  align-items: center;
  justify-content: center;
}
.open-post-btn {
  position: relative;
  width: 44px;
  height: 44px;
  border-radius: 50%;
  border: 1px solid rgba(255, 255, 255, 0.5);
  background: rgba(0, 0, 0, 0.45);
  color: #fff;
  font-size: 18px;
  display: flex;
  align-items: center;
  justify-content: center;
}
.settings-btn {
  position: relative;
  width: 44px;
  height: 44px;
  border-radius: 50%;
  border: 1px solid rgba(255, 255, 255, 0.5);
  background: rgba(0, 0, 0, 0.45);
  color: #fff;
  font-size: 18px;
  display: flex;
  align-items: center;
  justify-content: center;
}
.comments-btn .comments-badge {
  position: absolute;
  top: -6px;
  right: -6px;
  min-width: 18px;
  height: 18px;
  padding: 0 5px;
  border-radius: 9px;
  background: #ff5252;
  color: #fff;
  font-size: 11px;
  line-height: 18px;
  text-align: center;
  box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.35);
}

/* Screen tint */
.screen-tint {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.35);
  opacity: 0;
  pointer-events: none;
  transition: opacity 200ms ease;
  z-index: 9;
}
.screen-tint.visible {
  opacity: 1;
  pointer-events: auto;
}

/* Drawers */
.drawer-base {
  position: fixed;
  left: 0;
  right: 0;
  bottom: 0;
  width: 100vw;
  transform: translateY(100%);
  transition: transform 240ms ease;
  z-index: 10;
  display: flex;
  flex-direction: column;
}
.drawer-base.open {
  transform: translateY(0%);
}
.drawer-base.dragging {
  transition: none;
}
.side-drawer-base {
  position: fixed;
  top: 0;
  bottom: 0;
  left: 0;
  width: clamp(280px, 82vw, 420px);
  transform: translateX(-100%);
  transition: transform 240ms ease;
  z-index: 10;
  display: flex;
  flex-direction: column;
}
.side-drawer-base.open {
  transform: translateX(0%);
}
.side-drawer-base.dragging {
  transition: none;
}
.drawer-content {
  width: 100%;
  height: 100%;
  background: rgba(16, 16, 16, 0.98);
  color: #fff;
  display: flex;
  flex-direction: column;
}
.drawer-header {
  position: sticky;
  top: 0;
  background: rgba(16, 16, 16, 1);
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
  padding: 12px 16px;
  z-index: 1;
  text-align: center;
  cursor: grab;
  user-select: none;
  -webkit-user-select: none;
}
.drawer-header h3 {
  margin: 0;
  font-size: 16px;
}
.drawer-body {
  padding: 12px 16px 16px 16px;
  overflow-y: auto;
  -webkit-overflow-scrolling: touch;
}
.comments-body {
  /* Only vertical scrolling; prevent horizontal overflow */
  overflow-y: auto;
  overflow-x: hidden;
  /* Dark scrollbar (Firefox) */
  scrollbar-color: #4a4a4a rgba(0, 0, 0, 0.35);
  scrollbar-width: thin;
}
.comments-body.no-scroll {
  /* While loading, avoid showing any scrollbar */
  overflow: hidden;
}
/* Ensure loading/empty center message fits the body height, not the whole viewport */
.comments-body .center-msg {
  height: 100%;
  min-height: 120px;
}
.comments-notice {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 8px 10px;
  margin: 2px 0 10px 0;
  background: rgba(255, 255, 255, 0.06);
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 8px;
  font-size: 13px;
  color: #ddd;
}
.open-post-inline-btn {
  padding: 6px 10px;
  border-radius: 6px;
  border: 1px solid rgba(255, 255, 255, 0.35);
  background: rgba(0, 0, 0, 0.4);
  color: #fff;
  font-weight: 600;
}
/* Dark scrollbar (WebKit/Blink) */
.comments-body::-webkit-scrollbar {
  width: 10px;
  height: 10px;
}
.comments-body::-webkit-scrollbar-track {
  background: rgba(0, 0, 0, 0.35);
}
.comments-body::-webkit-scrollbar-thumb {
  background-color: #4a4a4a;
  border-radius: 8px;
  border: 2px solid rgba(0, 0, 0, 0.35);
}
.drawer-body a {
  color: #6ec1ff;
  text-decoration: underline;
}

/* Description bottom sheet: min 1/4, max 1/2 viewport height */
.description-drawer {
  height: clamp(25vh, 40vh, 50vh);
}
.desc-title {
  margin: 0 0 8px 0;
  font-size: 18px;
  font-weight: 600;
}
.desc-text {
  line-height: 1.4;
}
.hashtags-row {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 12px;
}
.hashtags-row .hashtag {
  color: #9bd1ff;
  text-decoration: none;
  background: rgba(110, 193, 255, 0.12);
  border: 1px solid rgba(110, 193, 255, 0.25);
  padding: 2px 8px;
  border-radius: 999px;
}

/* Comments bottom sheet: up to 2/3 viewport height, dynamic */
.comments-drawer {
  max-height: 66.6667vh;
  transition: height 200ms ease-in-out;
  will-change: height;
}
.comments-drawer.no-anim {
  transition: none;
}
.no-comments {
  opacity: 0.8;
}
/* Comments list */
.comments-list {
  list-style: none;
  padding: 0;
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.comment-item {
  padding: 6px 0 10px 0;
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
}
.comment-item:last-child {
  border-bottom: none;
}
.comment-row {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 10px;
  align-items: start;
}
.comment-main {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.comment-author {
  font-size: 13px;
  font-weight: 600;
  opacity: 0.95;
}
.comment-date {
  opacity: 0.8;
  margin-left: 6px;
  font-weight: 400;
  font-size: 12px;
  color: rgba(255, 255, 255, 0.8);
}
.comment-text {
  line-height: 1.35;
  white-space: pre-wrap; /* preserve newlines */
  overflow-wrap: anywhere; /* break long URLs/strings */
  word-break: break-word;
}
.author-row {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 4px;
}
.avatar {
  width: 28px;
  height: 28px;
  border-radius: 50%;
  background-size: cover;
  background-position: center;
  background-repeat: no-repeat;
  background-color: rgba(255, 255, 255, 0.15);
  display: flex;
  align-items: center;
  justify-content: center;
  color: #fff;
  font-size: 16px;
  flex-shrink: 0;
  overflow: hidden;
}
.author-avatar {
  width: 32px;
  height: 32px;
}
.avatar-fallback {
  opacity: 0.85;
}

.retry-btn {
  padding: 6px 10px;
  border-radius: 6px;
  border: 1px solid rgba(255, 255, 255, 0.35);
  background: rgba(0, 0, 0, 0.4);
  color: #fff;
}

/* Comment media grid */
.comment-media {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 6px;
  margin-top: 6px;
}
.comment-media-item {
  position: relative;
  padding: 0;
  border: none;
  background: transparent;
  border-radius: 6px;
  overflow: hidden;
  cursor: pointer;
  aspect-ratio: 1 / 1; /* ensure tiles have height so images are visible */
}
.comment-media-item img {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: cover;
}

/* Comment actions: thumbs up/down counts */
.comment-actions {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  margin-top: 6px;
  opacity: 0.9;
}
.comment-actions .action-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: #ddd;
  background: rgba(255, 255, 255, 0.06);
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 999px;
  padding: 4px 8px;
}
.comment-actions .action-btn .icon {
  line-height: 1;
}
.comment-actions .action-btn .count {
  opacity: 0.95;
}
.reply-actions {
  opacity: 0.85;
  font-size: 12px;
}

/* Replies toggle row */
.replies-toggle-row {
  margin-top: 6px;
}
.replies-toggle-btn {
  padding: 6px 10px;
  border-radius: 999px;
  border: 1px solid rgba(110, 193, 255, 0.25);
  background: rgba(110, 193, 255, 0.12);
  color: #9bd1ff;
  font-size: 12px;
  font-weight: 600;
}

/* Image viewer overlay */
.image-viewer-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.9);
  z-index: 20;
  display: flex;
  align-items: center;
  justify-content: center;
}
.image-viewer-stage {
  max-width: 96vw;
  max-height: 92vh;
  display: flex;
  align-items: center;
  justify-content: center;
}
.image-viewer-img {
  max-width: 96vw;
  max-height: 92vh;
  width: auto;
  height: auto;
  object-fit: contain;
  border-radius: 8px;
  box-shadow: 0 10px 30px rgba(0, 0, 0, 0.5);
}
.image-viewer-chrome {
  position: fixed;
  top: 10px;
  left: 10px;
  right: 10px;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  pointer-events: none;
}
.image-viewer-chrome > * {
  pointer-events: auto;
}
.iv-close,
.iv-prev,
.iv-next,
.iv-open {
  background: rgba(0, 0, 0, 0.5);
  color: #fff;
  border: 1px solid rgba(255, 255, 255, 0.4);
  border-radius: 6px;
  padding: 6px 10px;
  font-size: 16px;
}
.iv-prev,
.iv-next {
  position: fixed;
  top: 50%;
  transform: translateY(-50%);
}
.iv-prev {
  left: 12px;
}
.iv-next {
  right: 12px;
}
.iv-open {
  position: fixed;
  top: 10px;
  right: 10px;
  text-decoration: none;
}
.iv-close {
  position: fixed;
  top: 10px;
  left: 10px;
}
.iv-counter {
  position: fixed;
  top: 12px;
  left: 50%;
  transform: translateX(-50%);
  color: #fff;
  background: rgba(0, 0, 0, 0.5);
  border: 1px solid rgba(255, 255, 255, 0.35);
  border-radius: 999px;
  padding: 4px 10px;
  font-size: 13px;
}
/* Settings: Language selector */
.settings-body .lang-section {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.settings-body .section-title {
  font-size: 14px;
  font-weight: 600;
  opacity: 0.95;
}
.settings-body .lang-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
}
@media (min-width: 420px) {
  .settings-body .lang-grid {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }
}
.settings-body .lang-btn {
  display: grid;
  grid-template-columns: auto auto 1fr;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  background: rgba(255, 255, 255, 0.06);
  border: 1px solid rgba(255, 255, 255, 0.14);
  border-radius: 10px;
  color: #fff;
  font-weight: 600;
}
.settings-body .lang-btn.active {
  background: rgba(110, 193, 255, 0.16);
  border-color: rgba(110, 193, 255, 0.35);
}
.settings-body .lang-btn .flag {
  font-size: 18px;
  line-height: 1;
}
.settings-body .lang-btn .code {
  font-size: 12px;
  opacity: 0.9;
}
.settings-body .lang-btn .label {
  font-size: 12px;
  opacity: 0.8;
}
.settings-body .current-lang {
  margin-top: 2px;
  font-size: 12px;
  opacity: 0.85;
}
/* Settings: Playback end behavior */
.settings-body .playback-section {
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin-top: 12px;
}
.settings-body .option-group {
  display: grid;
  grid-template-columns: 1fr;
  gap: 8px;
}
.settings-body .option-btn {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 10px;
  background: rgba(255, 255, 255, 0.06);
  border: 1px solid rgba(255, 255, 255, 0.14);
  border-radius: 10px;
  color: #fff;
  font-weight: 600;
}
.settings-body .option-btn.active {
  background: rgba(110, 193, 255, 0.16);
  border-color: rgba(110, 193, 255, 0.35);
}
.settings-body .option-btn .radio {
  accent-color: #6ec1ff;
}
.settings-body .help-text {
  margin-top: 2px;
  font-size: 12px;
  opacity: 0.85;
}
/* Settings: Feedback */
.settings-body .feedback-section {
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin-top: 12px;
}
.settings-body .feedback-form {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.settings-body .feedback-input {
  width: 100%;
  padding: 8px 10px;
  background: rgba(255, 255, 255, 0.06);
  border: 1px solid rgba(255, 255, 255, 0.14);
  border-radius: 8px;
  color: #fff;
  font-family: inherit;
}
.settings-body .feedback-actions {
  display: flex;
  align-items: center;
  gap: 10px;
}
.settings-body .send-btn,
.settings-body .link-btn {
  padding: 8px 10px;
  background: rgba(255, 255, 255, 0.06);
  border: 1px solid rgba(255, 255, 255, 0.14);
  border-radius: 8px;
  color: #fff;
  font-weight: 600;
}
.settings-body .send-btn:disabled {
  opacity: 0.6;
}
.drawer-footer {
  margin-top: auto;
  padding: 10px 16px 16px 16px;
  border-top: 1px solid rgba(255, 255, 255, 0.08);
}
.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}
</style>
