// main.js — App entry, routing, and views

import * as api from './api.js'
import { openPlayer } from './player.js'

const app = document.getElementById('app')

// ─── State ───────────────────────────────────────────────────────────────────
let state = {
  view: 'login',
  libraries: [],
  activeLibrary: null,
  items: [],
  page: 0,
  totalItems: 0,
  selectedItem: null,
  seasons: [],
  episodes: [],
  activeSeason: null,
}

// ─── Server list (localStorage) ──────────────────────────────────────────────
function getSavedServers() {
  try { return JSON.parse(localStorage.getItem('jf_servers') || '[]') } catch { return [] }
}
function saveServer(server) {
  const servers = getSavedServers().filter(s => s !== server)
  servers.unshift(server)
  localStorage.setItem('jf_servers', JSON.stringify(servers.slice(0, 5)))
}
function removeServer(server) {
  const servers = getSavedServers().filter(s => s !== server)
  localStorage.setItem('jf_servers', JSON.stringify(servers))
}
function getLastServer() {
  return localStorage.getItem('jf_last_server') || ''
}
function setLastServer(server) {
  localStorage.setItem('jf_last_server', server)
}

// ─── Session persistence ──────────────────────────────────────────────────────
function saveSession(server, token, userId) {
  sessionStorage.setItem('jf_server', server)
  sessionStorage.setItem('jf_token', token)
  sessionStorage.setItem('jf_userId', userId)
}
function loadSession() {
  return {
    server: sessionStorage.getItem('jf_server'),
    token: sessionStorage.getItem('jf_token'),
    userId: sessionStorage.getItem('jf_userId'),
  }
}

// ─── Render router ────────────────────────────────────────────────────────────
function render() {
  switch (state.view) {
    case 'login': renderLogin(); break
    case 'library': renderLibrary(); break
    case 'detail': renderDetail(); break
  }
}

// ─── Network Discovery ────────────────────────────────────────────────────────
async function discoverServers() {
  const found = []

  // 1. Try Jellyfin's official LAN discovery endpoint (broadcast via fetch)
  try {
    const res = await fetch('http://localhost:7359/', { signal: AbortSignal.timeout(800) })
    if (res.ok) {
      const text = await res.text()
      const data = JSON.parse(text)
      if (data.Address) found.push(data.Address)
    }
  } catch {}

  // 2. Scan local subnet — detect our IP first via a dummy connection
  const localIp = await getLocalSubnet()
  if (localIp) {
    const base = localIp.split('.').slice(0, 3).join('.')
    const checks = []
    for (let i = 1; i <= 254; i++) {
      checks.push(probeJellyfin(`http://${base}.${i}:8096`))
    }
    const results = await Promise.allSettled(checks)
    results.forEach(r => {
      if (r.status === 'fulfilled' && r.value) found.push(r.value)
    })
  }

  // Deduplicate
  return [...new Set(found)]
}

async function probeJellyfin(url) {
  try {
    const res = await fetch(`${url}/System/Info/Public`, {
      signal: AbortSignal.timeout(600),
    })
    if (res.ok) {
      const data = await res.json()
      if (data.ServerName || data.Version) return url
    }
  } catch {}
  return null
}

async function getLocalSubnet() {
  // Use WebRTC to detect local IP
  return new Promise(resolve => {
    try {
      const pc = new RTCPeerConnection({ iceServers: [] })
      pc.createDataChannel('')
      pc.createOffer().then(o => pc.setLocalDescription(o))
      pc.onicecandidate = e => {
        if (!e || !e.candidate) return
        const match = e.candidate.candidate.match(/(\d+\.\d+\.\d+\.\d+)/)
        if (match && !match[1].startsWith('127.')) {
          pc.close()
          resolve(match[1])
        }
      }
      setTimeout(() => { pc.close(); resolve(null) }, 1000)
    } catch { resolve(null) }
  })
}

