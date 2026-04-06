// player.js — Full custom controls player

import * as api from './api.js'

let progressInterval = null
let currentItemId = null
let currentSubtitleTracks = []
let hlsInstance = null
let activeSubtitleIndex = null

function loadHlsJs() {
  return new Promise((resolve, reject) => {
    if (window.Hls) { resolve(window.Hls); return }
    const script = document.createElement('script')
    script.src = 'https://cdn.jsdelivr.net/npm/hls.js@latest/dist/hls.min.js'
    script.onload = () => resolve(window.Hls)
    script.onerror = reject
    document.head.appendChild(script)
  })
}

export async function openPlayer(itemId, title) {
  let subtitleTracks = []
  try {
    const info = await api.getMediaInfo(itemId)
    const source = info.MediaSources?.[0]
    if (source) subtitleTracks = (source.MediaStreams || []).filter(s => s.Type === 'Subtitle')
  } catch {}
  currentSubtitleTracks = subtitleTracks
  activeSubtitleIndex = null

  if (subtitleTracks.length > 0) {
    showSubtitlePicker(itemId, title, subtitleTracks, true)
  } else {
    startPlayback(itemId, title, null, null)
  }
}

function showSubtitlePicker(itemId, title, tracks, isPrePlay = false, video = null) {
  document.getElementById('subtitle-picker')?.remove()
  const overlay = document.createElement('div')
  overlay.id = 'subtitle-picker'
  overlay.style.cssText = `position:fixed;inset:0;z-index:70;background:rgba(0,0,0,0.75);display:flex;align-items:center;justify-content:center;backdrop-filter:blur(6px);`
  overlay.innerHTML = `
    <div style="background:#1a1a1a;border:1px solid rgba(255,255,255,0.1);border-radius:16px;padding:24px;width:340px;max-width:90vw;">
      <h3 style="font-family:'Outfit',sans-serif;font-size:15px;font-weight:700;margin:0 0 16px;color:#fff;">${isPrePlay ? 'Select Subtitles' : 'Change Subtitles'}</h3>
      <div style="display:flex;flex-direction:column;gap:6px;max-height:280px;overflow-y:auto;">
        <button class="sub-btn" data-index="-1" style="text-align:left;padding:10px 14px;border-radius:10px;border:1px solid ${activeSubtitleIndex === null ? '#00a4dc' : 'rgba(255,255,255,0.08)'};background:${activeSubtitleIndex === null ? 'rgba(0,164,220,0.2)' : 'rgba(255,255,255,0.05)'};color:${activeSubtitleIndex === null ? '#fff' : '#ccc'};font-size:13px;cursor:pointer;">Off</button>
        ${tracks.map(t => `
          <button class="sub-btn" data-index="${t.Index}" data-lang="${t.Language || 'und'}" data-label="${t.DisplayTitle || t.Language || 'Track ' + t.Index}" style="text-align:left;padding:10px 14px;border-radius:10px;border:1px solid ${activeSubtitleIndex === t.Index ? '#00a4dc' : 'rgba(255,255,255,0.08)'};background:${activeSubtitleIndex === t.Index ? 'rgba(0,164,220,0.2)' : 'rgba(255,255,255,0.05)'};color:${activeSubtitleIndex === t.Index ? '#fff' : '#ccc'};font-size:13px;cursor:pointer;">
            ${t.DisplayTitle || t.Language || 'Track ' + t.Index}${t.IsDefault ? ' ★' : ''}
          </button>
        `).join('')}
      </div>
      <div style="display:flex;gap:8px;margin-top:16px;">
        <button id="sub-cancel" style="flex:1;padding:10px;border-radius:10px;border:1px solid rgba(255,255,255,0.1);background:transparent;color:#888;font-size:13px;cursor:pointer;">Cancel</button>
        <button id="sub-confirm" style="flex:2;padding:10px;border-radius:10px;border:none;background:#00a4dc;color:#fff;font-size:13px;font-weight:600;cursor:pointer;">${isPrePlay ? '▶ Play' : 'Apply'}</button>
      </div>
    </div>
  `
  document.body.appendChild(overlay)
  let selectedIndex = activeSubtitleIndex

  overlay.querySelectorAll('.sub-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      overlay.querySelectorAll('.sub-btn').forEach(b => { b.style.background = 'rgba(255,255,255,0.05)'; b.style.borderColor = 'rgba(255,255,255,0.08)'; b.style.color = '#ccc' })
      btn.style.background = 'rgba(0,164,220,0.2)'; btn.style.borderColor = '#00a4dc'; btn.style.color = '#fff'
      selectedIndex = parseInt(btn.dataset.index)
    })
  })

  document.getElementById('sub-cancel').addEventListener('click', () => overlay.remove())
  document.getElementById('sub-confirm').addEventListener('click', () => {
    overlay.remove()
    const idx = selectedIndex === -1 ? null : selectedIndex
    const trackInfo = tracks.find(t => t.Index === idx)
    if (isPrePlay) { startPlayback(itemId, title, idx, trackInfo) }
    else { applySubtitleTrack(video, itemId, idx, trackInfo) }
  })
}

