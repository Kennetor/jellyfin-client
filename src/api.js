// api.js — All Jellyfin API calls

let SERVER = ''
let TOKEN = ''
let USER_ID = ''

const DEVICE_ID = 'jellyfin-vanilla-client-001'

export function configure(server, token, userId) {
  SERVER = server.replace(/\/$/, '') // strip trailing slash
  TOKEN = token
  USER_ID = userId
}

export function getServer() { return SERVER }
export function getToken() { return TOKEN }
export function getUserId() { return USER_ID }

function headers() {
  return {
    'X-Emby-Token': TOKEN,
    'Content-Type': 'application/json',
  }
}

// Quick Connect — initiate and get a code
export async function quickConnectInitiate(server) {
  const url = `${server.replace(/\/$/, '')}/QuickConnect/Initiate`
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Emby-Authorization': `MediaBrowser Client="JellyfinVanilla", Device="Browser", DeviceId="${DEVICE_ID}", Version="0.1.0"`,
    },
  })
  if (!res.ok) throw new Error('Quick Connect not available on this server')
  return res.json() // { Secret, Code, Status }
}

// Quick Connect — poll until authorized
export async function quickConnectCheck(server, secret) {
  const url = `${server.replace(/\/$/, '')}/QuickConnect/Connect?Secret=${secret}`
  const res = await fetch(url, {
    headers: {
      'X-Emby-Authorization': `MediaBrowser Client="JellyfinVanilla", Device="Browser", DeviceId="${DEVICE_ID}", Version="0.1.0"`,
    },
  })
  if (!res.ok) throw new Error('Quick Connect check failed')
  return res.json() // { Authenticated, Secret }
}

// Quick Connect — exchange secret for token
export async function quickConnectAuth(server, secret) {
  const url = `${server.replace(/\/$/, '')}/Users/AuthenticateWithQuickConnect`
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Emby-Authorization': `MediaBrowser Client="JellyfinVanilla", Device="Browser", DeviceId="${DEVICE_ID}", Version="0.1.0"`,
    },
    body: JSON.stringify({ Secret: secret }),
  })
  if (!res.ok) throw new Error('Quick Connect auth failed')
  const data = await res.json()
  return { token: data.AccessToken, userId: data.User.Id }
}

// Authenticate and return { token, userId }
export async function authenticate(server, username, password) {
  const url = `${server.replace(/\/$/, '')}/Users/AuthenticateByName`
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Emby-Authorization': `MediaBrowser Client="JellyfinVanilla", Device="Browser", DeviceId="${DEVICE_ID}", Version="0.1.0"`,
    },
    body: JSON.stringify({ Username: username, Pw: password }),
  })
  if (!res.ok) throw new Error('Login failed')
  const data = await res.json()
  return {
    token: data.AccessToken,
    userId: data.User.Id,
  }
}

// Get all libraries
export async function getLibraries() {
  const res = await fetch(`${SERVER}/Users/${USER_ID}/Views`, { headers: headers() })
  if (!res.ok) throw new Error('Failed to fetch libraries')
  const data = await res.json()
  return data.Items
}

// Get items from a library (Movies or Shows)
export async function getLibraryItems(libraryId, type, page = 0, limit = 40) {
  const params = new URLSearchParams({
    ParentId: libraryId,
    IncludeItemTypes: type, // 'Movie' or 'Series'
    Recursive: 'true',
    SortBy: 'SortName',
    SortOrder: 'Ascending',
    Fields: 'PrimaryImageAspectRatio,BasicSyncInfo,Overview',
    ImageTypeLimit: '1',
    EnableImageTypes: 'Primary,Backdrop,Thumb',
    StartIndex: page * limit,
    Limit: limit,
  })
  const res = await fetch(`${SERVER}/Users/${USER_ID}/Items?${params}`, { headers: headers() })
  if (!res.ok) throw new Error('Failed to fetch items')
  return res.json()
}

// Get item details
export async function getItem(itemId) {
  const res = await fetch(`${SERVER}/Users/${USER_ID}/Items/${itemId}`, { headers: headers() })
  if (!res.ok) throw new Error('Failed to fetch item')
  return res.json()
}