// ─── Login View ───────────────────────────────────────────────────────────────
function renderLogin() {
  const savedServers = getSavedServers()
  const lastServer = getLastServer()

  app.innerHTML = `
    <div style="min-height:100vh; display:flex; align-items:center; justify-content:center; padding:24px; background:#111;">
      <div style="width:100%; max-width:420px;">
        <div style="text-align:center; margin-bottom:36px;">
          <h1 style="font-family:'Outfit',sans-serif; font-size:36px; font-weight:700; color:#fff; margin:0 0 6px;">Jellyfin</h1>
          <p style="font-size:13px; color:#555; margin:0;">Connect to your server</p>
        </div>

        <div style="background:#1a1a1a; border:1px solid rgba(255,255,255,0.06); border-radius:20px; padding:28px; box-shadow:0 24px 48px rgba(0,0,0,0.4);">

          <!-- Server field -->
          <div style="margin-bottom:12px;">
            <label style="display:block; font-size:11px; font-weight:600; color:#555; margin-bottom:8px; text-transform:uppercase; letter-spacing:0.08em;">Server Address</label>
            <div style="display:flex; gap:8px;">
              <input id="server" type="text" value="${lastServer}" placeholder="http://192.168.x.x:8096" style="
                flex:1; background:#222; border:1px solid rgba(255,255,255,0.08); border-radius:12px;
                padding:12px 16px; font-size:13px; color:#fff; outline:none; box-sizing:border-box;
              " />
              <button id="discover-btn" title="Auto-discover servers" style="
                background:#222; border:1px solid rgba(255,255,255,0.08); border-radius:12px;
                padding:12px 14px; color:#888; font-size:16px; cursor:pointer; flex-shrink:0;
                transition:all 0.15s;
              ">🔍</button>
            </div>
          </div>

          <!-- Discovered / saved servers list -->
          <div id="server-list" style="margin-bottom:16px;">
            ${savedServers.length > 0 ? renderServerListHTML(savedServers, 'Recent') : ''}
          </div>

          <!-- Tab switcher -->
          <div style="display:flex; border-radius:10px; overflow:hidden; border:1px solid rgba(255,255,255,0.08); margin-bottom:20px;">
            <button id="tab-credentials" style="flex:1; padding:9px; font-size:13px; font-weight:600; background:#00a4dc; color:#fff; border:none; cursor:pointer;">Credentials</button>
            <button id="tab-quickconnect" style="flex:1; padding:9px; font-size:13px; font-weight:600; background:transparent; color:#555; border:none; cursor:pointer;">Quick Connect</button>
          </div>

          <!-- Credentials panel -->
          <div id="panel-credentials" style="display:flex; flex-direction:column; gap:14px;">
            <div>
              <label style="display:block; font-size:11px; font-weight:600; color:#555; margin-bottom:8px; text-transform:uppercase; letter-spacing:0.08em;">Username</label>
              <input id="username" type="text" placeholder="Username" style="
                width:100%; background:#222; border:1px solid rgba(255,255,255,0.08); border-radius:12px;
                padding:12px 16px; font-size:13px; color:#fff; outline:none; box-sizing:border-box;
              " />
            </div>
            <div>
              <label style="display:block; font-size:11px; font-weight:600; color:#555; margin-bottom:8px; text-transform:uppercase; letter-spacing:0.08em;">Password</label>
              <input id="password" type="password" placeholder="Password" style="
                width:100%; background:#222; border:1px solid rgba(255,255,255,0.08); border-radius:12px;
                padding:12px 16px; font-size:13px; color:#fff; outline:none; box-sizing:border-box;
              " />
            </div>
            <button id="login-btn" style="
              width:100%; background:#00a4dc; border:none; color:#fff; font-weight:600;
              padding:13px; border-radius:12px; font-size:13px; cursor:pointer; margin-top:4px;
            ">Connect</button>
          </div>

          <!-- Quick Connect panel -->
          <div id="panel-quickconnect" style="display:none; flex-direction:column; gap:14px;">
            <p style="font-size:13px; color:#666; text-align:center; margin:0;">Enter this code in your Jellyfin web UI under <span style="color:#fff;">Quick Connect</span></p>
            <div id="qc-code-display" style="text-align:center;">
              <span style="font-family:'Outfit',sans-serif; font-size:48px; font-weight:700; letter-spacing:0.3em; color:#00a4dc;">——</span>
            </div>
            <p id="qc-status" style="font-size:12px; color:#555; text-align:center; margin:0;">Enter your server address and click Generate</p>
            <button id="qc-generate-btn" style="
              width:100%; background:#00a4dc; border:none; color:#fff; font-weight:600;
              padding:13px; border-radius:12px; font-size:13px; cursor:pointer;
            ">Generate Code</button>
          </div>

          <p id="login-error" style="color:#f87171; font-size:13px; text-align:center; margin:12px 0 0; display:none;"></p>
        </div>
      </div>
    </div>
  `

  // Discover button
  document.getElementById('discover-btn').addEventListener('click', async () => {
    const btn = document.getElementById('discover-btn')
    const listEl = document.getElementById('server-list')
    btn.textContent = '⏳'
    btn.disabled = true
    listEl.innerHTML = `<p style="font-size:12px; color:#555; margin:0 0 12px; text-align:center;">Scanning local network...</p>`

    const found = await discoverServers()
    btn.textContent = '🔍'
    btn.disabled = false

    if (found.length > 0) {
      listEl.innerHTML = renderServerListHTML(found, 'Found on network')
      attachServerListHandlers()
    } else {
      const saved = getSavedServers()
      listEl.innerHTML = `
        <p style="font-size:12px; color:#f87171; margin:0 0 8px; text-align:center;">No servers found automatically</p>
        ${saved.length > 0 ? renderServerListHTML(saved, 'Recent') : ''}
      `
      attachServerListHandlers()
    }
  })

  attachServerListHandlers()

  // Tab switching
  const tabCreds = document.getElementById('tab-credentials')
  const tabQC = document.getElementById('tab-quickconnect')
  const panelCreds = document.getElementById('panel-credentials')
  const panelQC = document.getElementById('panel-quickconnect')

  tabCreds.addEventListener('click', () => {
    tabCreds.style.background = '#00a4dc'; tabCreds.style.color = '#fff'
    tabQC.style.background = 'transparent'; tabQC.style.color = '#555'
    panelCreds.style.display = 'flex'; panelQC.style.display = 'none'
  })
  tabQC.addEventListener('click', () => {
    tabQC.style.background = '#00a4dc'; tabQC.style.color = '#fff'
    tabCreds.style.background = 'transparent'; tabCreds.style.color = '#555'
    panelQC.style.display = 'flex'; panelCreds.style.display = 'none'
  })

  document.getElementById('login-btn').addEventListener('click', handleLogin)
  document.getElementById('password').addEventListener('keydown', e => { if (e.key === 'Enter') handleLogin() })
  document.getElementById('qc-generate-btn').addEventListener('click', handleQuickConnect)

  // Auto-discover on load (silent, no spinner)
  silentDiscover()
}

