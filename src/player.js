// player.js — Video playback with subtitle selection + transcode fallback

import * as api from './api.js'

let progressInterval = null
let currentItemId = null
let currentSubtitleTracks = []

export async function openPlayer(itemId, title) {
  let subtitleTracks = []
  let mediaSources = []

  try {
    const info = await api.getMediaInfo(itemId)
    const source = info.MediaSources?.[0]
    if (source) {
      subtitleTracks = (source.MediaStreams || []).filter(s => s.Type === 'Subtitle')
      mediaSources = info.MediaSources
    }
  } catch {}

  currentSubtitleTracks = subtitleTracks

  if (subtitleTracks.length > 0) {
    showSubtitlePicker(itemId, title, subtitleTracks, mediaSources, true)
  } else {
    startPlayback(itemId, title, null, mediaSources)
  }
}

function showSubtitlePicker(itemId, title, tracks, mediaSources, isPrePlay = false, video = null) {
  const existing = document.getElementById('subtitle-picker')
  if (existing) existing.remove()

  const overlay = document.createElement('div')
  overlay.id = 'subtitle-picker'
  overlay.style.cssText = `
    position:fixed; inset:0; z-index:60; background:rgba(0,0,0,0.75);
    display:flex; align-items:center; justify-content:center;
    backdrop-filter:blur(6px);
  `
  overlay.innerHTML = `
    <div style="background:#1a1a1a; border:1px solid rgba(255,255,255,0.1); border-radius:16px; padding:24px; width:340px; max-width:90vw;">
      <h3 style="font-family:'Outfit',sans-serif; font-size:15px; font-weight:700; margin:0 0 16px; color:#fff;">
        ${isPrePlay ? 'Select Subtitles' : 'Change Subtitles'}
      </h3>
      <div style="display:flex; flex-direction:column; gap:6px; max-height:280px; overflow-y:auto;">
        <button class="sub-btn" data-index="-1" style="
          text-align:left; padding:10px 14px; border-radius:10px;
          border:1px solid rgba(255,255,255,0.08); background:rgba(255,255,255,0.05);
          color:#ccc; font-size:13px; cursor:pointer;
        ">Off</button>
        ${tracks.map(t => `
          <button class="sub-btn" data-index="${t.Index}" style="
            text-align:left; padding:10px 14px; border-radius:10px;
            border:1px solid rgba(255,255,255,0.08); background:rgba(255,255,255,0.05);
            color:#ccc; font-size:13px; cursor:pointer;
          ">${t.DisplayTitle || t.Language || 'Track ' + t.Index}${t.IsDefault ? ' ★' : ''}</button>
        `).join('')}
      </div>
      <div style="display:flex; gap:8px; margin-top:16px;">
        <button id="sub-cancel" style="
          flex:1; padding:10px; border-radius:10px;
          border:1px solid rgba(255,255,255,0.1); background:transparent;
          color:#888; font-size:13px; cursor:pointer;
        ">Cancel</button>
        ${isPrePlay ? `<button id="sub-play" style="
          flex:2; padding:10px; border-radius:10px; border:none;
          background:#00a4dc; color:#fff; font-size:13px; font-weight:600; cursor:pointer;
        ">▶ Play</button>` : ''}
      </div>
    </div>
  `

  document.body.appendChild(overlay)
  let selectedIndex = null

  overlay.querySelectorAll('.sub-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      overlay.querySelectorAll('.sub-btn').forEach(b => {
        b.style.background = 'rgba(255,255,255,0.05)'
        b.style.borderColor = 'rgba(255,255,255,0.08)'
        b.style.color = '#ccc'
      })
      btn.style.background = 'rgba(0,164,220,0.2)'
      btn.style.borderColor = '#00a4dc'
      btn.style.color = '#fff'
      selectedIndex = parseInt(btn.dataset.index)
    })
  })

  document.getElementById('sub-cancel').addEventListener('click', () => overlay.remove())

  if (isPrePlay) {
    document.getElementById('sub-play').addEventListener('click', () => {
      overlay.remove()
      startPlayback(itemId, title, selectedIndex === -1 ? null : selectedIndex, mediaSources)
    })
  } else {
    // During playback — change track on existing video
    overlay.querySelectorAll('.sub-btn').forEach(btn => {
      btn.addEventListener('dblclick', () => {
        overlay.remove()
        applySubtitleTrack(video, itemId, selectedIndex === -1 ? null : selectedIndex)
      })
    })
    // Single click + apply button
    const applyBtn = document.createElement('button')
    applyBtn.textContent = 'Apply'
    applyBtn.style.cssText = 'flex:2; padding:10px; border-radius:10px; border:none; background:#00a4dc; color:#fff; font-size:13px; font-weight:600; cursor:pointer;'
    applyBtn.addEventListener('click', () => {
      overlay.remove()
      applySubtitleTrack(video, itemId, selectedIndex === -1 ? null : selectedIndex)
    })
    document.getElementById('sub-cancel').parentElement.appendChild(applyBtn)
  }
}

function applySubtitleTrack(video, itemId, subtitleIndex) {
  if (!video) return
  // Remove existing tracks
  Array.from(video.querySelectorAll('track')).forEach(t => t.remove())
  if (subtitleIndex !== null && subtitleIndex >= 0) {
    const track = document.createElement('track')
    track.kind = 'subtitles'
    track.src = api.subtitleUrl(itemId, subtitleIndex)
    track.default = true
    video.appendChild(track)
    // Activate after a short delay
    setTimeout(() => {
      if (video.textTracks[0]) video.textTracks[0].mode = 'showing'
    }, 300)
  } else {
    // Disable all tracks
    Array.from(video.textTracks).forEach(t => t.mode = 'hidden')
  }
}

function startPlayback(itemId, title, subtitleIndex, mediaSources = []) {
  currentItemId = itemId
  const directUrl = api.streamUrl(itemId)
  const hlsUrl = api.hlsStreamUrl(itemId)

  const overlay = document.createElement('div')
  overlay.id = 'player-overlay'
  overlay.style.cssText = 'position:fixed; inset:0; z-index:50; background:#000; display:flex; flex-direction:column;'
  overlay.innerHTML = `
    <div id="player-topbar" style="
      position:absolute; top:0; left:0; right:0; z-index:10;
      padding:14px 20px; display:flex; align-items:center; justify-content:space-between;
      background:linear-gradient(to bottom, rgba(0,0,0,0.85), transparent);
      opacity:0; transition:opacity 0.3s;
    ">
      <span style="font-family:'Outfit',sans-serif; font-weight:600; font-size:14px; color:#fff;">${title}</span>
      <div style="display:flex; gap:8px; align-items:center;">
        <button id="subtitle-btn" title="Subtitles" style="
          background:rgba(255,255,255,0.1); border:none; color:#fff; padding:7px 12px;
          border-radius:8px; cursor:pointer; font-size:13px;
        ">CC</button>
        <button id="transcode-btn" title="Switch to transcoded stream" style="
          background:rgba(255,255,255,0.1); border:none; color:#aaa; padding:7px 12px;
          border-radius:8px; cursor:pointer; font-size:11px; font-weight:600;
        ">HLS</button>
        <button id="close-player" style="
          background:rgba(255,255,255,0.1); border:none; color:#fff; padding:7px 14px;
          border-radius:8px; cursor:pointer; font-size:13px; font-weight:500;
        ">✕ Close</button>
      </div>
    </div>
    <video id="jellyfin-video" style="width:100%; height:100%; object-fit:contain;" controls autoplay>
      <source id="video-source" src="${directUrl}" />
      ${subtitleIndex !== null ? `<track kind="subtitles" src="${api.subtitleUrl(itemId, subtitleIndex)}" default />` : ''}
    </video>
    <div id="transcode-notice" style="
      position:absolute; bottom:80px; left:50%; transform:translateX(-50%);
      background:rgba(0,0,0,0.85); color:#fff; font-size:12px; padding:8px 16px;
      border-radius:8px; display:none; white-space:nowrap;
    "></div>
  `

  document.body.appendChild(overlay)

  const video = document.getElementById('jellyfin-video')
  const topbar = document.getElementById('player-topbar')
  const notice = document.getElementById('transcode-notice')
  let usingHls = false

  // Show/hide topbar on mouse move
  let hideTimer
  overlay.addEventListener('mousemove', () => {
    topbar.style.opacity = '1'
    clearTimeout(hideTimer)
    hideTimer = setTimeout(() => { topbar.style.opacity = '0' }, 3000)
  })
  topbar.style.opacity = '1'
  hideTimer = setTimeout(() => { topbar.style.opacity = '0' }, 3000)

  // Auto-fallback to HLS if direct stream fails
  video.addEventListener('error', () => {
    if (!usingHls) {
      console.warn('Direct stream failed, switching to HLS transcode...')
      switchToHls()
    }
  })

  // Also detect stall — if after 5s no duration, try HLS
  const stallCheck = setTimeout(() => {
    if (!video.duration && !usingHls) switchToHls()
  }, 5000)

  video.addEventListener('loadedmetadata', () => clearTimeout(stallCheck))

  function switchToHls() {
    usingHls = true
    clearTimeout(stallCheck)
    const currentTime = video.currentTime || 0
    document.getElementById('video-source').src = hlsUrl
    video.load()
    video.currentTime = currentTime
    video.play().catch(() => {})
    showNotice('Switched to HLS transcoding')
    document.getElementById('transcode-btn').style.color = '#00a4dc'
  }

  function showNotice(msg) {
    notice.textContent = msg
    notice.style.display = 'block'
    setTimeout(() => { notice.style.display = 'none' }, 3000)
  }

  // Manual HLS toggle
  document.getElementById('transcode-btn').addEventListener('click', () => {
    if (!usingHls) {
      switchToHls()
    } else {
      usingHls = false
      const currentTime = video.currentTime || 0
      document.getElementById('video-source').src = directUrl
      video.load()
      video.currentTime = currentTime
      video.play().catch(() => {})
      document.getElementById('transcode-btn').style.color = '#aaa'
      showNotice('Switched to direct stream')
    }
  })

  // Subtitle button during playback
  document.getElementById('subtitle-btn').addEventListener('click', () => {
    showSubtitlePicker(itemId, title, currentSubtitleTracks, [], false, video)
  })

  document.getElementById('close-player').addEventListener('click', () => closePlayer(video))
  document.addEventListener('keydown', handleEscape)

  api.reportPlaybackStart(itemId)

  progressInterval = setInterval(() => {
    const ticks = Math.floor(video.currentTime * 10_000_000)
    api.reportPlaybackProgress(itemId, ticks)
  }, 10_000)

  video.addEventListener('timeupdate', () => {
    if (video.duration && video.currentTime / video.duration > 0.9) {
      api.markWatched(itemId)
    }
  })

  video.addEventListener('ended', () => closePlayer(video))

  // Activate subtitle track after load
  if (subtitleIndex !== null) {
    video.addEventListener('loadedmetadata', () => {
      setTimeout(() => {
        if (video.textTracks[0]) video.textTracks[0].mode = 'showing'
      }, 300)
    })
  }
}

function handleEscape(e) {
  if (e.key === 'Escape') {
    const picker = document.getElementById('subtitle-picker')
    if (picker) { picker.remove(); return }
    const video = document.getElementById('jellyfin-video')
    if (video) closePlayer(video)
  }
}

function closePlayer(video) {
  clearInterval(progressInterval)
  const ticks = Math.floor((video?.currentTime || 0) * 10_000_000)
  api.reportPlaybackStopped(currentItemId, ticks)
  document.getElementById('player-overlay')?.remove()
  document.getElementById('subtitle-picker')?.remove()
  document.removeEventListener('keydown', handleEscape)
}