// Get seasons for a series
export async function getSeasons(seriesId) {
  const res = await fetch(`${SERVER}/Shows/${seriesId}/Seasons?UserId=${USER_ID}`, { headers: headers() })
  if (!res.ok) throw new Error('Failed to fetch seasons')
  return res.json()
}

// Get episodes for a season
export async function getEpisodes(seriesId, seasonId) {
  const params = new URLSearchParams({
    SeasonId: seasonId,
    UserId: USER_ID,
    Fields: 'Overview,MediaSources',
  })
  const res = await fetch(`${SERVER}/Shows/${seriesId}/Episodes?${params}`, { headers: headers() })
  if (!res.ok) throw new Error('Failed to fetch episodes')
  return res.json()
}

// Build image URL
export function imageUrl(itemId, type = 'Primary', width = 300) {
  return `${SERVER}/Items/${itemId}/Images/${type}?maxWidth=${width}&quality=90`
}

// Build HLS transcoded stream URL
export function hlsStreamUrl(itemId, width = 1920, height = 1080, bitrate = 40000000) {
  const params = new URLSearchParams({
    DeviceId: DEVICE_ID,
    MediaSourceId: itemId,
    VideoCodec: 'h264',
    AudioCodec: 'aac',
    MaxStreamingBitrate: String(bitrate),
    VideoBitrate: String(Math.floor(bitrate * 0.9)),
    AudioBitrate: '384000',
    MaxWidth: String(width),
    MaxHeight: String(height),
    TranscodingMaxAudioChannels: '6',
    RequireAvc: 'true',
    SegmentContainer: 'ts',
    MinSegments: '2',
    BreakOnNonKeyFrames: 'true',
    api_key: TOKEN,
  })
  return `${SERVER}/Videos/${itemId}/main.m3u8?${params}`
}

// Build playback stream URL
export function streamUrl(itemId) {
  return `${SERVER}/Videos/${itemId}/stream?static=true&api_key=${TOKEN}`
}

// Report playback started
export async function reportPlaybackStart(itemId) {
  await fetch(`${SERVER}/Sessions/Playing`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({
      ItemId: itemId,
      PlayMethod: 'DirectStream',
      CanSeek: true,
    }),
  })
}

// Report playback progress
export async function reportPlaybackProgress(itemId, positionTicks) {
  await fetch(`${SERVER}/Sessions/Playing/Progress`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({
      ItemId: itemId,
      PositionTicks: positionTicks,
      IsPaused: false,
    }),
  })
}

// Report playback stopped
export async function reportPlaybackStopped(itemId, positionTicks) {
  await fetch(`${SERVER}/Sessions/Playing/Stopped`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({
      ItemId: itemId,
      PositionTicks: positionTicks,
    }),
  })
}

// Get media info including subtitle/audio streams
export async function getMediaInfo(itemId) {
  const res = await fetch(`${SERVER}/Items/${itemId}/PlaybackInfo`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({ UserId: USER_ID, DeviceProfile: {} }),
  })
  if (!res.ok) throw new Error('Failed to get media info')
  return res.json()
}

// Build subtitle stream URL (WebVTT)
export function subtitleUrl(itemId, streamIndex) {
  return `${SERVER}/Videos/${itemId}/${itemId}/Subtitles/${streamIndex}/0/Stream.vtt?api_key=${TOKEN}`
}

// Get user data for an item (playback position, watched %)
export async function getUserData(itemId) {
  const res = await fetch(`${SERVER}/Users/${USER_ID}/Items/${itemId}`, { headers: headers() })
  if (!res.ok) return null
  const data = await res.json()
  return data.UserData || null
}

// Get multiple items' user data at once
export async function getItemsWithUserData(ids) {
  const params = new URLSearchParams({
    Ids: ids.join(','),
    Fields: 'UserData',
    UserId: USER_ID,
  })
  const res = await fetch(`${SERVER}/Items?${params}`, { headers: headers() })
  if (!res.ok) return []
  const data = await res.json()
  return data.Items
}

export async function markWatched(itemId) {
  await fetch(`${SERVER}/Users/${USER_ID}/PlayedItems/${itemId}`, {
    method: 'POST',
    headers: headers(),
  })
}