function renderServerListHTML(servers, label) {
  return `
    <div style="margin-bottom:4px;">
      <label style="display:block; font-size:11px; font-weight:600; color:#555; margin-bottom:8px; text-transform:uppercase; letter-spacing:0.08em;">${label}</label>
      <div style="display:flex; flex-direction:column; gap:4px;">
        ${servers.map(s => `
          <div style="display:flex; align-items:center; gap:6px;">
            <button class="saved-server" data-server="${s}" style="
              flex:1; text-align:left; padding:8px 12px; border-radius:8px;
              background:rgba(0,164,220,0.08); border:1px solid rgba(0,164,220,0.2);
              color:#00a4dc; font-size:12px; cursor:pointer; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;
            ">${s}</button>
            <button class="remove-server" data-server="${s}" style="
              padding:8px 10px; border-radius:8px; background:rgba(255,255,255,0.05);
              border:1px solid rgba(255,255,255,0.08); color:#555; font-size:11px; cursor:pointer; flex-shrink:0;
            ">✕</button>
          </div>
        `).join('')}
      </div>
    </div>
  `
}

function attachServerListHandlers() {
  document.querySelectorAll('.saved-server').forEach(btn => {
    btn.addEventListener('click', () => {
      document.getElementById('server').value = btn.dataset.server
    })
  })
  document.querySelectorAll('.remove-server').forEach(btn => {
    btn.addEventListener('click', () => {
      removeServer(btn.dataset.server)
      renderLogin()
    })
  })
}

async function silentDiscover() {
  const found = await discoverServers()
  if (found.length === 0) return
  const listEl = document.getElementById('server-list')
  if (!listEl) return
  // Merge with saved, deduplicate
  const saved = getSavedServers()
  const all = [...new Set([...found, ...saved])]
  listEl.innerHTML = renderServerListHTML(all, found.length > 0 ? 'Available servers' : 'Recent')
  attachServerListHandlers()
  // Pre-fill if only one found and field is empty
  const serverInput = document.getElementById('server')
  if (found.length === 1 && !serverInput?.value) {
    serverInput.value = found[0]
  }
}


let qcPollInterval = null