function applySubtitleTrack(video, itemId, subtitleIndex, trackInfo = null) {
  activeSubtitleIndex = subtitleIndex
  if (!video) return
  Array.from(video.querySelectorAll('track')).forEach(t => t.remove())
  Array.from(video.textTracks).forEach(t => t.mode = 'hidden')
  if (subtitleIndex !== null && subtitleIndex >= 0) {
    const track = document.createElement('track')
    track.kind = 'subtitles'
    track.src = api.subtitleUrl(itemId, subtitleIndex)
    track.srclang = trackInfo?.Language || 'und'
    track.label = trackInfo?.DisplayTitle || trackInfo?.Language || 'Subtitles'
    track.default = true
    video.appendChild(track)
    const activate = () => { Array.from(video.textTracks).forEach(t => t.mode = 'hidden'); if (video.textTracks[0]) video.textTracks[0].mode = 'showing' }
    setTimeout(activate, 200); setTimeout(activate, 800)
  }
  updateCCButton()
}

function updateCCButton() {
  const btn = document.getElementById('cc-btn')
  if (btn) btn.style.color = activeSubtitleIndex !== null ? '#00a4dc' : '#fff'
}

async function startPlayback(itemId, title, subtitleIndex, trackInfo) {
  currentItemId = itemId
  activeSubtitleIndex = subtitleIndex
  const Hls = await loadHlsJs().catch(() => null)
  const directUrl = api.streamUrl(itemId)

  const overlay = document.createElement('div')
  overlay.id = 'player-overlay'
  overlay.style.cssText = 'position:fixed;inset:0;z-index:50;background:#000;display:flex;flex-direction:column;cursor:none;'
  overlay.innerHTML = `
    <video id="jellyfin-video" style="width:100%;height:100%;object-fit:contain;" preload="auto">
      ${subtitleIndex !== null ? `<track id="sub-track" kind="subtitles" src="${api.subtitleUrl(itemId, subtitleIndex)}" srclang="${trackInfo?.Language || 'und'}" label="${trackInfo?.DisplayTitle || 'Subtitles'}" default />` : ''}
    </video>

    <!-- Gear dropdown -->
    <div id="gear-dropdown" style="
      position:absolute;bottom:70px;right:160px;z-index:20;
      background:#1a1a1a;border:1px solid rgba(255,255,255,0.12);border-radius:12px;
      padding:8px;min-width:180px;display:none;
      box-shadow:0 8px 32px rgba(0,0,0,0.6);
    ">
      <p style="font-size:10px;font-weight:700;color:#555;text-transform:uppercase;letter-spacing:0.08em;margin:4px 8px 8px;">Stream Quality</p>
      <button class="gear-opt" data-mode="direct" style="width:100%;text-align:left;padding:8px 12px;border-radius:8px;border:none;background:rgba(0,164,220,0.15);color:#00a4dc;font-size:13px;cursor:pointer;font-weight:600;margin-bottom:2px;">▶ Direct Stream</button>
      <button class="gear-opt" data-mode="hls-1080" style="width:100%;text-align:left;padding:8px 12px;border-radius:8px;border:none;background:transparent;color:#ccc;font-size:13px;cursor:pointer;margin-bottom:2px;">⚡ HLS 1080p</button>
      <button class="gear-opt" data-mode="hls-720" style="width:100%;text-align:left;padding:8px 12px;border-radius:8px;border:none;background:transparent;color:#ccc;font-size:13px;cursor:pointer;margin-bottom:2px;">⚡ HLS 720p</button>
      <button class="gear-opt" data-mode="hls-480" style="width:100%;text-align:left;padding:8px 12px;border-radius:8px;border:none;background:transparent;color:#ccc;font-size:13px;cursor:pointer;">⚡ HLS 480p</button>
    </div>

    <!-- Custom controls -->
    <div id="player-controls" style="
      position:absolute;bottom:0;left:0;right:0;z-index:10;
      background:linear-gradient(to top,rgba(0,0,0,0.9) 0%,transparent 100%);
      padding:0 20px 16px;transition:opacity 0.3s;
    ">
      <!-- Progress bar -->
      <div id="progress-container" style="position:relative;height:32px;display:flex;align-items:center;cursor:pointer;margin-bottom:4px;">
        <div id="progress-track" style="width:100%;height:4px;background:rgba(255,255,255,0.2);border-radius:4px;position:relative;overflow:visible;">
          <div id="progress-buffer" style="position:absolute;left:0;top:0;height:100%;background:rgba(255,255,255,0.15);border-radius:4px;width:0%;"></div>
          <div id="progress-fill" style="position:absolute;left:0;top:0;height:100%;background:#00a4dc;border-radius:4px;width:0%;"></div>
          <div id="progress-thumb" style="position:absolute;top:50%;width:14px;height:14px;background:#fff;border-radius:50%;transform:translate(-50%,-50%);left:0%;box-shadow:0 2px 6px rgba(0,0,0,0.5);opacity:0;transition:opacity 0.15s;"></div>
        </div>
        <div id="time-tooltip" style="
          position:absolute;bottom:28px;background:rgba(0,0,0,0.85);color:#fff;
          font-size:12px;font-weight:600;padding:4px 8px;border-radius:6px;
          pointer-events:none;display:none;transform:translateX(-50%);white-space:nowrap;
        "></div>
      </div>

      <!-- Buttons row -->
      <div style="display:flex;align-items:center;gap:12px;">
        <button id="play-pause-btn" style="background:none;border:none;color:#fff;font-size:22px;cursor:pointer;width:32px;text-align:center;line-height:1;">▶</button>
        <span id="time-display" style="font-size:12px;color:#ccc;white-space:nowrap;min-width:90px;">0:00 / 0:00</span>
        <div style="flex:1;"></div>
        <button id="cc-btn" style="border:none;color:#fff;font-size:12px;font-weight:700;cursor:pointer;padding:5px 9px;border-radius:6px;background:rgba(255,255,255,0.12);">CC</button>
        <button id="gear-btn" title="Stream quality" style="border:none;color:#ccc;font-size:16px;cursor:pointer;padding:5px 9px;border-radius:6px;background:rgba(255,255,255,0.12);">⚙</button>
        <button id="fullscreen-btn" style="border:none;color:#fff;font-size:17px;cursor:pointer;padding:5px 9px;border-radius:6px;background:rgba(255,255,255,0.12);">⛶</button>
        <button id="close-player" style="background:rgba(255,255,255,0.12);border:none;color:#fff;padding:6px 14px;border-radius:8px;cursor:pointer;font-size:12px;font-weight:500;">✕ Close</button>
      </div>
    </div>

    <!-- Title top bar -->
    <div id="player-topbar" style="position:absolute;top:0;left:0;right:0;z-index:10;padding:14px 20px;background:linear-gradient(to bottom,rgba(0,0,0,0.8),transparent);transition:opacity 0.3s;">
      <span style="font-family:'Outfit',sans-serif;font-weight:600;font-size:14px;color:#fff;">${title}</span>
    </div>

    <div id="player-notice" style="position:absolute;bottom:90px;left:50%;transform:translateX(-50%);background:rgba(0,0,0,0.85);color:#fff;font-size:12px;padding:8px 16px;border-radius:8px;display:none;pointer-events:none;white-space:nowrap;"></div>
  `
  document.body.appendChild(overlay)

  const video = document.getElementById('jellyfin-video')
  const controls = document.getElementById('player-controls')
  const topbar = document.getElementById('player-topbar')
  const progressFill = document.getElementById('progress-fill')
  const progressBuffer = document.getElementById('progress-buffer')
  const progressThumb = document.getElementById('progress-thumb')
  const progressContainer = document.getElementById('progress-container')
  const timeTooltip = document.getElementById('time-tooltip')
  const timeDisplay = document.getElementById('time-display')
  const playPauseBtn = document.getElementById('play-pause-btn')
  const notice = document.getElementById('player-notice')
  const gearDropdown = document.getElementById('gear-dropdown')
  let usingHls = false
  let currentMode = 'direct'

  function showNotice(msg, color = '#fff') {
    notice.textContent = msg; notice.style.color = color; notice.style.display = 'block'
    clearTimeout(notice._t); notice._t = setTimeout(() => notice.style.display = 'none', 3000)
  }

  function formatTime(s) {
    if (!isFinite(s)) return '0:00'
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = Math.floor(s % 60)
    return h > 0 ? `${h}:${String(m).padStart(2,'0')}:${String(sec).padStart(2,'0')}` : `${m}:${String(sec).padStart(2,'0')}`
  }

  // Controls visibility
  let hideTimer
  function showControls() {
    controls.style.opacity = '1'; topbar.style.opacity = '1'
    overlay.style.cursor = 'default'
    clearTimeout(hideTimer)
    hideTimer = setTimeout(() => {
      if (!video.paused && gearDropdown.style.display === 'none') {
        controls.style.opacity = '0'; topbar.style.opacity = '0'; overlay.style.cursor = 'none'
      }
    }, 3000)
  }
  overlay.addEventListener('mousemove', showControls)
  overlay.addEventListener('click', (e) => { if (e.target === overlay || e.target === video) togglePlayPause() })
  showControls()

  // Play/Pause
  function togglePlayPause() {
    if (video.paused) { video.play(); playPauseBtn.textContent = '⏸' }
    else { video.pause(); playPauseBtn.textContent = '▶'; showControls() }
  }
  playPauseBtn.addEventListener('click', togglePlayPause)
  video.addEventListener('play', () => { playPauseBtn.textContent = '⏸' })
  video.addEventListener('pause', () => { playPauseBtn.textContent = '▶'; showControls() })

  // Progress
  video.addEventListener('timeupdate', () => {
    if (!video.duration) return
    const pct = (video.currentTime / video.duration) * 100
    progressFill.style.width = pct + '%'
    progressThumb.style.left = pct + '%'
    timeDisplay.textContent = `${formatTime(video.currentTime)} / ${formatTime(video.duration)}`
    if (video.currentTime / video.duration > 0.9) api.markWatched(itemId)
  })
  video.addEventListener('progress', () => {
    if (!video.duration || !video.buffered.length) return
    progressBuffer.style.width = (video.buffered.end(video.buffered.length - 1) / video.duration * 100) + '%'
  })

  progressContainer.addEventListener('mouseenter', () => progressThumb.style.opacity = '1')
  progressContainer.addEventListener('mouseleave', () => { progressThumb.style.opacity = '0'; timeTooltip.style.display = 'none' })
  progressContainer.addEventListener('mousemove', (e) => {
    const rect = document.getElementById('progress-track').getBoundingClientRect()
    const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width))
    progressThumb.style.left = (pct * 100) + '%'
    timeTooltip.style.display = 'block'
    timeTooltip.textContent = formatTime(pct * (video.duration || 0))
    timeTooltip.style.left = (pct * 100) + '%'
  })

  let isSeeking = false
  function seekTo(e) {
    const rect = document.getElementById('progress-track').getBoundingClientRect()
    video.currentTime = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width)) * video.duration
  }
  progressContainer.addEventListener('mousedown', (e) => { isSeeking = true; seekTo(e) })
  document.addEventListener('mousemove', (e) => { if (isSeeking) seekTo(e) })
  document.addEventListener('mouseup', () => { isSeeking = false })

  // ── Stream switching ──────────────────────────────────────────────────────
  function updateGearHighlight(mode) {
    currentMode = mode
    document.querySelectorAll('.gear-opt').forEach(b => {
      const active = b.dataset.mode === mode
      b.style.background = active ? 'rgba(0,164,220,0.15)' : 'transparent'
      b.style.color = active ? '#00a4dc' : '#ccc'
    })
    const gearBtn = document.getElementById('gear-btn')
    if (gearBtn) gearBtn.style.color = mode === 'direct' ? '#ccc' : '#00a4dc'
  }

  function playDirect() {
    if (hlsInstance) { hlsInstance.destroy(); hlsInstance = null }
    video.src = directUrl; video.load(); video.play().catch(() => {})
    usingHls = false
    updateGearHighlight('direct')
  }

  function playHls(width, height, bitrate, mode) {
    usingHls = true
    updateGearHighlight(mode)
    const hlsUrl = api.hlsStreamUrl(itemId, width, height, bitrate)
    if (Hls && Hls.isSupported()) {
      if (hlsInstance) hlsInstance.destroy()
      hlsInstance = new Hls({ maxBufferLength: 60, maxMaxBufferLength: 120 })
      hlsInstance.loadSource(hlsUrl)
      hlsInstance.attachMedia(video)
      hlsInstance.on(Hls.Events.MANIFEST_PARSED, () => video.play().catch(() => {}))
      hlsInstance.on(Hls.Events.ERROR, (_, d) => { if (d.fatal) showNotice('HLS error: ' + d.details, '#f87171') })
    } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
      video.src = hlsUrl; video.load(); video.play().catch(() => {})
    }
  }

  video.addEventListener('error', () => { if (!usingHls) { showNotice('Direct failed — switching to HLS 1080p', '#facc15'); playHls(1920, 1080, 40000000, 'hls-1080') } })
  const stallCheck = setTimeout(() => { if (!video.duration && !usingHls) { showNotice('Switching to HLS 1080p...', '#facc15'); playHls(1920, 1080, 40000000, 'hls-1080') } }, 3000)
  video.addEventListener('loadedmetadata', () => clearTimeout(stallCheck))
  playDirect()

  // Gear dropdown
  document.getElementById('gear-btn').addEventListener('click', (e) => {
    e.stopPropagation()
    gearDropdown.style.display = gearDropdown.style.display === 'none' ? 'block' : 'none'
    showControls()
  })
  document.querySelectorAll('.gear-opt').forEach(btn => {
    btn.addEventListener('click', () => {
      gearDropdown.style.display = 'none'
      const mode = btn.dataset.mode
      if (mode === 'direct') { playDirect(); showNotice('Direct stream') }
      else if (mode === 'hls-1080') { playHls(1920, 1080, 40000000, mode); showNotice('HLS 1080p') }
      else if (mode === 'hls-720') { playHls(1280, 720, 16000000, mode); showNotice('HLS 720p') }
      else if (mode === 'hls-480') { playHls(854, 480, 6000000, mode); showNotice('HLS 480p') }
    })
  })
  overlay.addEventListener('click', (e) => { if (!e.target.closest('#gear-dropdown') && !e.target.closest('#gear-btn')) gearDropdown.style.display = 'none' })

  // CC
  document.getElementById('cc-btn').addEventListener('click', () => showSubtitlePicker(itemId, title, currentSubtitleTracks, false, video))
  updateCCButton()

  // Fullscreen — fullscreen the container so custom controls stay
  document.getElementById('fullscreen-btn').addEventListener('click', () => {
    if (!document.fullscreenElement) overlay.requestFullscreen().catch(() => {})
    else document.exitFullscreen()
  })
  document.addEventListener('fullscreenchange', () => {
    document.getElementById('fullscreen-btn').textContent = document.fullscreenElement ? '⛶' : '⛶'
    if (activeSubtitleIndex !== null) {
      setTimeout(() => { Array.from(video.textTracks).forEach(t => t.mode = 'hidden'); if (video.textTracks[0]) video.textTracks[0].mode = 'showing' }, 200)
    }
  })

  document.addEventListener('keydown', handleKeyboard)
  document.getElementById('close-player').addEventListener('click', () => closePlayer(video))

  api.reportPlaybackStart(itemId)
  progressInterval = setInterval(() => {
    api.reportPlaybackProgress(itemId, Math.floor(video.currentTime * 10_000_000))
  }, 10_000)
  video.addEventListener('ended', () => closePlayer(video))

  if (subtitleIndex !== null) {
    video.addEventListener('loadedmetadata', () => {
      setTimeout(() => { if (video.textTracks[0]) video.textTracks[0].mode = 'showing' }, 300)
    })
  }
}

