<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import HlsVideo from '~/components/HlsVideo.vue'
import PerfOverlay from '~/components/PerfOverlay.vue'
import LoadingSpinner from '~/components/LoadingSpinner.vue'
import { appConfig } from '~/config'
import { SdkService } from '~/composables'

interface PeertubeInfo { hlsUrl: string }

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

// Drawer state
const showDescriptionDrawer = ref(false)
const showCommentsDrawer = ref(false)

// Comments state (cache by post hash)
interface CommentState { items: any[], loading: boolean, error: string | null, fetchedAt: number }
const commentsByHash = ref<Record<string, CommentState>>({})

// Avatars cache (by address)
const avatarsByAddress = ref<Record<string, string>>({})
// Names cache (by address)
const namesByAddress = ref<Record<string, string>>({})

// Helper: resolve author address of a video item
function getAuthorAddress(it: any): string | null {
  return (
    it?.rawPost?.author_address
    ?? it?.uploaderAddress
    ?? null
  )
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

// Batch fetch profiles and cache avatar URLs by address
async function fetchProfiles(addresses: Set<string>) {
  const todo = Array.from(addresses).filter(a => a && !avatarsByAddress.value[a])
  if (todo.length === 0)
    return

  const chunkSize = 70
  for (let i = 0; i < todo.length; i += chunkSize) {
    const chunk = todo.slice(i, i + chunkSize)
    try {
      const params: any[] = [chunk, '1'] // '1' => light profile
      const res: unknown = await SdkService.rpc('getuserprofile', params)
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

const currentComments = computed<CommentState | undefined>(() => {
  const h = currentVideoHash.value
  return h ? commentsByHash.value[h] : undefined
})

// Lazy rendering state: visible count per hash
const visibleCountByHash = ref<Record<string, number>>({})

function getVisibleCount(hash: string): number {
  if (!visibleCountByHash.value[hash])
    visibleCountByHash.value[hash] = 10
  return visibleCountByHash.value[hash]
}

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
    }
  }
}

function ensureCommentState(hash: string): CommentState {
  if (!commentsByHash.value[hash])
    commentsByHash.value[hash] = { items: [], loading: false, error: null, fetchedAt: 0 }
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
    let items: any[] = []
    if (Array.isArray(res))
      items = res
    else if (res?.comments && Array.isArray(res.comments))
      items = res.comments
    else if (res?.result && Array.isArray(res.result))
      items = res.result
    else if (res?.data && Array.isArray(res.data))
      items = res.data
    state.items = items
    state.fetchedAt = Date.now()
    if (!visibleCountByHash.value[hash])
      visibleCountByHash.value[hash] = Math.min(10, state.items.length || 10)
  }
  catch (e: any) {
    state.error = e?.message || String(e)
  }
  finally {
    state.loading = false
  }
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

// Load comments when opening the drawer or switching videos while open
watch(showCommentsDrawer, (open) => {
  if (open)
    fetchCommentsForCurrentIfNeeded()
  if (open) {
    const h = currentVideoHash.value
    if (h && !visibleCountByHash.value[h])
      visibleCountByHash.value[h] = 10
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
watch(currentIndex, () => {
  void fetchProfiles(collectAddressesForCurrent())
})
watch(showCommentsDrawer, (open) => {
  if (open)
    void fetchProfiles(collectAddressesForCurrent())
})
watch(() => currentComments.value?.items, () => {
  void fetchProfiles(collectAddressesForCurrent())
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

const descCaption = computed(() => getCaption(currentItem.value))
const descText = computed(() => getDescription(currentItem.value))
const descHtml = computed(() => linkify(descText.value || ''))
const descTags = computed(() => parseHashtags(currentItem.value?.rawPost?.hashtags ?? (currentItem.value as any)?.hashtags))

// Comments count for badge (not tied to height)
const commentsCount = computed(() => {
  const c = (currentItem.value as any)?.comments ?? (currentItem.value as any)?.rawPost?.comments
  const n = Number(c)
  return Number.isFinite(n) && n >= 0 ? n : 0
})

// Dynamic comments drawer height: measure content and cap at 2/3 viewport
const commentsHeaderEl = ref<HTMLElement | null>(null)
const commentsBodyEl = ref<HTMLElement | null>(null)
const commentsHeightVh = ref<number>(36)
const growOnlyOpenPhase = ref<boolean>(false)
let growOnlyTimer: number | null = null

function recomputeCommentsHeight() {
  // Skip measuring when the drawer is closed to avoid jarring first measurement
  if (!showCommentsDrawer.value)
    return
  const vhPx = window.innerHeight || document.documentElement.clientHeight || 0
  if (!vhPx)
    return
  const headerH = commentsHeaderEl.value?.getBoundingClientRect().height ?? 0
  const bodyEl = commentsBodyEl.value
  const bodyContentH = bodyEl?.scrollHeight ?? bodyEl?.getBoundingClientRect().height ?? 0
  // Ensure a reasonable minimum body height so the drawer is usable even with spinner/empty state
  const minBody = 140
  const contentPx = Math.max(bodyContentH, minBody)
  const maxPx = (2 / 3) * vhPx
  const desiredPx = Math.min(headerH + contentPx, maxPx)
  const targetVh = (desiredPx / vhPx) * 100
  const capped = Math.min(Math.max(targetVh, 36), 66.6667)
  // During open phase, only allow the drawer to grow, not shrink
  if (growOnlyOpenPhase.value && capped < commentsHeightVh.value)
    return
  commentsHeightVh.value = capped
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
      recomputeCommentsHeight()
    })
    commentsBodyRO.observe(el)
  }
})
watch([() => currentComments.value?.items?.length, showCommentsDrawer], async () => {
  if (showCommentsDrawer.value) {
    commentsHeightVh.value = 36
    growOnlyOpenPhase.value = true
    if (growOnlyTimer)
      clearTimeout(growOnlyTimer)
    growOnlyTimer = window.setTimeout(() => {
      growOnlyOpenPhase.value = false
      growOnlyTimer = null
    }, 600)
  }
  await nextTick()
  recomputeCommentsHeight()
})
watch(currentIndex, async () => {
  await nextTick()
  recomputeCommentsHeight()
})
onMounted(() => {
  window.addEventListener('resize', recomputeCommentsHeight)
})
onBeforeUnmount(() => {
  window.removeEventListener('resize', recomputeCommentsHeight)
  if (commentsBodyRO)
    commentsBodyRO.disconnect()
  if (growOnlyTimer)
    clearTimeout(growOnlyTimer)
})

function toggleCommentsDrawer(ev?: Event) {
  ev?.stopPropagation?.()
  const willOpen = !showCommentsDrawer.value
  if (willOpen) {
    commentsHeightVh.value = 36
    growOnlyOpenPhase.value = true
    if (growOnlyTimer)
      clearTimeout(growOnlyTimer)
    growOnlyTimer = window.setTimeout(() => {
      growOnlyOpenPhase.value = false
      growOnlyTimer = null
    }, 600)
  }
  showCommentsDrawer.value = !showCommentsDrawer.value
  if (showCommentsDrawer.value)
    showDescriptionDrawer.value = false
}
function openDescriptionDrawer(ev?: Event) {
  ev?.stopPropagation?.()
  showDescriptionDrawer.value = true
  showCommentsDrawer.value = false
}
function closeAnyDrawer() {
  showDescriptionDrawer.value = false
  showCommentsDrawer.value = false
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

async function loadPlaylist() {
  try {
    loading.value = true
    const res = await fetch('/playlists/en/latest.json', { cache: 'no-store' })
    if (!res.ok)
      throw new Error(`Failed to load playlist: ${res.status}`)
    const data = await res.json()
    items.value = (Array.isArray(data) ? data : []).filter((it: VideoItem) => !!getHls(it))
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
  const dt = performance.now() - touchStartTime
  if (Math.abs(dy) > 50 && dt < 800) {
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

onMounted(() => {
  void loadPlaylist()
})

onBeforeUnmount(() => {
  // Safety: remove pointer listeners if scrubbing during unmount
  window.removeEventListener('pointermove', onWindowPointerMove)
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

    <div
      v-else
      ref="pagerRef"
      class="pager-root"
      tabindex="0"
      @wheel="onWheel"
      @touchstart.passive="onTouchStart"
      @touchend.passive="onTouchEnd"
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
          :loop="true"
          :muted="!(soundOn && vi.idx === currentIndex && !paused)"
          :should-load="shouldLoad(vi.idx)"
          :should-play="shouldPlay(vi.idx)"
          @loading-change="onVideoLoadingChange(vi.idx, $event)"
          @progress="onVideoProgress(vi.idx, $event)"
          @buffered="onVideoBuffered(vi.idx, $event)"
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
          <LoadingSpinner :size="72" pad="14%" aria-label="Loading video" />
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
              <div class="avatar author-avatar" :style="{ backgroundImage: authorAvatarFor(vi.item) ? `url('${authorAvatarFor(vi.item)}')` : '' }">
                <span v-if="!authorAvatarFor(vi.item)" class="avatar-fallback">👤</span>
              </div>
              <div class="uploader">
                {{ vi.item.uploader || 'Unknown' }}
              </div>
            </div>
            <div class="desc" title="View description" @click.stop="openDescriptionDrawer">
              {{ vi.item.description }}
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
        </div>
      </section>
    </div>
    <!-- Screen tint overlay when any drawer is open -->
    <div class="screen-tint" :class="{ visible: showDescriptionDrawer || showCommentsDrawer }" @click="closeAnyDrawer" />

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
          <template v-if="descCaption">
            <h4 class="desc-title">
              {{ descCaption }}
            </h4>
          </template>
          <div class="desc-text" @click="onDescHtmlClick" v-html="descHtml" />
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
      :class="{ open: showCommentsDrawer, dragging: draggingWhich === 'comments' }"
      :style="[
        { '--comments-height': `${commentsHeightVh}vh` },
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
          <h3>Comments</h3>
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
          <div v-if="!currentVideoHash" class="no-comments">
            No post id
          </div>
          <div v-else-if="currentComments?.loading" class="center-msg">
            <LoadingSpinner :size="40" aria-label="Loading comments" />
          </div>
          <div v-else-if="currentComments?.error" class="center-msg text-red">
            {{ currentComments.error }}
            <div style="margin-top: 8px;">
              <button class="retry-btn" @click="refreshComments">
                Retry
              </button>
            </div>
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
                  </div>
                  <div class="comment-text" @click="onDescHtmlClick" v-html="linkify(getCommentText(c))" />
                </div>
              </div>
            </li>
          </ul>
        </div>
      </div>
    </div>
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
  touch-action: pan-x; /* allow vertical swipes to be handled */
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
.uploader {
  font-weight: 600;
  margin-bottom: 4px;
}
.desc {
  opacity: 0.9;
  font-size: 0.95rem;
  cursor: pointer;
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
  height: min(var(--comments-height, 36vh), 66.6667vh);
  transition: height 200ms ease-in-out;
  will-change: height;
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
</style>