async function handleLogin() {
  const server = document.getElementById('server').value.trim()
  const username = document.getElementById('username').value.trim()
  const password = document.getElementById('password').value
  const errEl = document.getElementById('login-error')
  const btn = document.getElementById('login-btn')

  if (!server || !username) {
    errEl.textContent = 'Please fill in all fields'
    errEl.style.display = 'block'
    return
  }

  btn.textContent = 'Connecting...'
  btn.disabled = true
  errEl.style.display = 'none'

  try {
    const { token, userId } = await api.authenticate(server, username, password)
    api.configure(server, token, userId)
    saveSession(server, token, userId)
    saveServer(server)
    setLastServer(server)
    await loadLibraries()
  } catch {
    errEl.textContent = 'Could not connect. Check your server address and credentials.'
    errEl.style.display = 'block'
    btn.textContent = 'Connect'
    btn.disabled = false
  }
}

async function handleQuickConnect() {
  const server = document.getElementById('server').value.trim()
  const errEl = document.getElementById('login-error')
  const btn = document.getElementById('qc-generate-btn')
  const codeDisplay = document.getElementById('qc-code-display')
  const status = document.getElementById('qc-status')

  if (!server) {
    errEl.textContent = 'Enter your server address first'
    errEl.style.display = 'block'
    return
  }

  errEl.style.display = 'none'
  btn.textContent = 'Generating...'
  btn.disabled = true

  try {
    const qc = await api.quickConnectInitiate(server)
    codeDisplay.innerHTML = `<span style="font-family:'Outfit',sans-serif; font-size:48px; font-weight:700; letter-spacing:0.3em; color:#00a4dc;">${qc.Code}</span>`
    status.textContent = 'Waiting for approval in Jellyfin...'
    btn.textContent = 'Cancel'
    btn.disabled = false
    btn.onclick = () => { clearInterval(qcPollInterval); renderLogin() }

    qcPollInterval = setInterval(async () => {
      try {
        const result = await api.quickConnectCheck(server, qc.Secret)
        if (result.Authenticated) {
          clearInterval(qcPollInterval)
          status.textContent = '✓ Approved! Connecting...'
          const { token, userId } = await api.quickConnectAuth(server, qc.Secret)
          api.configure(server, token, userId)
          saveSession(server, token, userId)
          saveServer(server)
          setLastServer(server)
          await loadLibraries()
        }
      } catch {
        clearInterval(qcPollInterval)
        errEl.textContent = 'Quick Connect failed. Try again.'
        errEl.style.display = 'block'
        renderLogin()
      }
    }, 3000)
  } catch (e) {
    errEl.textContent = e.message || 'Quick Connect not available on this server'
    errEl.style.display = 'block'
    btn.textContent = 'Generate Code'
    btn.disabled = false
  }
}

async function loadLibraries() {
  const libs = await api.getLibraries()
  state.libraries = libs.filter(l => ['movies', 'tvshows'].includes(l.CollectionType))
  state.activeLibrary = state.libraries[0] || null
  state.view = 'library'
  state.page = 0
  await loadItems()
}

// ─── Library View ─────────────────────────────────────────────────────────────
async function loadItems() {
  if (!state.activeLibrary) return
  const type = state.activeLibrary.CollectionType === 'movies' ? 'Movie' : 'Series'
  const data = await api.getLibraryItems(state.activeLibrary.Id, type, state.page)
  state.items = data.Items
  state.totalItems = data.TotalRecordCount
  render()
}