function handleKeyboard(e) {
  const video = document.getElementById('jellyfin-video')
  if (!video) return
  if (e.key === 'Escape') {
    if (document.getElementById('subtitle-picker')) { document.getElementById('subtitle-picker').remove(); return }
    closePlayer(video); return
  }
  if (['Space', ' ', 'k'].includes(e.key)) { e.preventDefault(); video.paused ? video.play() : video.pause() }
  if (e.key === 'ArrowRight') { e.preventDefault(); video.currentTime = Math.min(video.duration, video.currentTime + 10) }
  if (e.key === 'ArrowLeft') { e.preventDefault(); video.currentTime = Math.max(0, video.currentTime - 10) }
  if (e.key === 'f') { const o = document.getElementById('player-overlay'); if (o) document.fullscreenElement ? document.exitFullscreen() : o.requestFullscreen() }
  if (e.key === 'm') { video.muted = !video.muted }
}

function closePlayer(video) {
  clearInterval(progressInterval)
  if (hlsInstance) { hlsInstance.destroy(); hlsInstance = null }
  api.reportPlaybackStopped(currentItemId, Math.floor((video?.currentTime || 0) * 10_000_000))
  document.getElementById('player-overlay')?.remove()
  document.getElementById('subtitle-picker')?.remove()
  document.removeEventListener('keydown', handleKeyboard)
}