function renderLibrary() {
  const lib = state.activeLibrary
  const totalPages = Math.ceil(state.totalItems / 40)

  app.innerHTML = `
    <div style="min-height:100vh; display:flex; flex-direction:column; background:#111;">
      <nav style="position:sticky; top:0; z-index:20; background:rgba(17,17,17,0.95); backdrop-filter:blur(12px); border-bottom:1px solid rgba(255,255,255,0.06); padding:0 28px; height:56px; display:flex; align-items:center; gap:24px;">
        <span style="font-family:'Outfit',sans-serif; font-weight:700; font-size:18px; color:#00a4dc; letter-spacing:-0.5px;">Jellyfin</span>
        <div style="display:flex; gap:6px;">
          ${state.libraries.map(l => `
            <button data-lib-id="${l.Id}" class="lib-tab" style="
              padding:6px 16px; border-radius:8px; border:none; cursor:pointer; font-size:13px; font-weight:600;
              background:${l.Id === lib?.Id ? '#00a4dc' : 'transparent'};
              color:${l.Id === lib?.Id ? '#fff' : '#888'};
            ">${l.Name}</button>
          `).join('')}
        </div>
        <div style="margin-left:auto; font-size:12px; color:#555;">${state.totalItems} titles</div>
      </nav>

      <main style="flex:1; padding:28px;">
        <div style="display:grid; grid-template-columns:repeat(auto-fill, minmax(150px, 1fr)); gap:20px;">
          ${state.items.map(item => renderCard(item)).join('')}
        </div>

        ${totalPages > 1 ? `
        <div style="display:flex; justify-content:center; align-items:center; gap:16px; margin-top:40px;">
          <button id="prev-page" style="padding:8px 20px; border-radius:10px; background:#1e1e1e; border:1px solid rgba(255,255,255,0.1); color:#fff; font-size:13px; cursor:pointer; opacity:${state.page === 0 ? '0.3' : '1'};" ${state.page === 0 ? 'disabled' : ''}>← Prev</button>
          <span style="font-size:13px; color:#555;">Page ${state.page + 1} of ${totalPages}</span>
          <button id="next-page" style="padding:8px 20px; border-radius:10px; background:#1e1e1e; border:1px solid rgba(255,255,255,0.1); color:#fff; font-size:13px; cursor:pointer; opacity:${state.page >= totalPages - 1 ? '0.3' : '1'};" ${state.page >= totalPages - 1 ? 'disabled' : ''}>Next →</button>
        </div>` : ''}
      </main>
    </div>
  `

  document.querySelectorAll('.media-card').forEach(card => {
    const poster = card.querySelector('.card-poster')
    const overlay = card.querySelector('.card-overlay')
    card.addEventListener('mouseenter', () => {
      poster.style.transform = 'scale(1.04)'
      poster.style.boxShadow = '0 8px 30px rgba(0,0,0,0.6)'
      overlay.style.opacity = '1'
    })
    card.addEventListener('mouseleave', () => {
      poster.style.transform = 'scale(1)'
      poster.style.boxShadow = 'none'
      overlay.style.opacity = '0'
    })
    card.addEventListener('click', () => openDetail(card.dataset.itemId))
  })

  document.querySelectorAll('.lib-tab').forEach(btn => {
    btn.addEventListener('click', async () => {
      state.activeLibrary = state.libraries.find(l => l.Id === btn.dataset.libId)
      state.page = 0
      await loadItems()
    })
  })

  document.getElementById('prev-page')?.addEventListener('click', async () => {
    state.page--; await loadItems(); window.scrollTo(0, 0)
  })
  document.getElementById('next-page')?.addEventListener('click', async () => {
    state.page++; await loadItems(); window.scrollTo(0, 0)
  })
}

function renderCard(item) {
  const imgUrl = api.imageUrl(item.Id, 'Primary', 300)
  const year = item.ProductionYear || ''
  const played = item.UserData?.PlayedPercentage || 0
  const watched = item.UserData?.Played || false

  return `
    <div class="media-card" data-item-id="${item.Id}" style="cursor:pointer;">
      <div class="card-poster" style="
        position:relative; border-radius:8px; overflow:hidden;
        aspect-ratio:2/3; background:#1e1e1e; margin-bottom:8px;
        transition:transform 0.2s ease, box-shadow 0.2s ease;
      ">
        <img src="${imgUrl}" alt="${item.Name}" style="width:100%; height:100%; object-fit:cover; display:block;" onerror="this.style.display='none'" />
        <div class="card-overlay" style="
          position:absolute; inset:0; background:linear-gradient(to top, rgba(0,0,0,0.75) 0%, transparent 50%);
          opacity:0; transition:opacity 0.2s ease; display:flex; align-items:flex-end; padding:10px;
        ">
          <span style="font-size:12px; font-weight:600; color:#fff;">▶ Play</span>
        </div>
        ${watched ? `<div style="position:absolute; top:6px; right:6px; background:#00a4dc; border-radius:50%; width:20px; height:20px; display:flex; align-items:center; justify-content:center; font-size:10px;">✓</div>` : ''}
        ${played > 0 && !watched ? `
          <div style="position:absolute; bottom:0; left:0; right:0; height:3px; background:rgba(255,255,255,0.15);">
            <div style="height:100%; width:${played}%; background:#00a4dc; border-radius:2px;"></div>
          </div>` : ''}
      </div>
      <p style="font-size:12px; font-weight:600; color:#e5e5e5; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; margin:0 0 2px;">${item.Name}</p>
      ${year ? `<p style="font-size:11px; color:#666; margin:0;">${year}</p>` : ''}
    </div>
  `
}

// ─── Detail View ──────────────────────────────────────────────────────────────
async function openDetail(itemId) {
  const item = await api.getItem(itemId)
  state.selectedItem = item
  state.seasons = []
  state.episodes = []
  state.activeSeason = null

  if (item.Type === 'Series') {
    const data = await api.getSeasons(itemId)
    state.seasons = data.Items
    if (state.seasons.length > 0) {
      state.activeSeason = state.seasons[0]
      const epData = await api.getEpisodes(itemId, state.activeSeason.Id)
      state.episodes = epData.Items
    }
  }

  state.view = 'detail'
  render()
}

async function loadEpisodes(seasonId) {
  const epData = await api.getEpisodes(state.selectedItem.Id, seasonId)
  state.episodes = epData.Items
  state.activeSeason = state.seasons.find(s => s.Id === seasonId)
  renderEpisodeList()
}

function renderEpisodeList() {
  const container = document.getElementById('episode-list')
  if (!container) return
  container.innerHTML = state.episodes.map(ep => {
    const played = ep.UserData?.PlayedPercentage || 0
    const watched = ep.UserData?.Played || false
    return `
      <div class="episode-item" data-item-id="${ep.Id}" data-title="${ep.SeriesName || ''} - ${ep.Name}" style="
        display:flex; gap:14px; padding:12px; border-radius:12px; cursor:pointer;
        border:1px solid transparent; transition:background 0.15s;
      ">
        <div style="position:relative; border-radius:8px; overflow:hidden; flex-shrink:0; width:140px; aspect-ratio:16/9; background:#1e1e1e;">
          <img src="${api.imageUrl(ep.Id, 'Primary', 300)}" alt="${ep.Name}" style="width:100%; height:100%; object-fit:cover;" onerror="this.style.display='none'" />
          <div class="ep-overlay" style="position:absolute; inset:0; background:rgba(0,0,0,0.5); display:flex; align-items:center; justify-content:center; opacity:0; transition:opacity 0.15s;">
            <span style="font-size:20px;">▶</span>
          </div>
          ${played > 0 && !watched ? `
            <div style="position:absolute; bottom:0; left:0; right:0; height:3px; background:rgba(255,255,255,0.15);">
              <div style="height:100%; width:${played}%; background:#00a4dc;"></div>
            </div>` : ''}
          ${watched ? `<div style="position:absolute; top:4px; right:4px; background:#00a4dc; border-radius:50%; width:16px; height:16px; display:flex; align-items:center; justify-content:center; font-size:9px; color:#fff;">✓</div>` : ''}
        </div>
        <div style="flex:1; min-width:0; padding-top:2px;">
          <p style="font-size:13px; font-weight:600; color:#e5e5e5; margin:0 0 6px;">${ep.IndexNumber ? `E${ep.IndexNumber}. ` : ''}${ep.Name}</p>
          <p style="font-size:12px; color:#666; margin:0; display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; overflow:hidden;">${ep.Overview || ''}</p>
        </div>
      </div>
    `
  }).join('')

  container.querySelectorAll('.episode-item').forEach(el => {
    const overlay = el.querySelector('.ep-overlay')
    el.addEventListener('mouseenter', () => {
      el.style.background = 'rgba(255,255,255,0.04)'
      el.style.borderColor = 'rgba(255,255,255,0.06)'
      overlay.style.opacity = '1'
    })
    el.addEventListener('mouseleave', () => {
      el.style.background = 'transparent'
      el.style.borderColor = 'transparent'
      overlay.style.opacity = '0'
    })
    el.addEventListener('click', () => openPlayer(el.dataset.itemId, el.dataset.title))
  })
}

function renderDetail() {
  const item = state.selectedItem
  const backdropUrl = api.imageUrl(item.Id, 'Backdrop', 1280)
  const posterUrl = api.imageUrl(item.Id, 'Primary', 400)
  const isSeries = item.Type === 'Series'
  const runtime = item.RunTimeTicks
    ? `${Math.floor(item.RunTimeTicks / 600_000_000)}h ${Math.floor((item.RunTimeTicks % 600_000_000) / 10_000_000)}m`
    : ''

  // Ratings
  const imdbRating = item.CommunityRating ? item.CommunityRating.toFixed(1) : null
  const rtRating = item.CriticRating ? Math.round(item.CriticRating) : null
  const rtColor = rtRating >= 60 ? '#fa320a' : '#4b9d09'

  // Cast (first 6)
  const cast = (item.People || []).filter(p => p.Type === 'Actor').slice(0, 6)
  const directors = (item.People || []).filter(p => p.Type === 'Director').slice(0, 2)

  const played = item.UserData?.PlayedPercentage || 0

  app.innerHTML = `
    <div style="min-height:100vh; background:#111; color:#fff;">

      <!-- Back nav -->
      <nav style="position:sticky; top:0; z-index:20; background:rgba(17,17,17,0.9); backdrop-filter:blur(12px); border-bottom:1px solid rgba(255,255,255,0.06); padding:0 24px; height:52px; display:flex; align-items:center; gap:12px;">
        <button id="back-btn" style="background:none; border:none; color:#888; font-size:13px; font-weight:500; cursor:pointer; padding:6px 10px; border-radius:8px; display:flex; align-items:center; gap:6px;">← Back</button>
        <span style="color:#333;">/</span>
        <span style="font-size:13px; color:#ccc; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${item.Name}</span>
      </nav>

      <!-- Full-width backdrop -->
      <div style="position:relative; height:460px; overflow:hidden;">
        <img src="${backdropUrl}" style="width:100%; height:100%; object-fit:cover; display:block;" onerror="this.style.display='none'" />
        <div style="position:absolute; inset:0; background:linear-gradient(to right, rgba(17,17,17,0.95) 30%, rgba(17,17,17,0.4) 70%, rgba(17,17,17,0.2) 100%);"></div>
        <div style="position:absolute; inset:0; background:linear-gradient(to top, #111 0%, transparent 50%);"></div>

        <!-- Content over backdrop -->
        <div style="position:absolute; inset:0; display:flex; align-items:flex-end; padding:36px 40px;">
          <div style="display:flex; gap:32px; align-items:flex-end; max-width:900px; width:100%;">

            <!-- Poster -->
            <div style="flex-shrink:0; width:160px; border-radius:12px; overflow:hidden; box-shadow:0 20px 60px rgba(0,0,0,0.8); aspect-ratio:2/3; background:#1e1e1e; position:relative;">
              <img src="${posterUrl}" style="width:100%; height:100%; object-fit:cover;" onerror="this.style.display='none'" />
              ${played > 0 ? `
                <div style="position:absolute; bottom:0; left:0; right:0; height:4px; background:rgba(255,255,255,0.15);">
                  <div style="height:100%; width:${played}%; background:#00a4dc;"></div>
                </div>` : ''}
            </div>

            <!-- Info -->
            <div style="flex:1; padding-bottom:4px;">
              <h1 style="font-family:'Outfit',sans-serif; font-size:32px; font-weight:700; margin:0 0 10px; line-height:1.1;">${item.Name}</h1>

              <!-- Meta row -->
              <div style="display:flex; flex-wrap:wrap; align-items:center; gap:10px; margin-bottom:14px; font-size:13px; color:#999;">
                ${item.ProductionYear ? `<span>${item.ProductionYear}</span>` : ''}
                ${runtime ? `<span style="color:#444;">·</span><span>${runtime}</span>` : ''}
                ${item.OfficialRating ? `<span style="color:#444;">·</span><span style="border:1px solid #444; padding:1px 7px; border-radius:4px; font-size:11px;">${item.OfficialRating}</span>` : ''}
              </div>

              <!-- Ratings badges -->
              <div style="display:flex; gap:10px; margin-bottom:14px; flex-wrap:wrap;">
                ${imdbRating ? `
                  <div style="display:flex; align-items:center; gap:6px; background:rgba(255,255,255,0.07); border:1px solid rgba(255,255,255,0.1); border-radius:8px; padding:6px 12px;">
                    <span style="font-size:13px; font-weight:700; color:#f5c518;">IMDb</span>
                    <span style="font-size:14px; font-weight:700; color:#fff;">${imdbRating}</span>
                    <span style="font-size:11px; color:#666;">/10</span>
                  </div>` : ''}
                ${rtRating !== null ? `
                  <div style="display:flex; align-items:center; gap:6px; background:rgba(255,255,255,0.07); border:1px solid rgba(255,255,255,0.1); border-radius:8px; padding:6px 12px;">
                    <span style="font-size:13px;">🍅</span>
                    <span style="font-size:14px; font-weight:700; color:${rtColor};">${rtRating}%</span>
                  </div>` : ''}
              </div>

              <!-- Genres -->
              ${item.Genres?.length ? `
                <div style="display:flex; flex-wrap:wrap; gap:6px; margin-bottom:14px;">
                  ${item.Genres.map(g => `<span style="font-size:11px; background:rgba(255,255,255,0.08); border:1px solid rgba(255,255,255,0.1); padding:4px 10px; border-radius:20px; color:#bbb;">${g}</span>`).join('')}
                </div>` : ''}

              <!-- Overview -->
              <p style="font-size:14px; color:#aaa; line-height:1.6; margin:0 0 20px; max-width:560px;">${item.Overview || ''}</p>

              <!-- Play button -->
              ${!isSeries ? `
                <button id="play-btn" data-item-id="${item.Id}" data-title="${item.Name}" style="
                  display:inline-flex; align-items:center; gap:8px;
                  background:#00a4dc; border:none; color:#fff; font-weight:700;
                  padding:13px 28px; border-radius:10px; font-size:14px; cursor:pointer; letter-spacing:0.02em;
                ">▶ Play</button>` : ''}
            </div>
          </div>
        </div>
      </div>

      <!-- Below backdrop: cast + series -->
      <div style="padding:32px 40px; max-width:940px;">

        <!-- Directors -->
        ${directors.length ? `
          <p style="font-size:12px; color:#555; margin:0 0 24px;">
            Directed by <span style="color:#ccc; font-weight:600;">${directors.map(d => d.Name).join(', ')}</span>
          </p>` : ''}

        <!-- Cast -->
        ${cast.length ? `
          <div style="margin-bottom:36px;">
            <h3 style="font-size:13px; font-weight:700; color:#555; text-transform:uppercase; letter-spacing:0.08em; margin:0 0 14px;">Cast</h3>
            <div style="display:flex; gap:12px; overflow-x:auto; padding-bottom:8px;">
              ${cast.map(p => `
                <div style="flex-shrink:0; text-align:center; width:80px;">
                  <div style="width:72px; height:72px; border-radius:50%; overflow:hidden; background:#1e1e1e; margin:0 auto 8px;">
                    <img src="${api.imageUrl(p.Id, 'Primary', 100)}" style="width:100%; height:100%; object-fit:cover;" onerror="this.style.display='none'" />
                  </div>
                  <p style="font-size:11px; font-weight:600; color:#ccc; margin:0 0 2px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${p.Name}</p>
                  <p style="font-size:10px; color:#555; margin:0; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${p.Role || ''}</p>
                </div>
              `).join('')}
            </div>
          </div>` : ''}

        <!-- Series seasons + episodes -->
        ${isSeries ? `
          <div>
            <div style="display:flex; gap:8px; margin-bottom:16px; flex-wrap:wrap;">
              ${state.seasons.map(s => `
                <button data-season-id="${s.Id}" class="season-tab" style="
                  padding:7px 16px; border-radius:8px; border:1px solid; cursor:pointer; font-size:13px; font-weight:600;
                  background:${s.Id === state.activeSeason?.Id ? '#00a4dc' : 'transparent'};
                  color:${s.Id === state.activeSeason?.Id ? '#fff' : '#666'};
                  border-color:${s.Id === state.activeSeason?.Id ? '#00a4dc' : 'rgba(255,255,255,0.1)'};
                ">${s.Name}</button>
              `).join('')}
            </div>
            <div id="episode-list" style="display:flex; flex-direction:column; gap:4px;"></div>
          </div>` : ''}
      </div>
    </div>
  `

  document.getElementById('back-btn').addEventListener('click', () => { state.view = 'library'; render() })
  document.getElementById('play-btn')?.addEventListener('click', e => {
    const btn = e.currentTarget
    openPlayer(btn.dataset.itemId, btn.dataset.title)
  })
  document.querySelectorAll('.season-tab').forEach(btn => {
    btn.addEventListener('click', () => loadEpisodes(btn.dataset.seasonId))
  })
  if (isSeries) renderEpisodeList()
}

// ─── Boot ─────────────────────────────────────────────────────────────────────
async function boot() {
  const session = loadSession()
  if (session.server && session.token && session.userId) {
    try {
      api.configure(session.server, session.token, session.userId)
      await loadLibraries()
      return
    } catch {}
  }
  render()
}

boot()