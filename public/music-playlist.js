const DB_NAME = 'crowdsync-audio-library';
const DB_VERSION = 1;
const STORE = 'tracks';
export const MAX_LIBRARY_TRACKS = 24;
export const MAX_LIBRARY_BYTES = 250 * 1024 * 1024;

function openDatabase() {
  return new Promise((resolve, reject) => {
    if (!('indexedDB' in window)) { reject(new Error('This browser does not support a local audio library')); return; }
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => { if (!request.result.objectStoreNames.contains(STORE)) request.result.createObjectStore(STORE, { keyPath: 'id' }); };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(new Error('The local audio library could not be opened'));
  });
}

async function transact(mode, action) {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE, mode), store = transaction.objectStore(STORE);
    let result;
    try {
      const request = action(store);
      if (request) { request.onsuccess = () => { result = request.result; }; request.onerror = () => reject(request.error || new Error('Audio library operation failed')); }
    } catch (error) { reject(error); }
    transaction.oncomplete = () => { db.close(); resolve(result); };
    transaction.onerror = () => { db.close(); reject(transaction.error || new Error('Audio library operation failed')); };
    transaction.onabort = () => { db.close(); reject(transaction.error || new Error('Audio library operation was cancelled')); };
  });
}

export function cleanTrackTitle(fileName) {
  let title = String(fileName || 'Untitled track').replace(/\.[^.]+$/, '').replace(/^YTDown(?:\.com)?[_\s-]*/i, '');
  const downloadedName = title.match(/YouTube[_\s-]+Media[_\s-]+[\w-]{11}[_\s-]+(.+?)(?:[_\s-]+\d{3,}[_\s-]+\d{2,}k)?$/i);
  if (downloadedName) title = downloadedName[1];
  return title.replace(/[_]+/g, ' ').replace(/\s+/g, ' ').replace(/\s*[-–—]\s*/g, ' – ').trim().slice(0, 120) || 'Untitled track';
}

function decodeTagText(bytes) {
  if (!bytes?.length) return '';
  const encoding = bytes[0], payload = bytes.slice(1);
  try { return new TextDecoder(encoding === 1 ? 'utf-16' : encoding === 2 ? 'utf-16be' : encoding === 3 ? 'utf-8' : 'iso-8859-1').decode(payload).replace(/\0/g, '').trim().slice(0, 120); }
  catch { return ''; }
}

/** Read common MP3 ID3 title/artist tags; filenames remain the fallback. */
export async function detectTrackMetadata(file) {
  const fallback = { title: cleanTrackTitle(file?.name), artist: '' };
  if (!file || file.size < 10 || !/\.mp3$/i.test(file.name || '')) return fallback;
  const header = new Uint8Array(await file.slice(0, Math.min(file.size, 512 * 1024)).arrayBuffer());
  let title = '', artist = '';
  if (header[0] === 0x49 && header[1] === 0x44 && header[2] === 0x33) {
    const version = header[3], tagEnd = Math.min(header.length, 10 + ((header[6] & 0x7f) << 21) + ((header[7] & 0x7f) << 14) + ((header[8] & 0x7f) << 7) + (header[9] & 0x7f));
    for (let offset = 10; offset + 10 <= tagEnd;) {
      const id = String.fromCharCode(...header.slice(offset, offset + 4)); if (!/^[A-Z0-9]{4}$/.test(id)) break;
      const size = version >= 4 ? ((header[offset + 4] & 0x7f) << 21) + ((header[offset + 5] & 0x7f) << 14) + ((header[offset + 6] & 0x7f) << 7) + (header[offset + 7] & 0x7f) : (header[offset + 4] * 0x1000000) + (header[offset + 5] << 16) + (header[offset + 6] << 8) + header[offset + 7];
      if (size <= 0 || offset + 10 + size > tagEnd) break;
      const value = decodeTagText(header.slice(offset + 10, offset + 10 + size));
      if (id === 'TIT2') title = value; if (id === 'TPE1') artist = value; offset += 10 + size;
    }
  }
  if (!title && file.size >= 128) {
    const tail = new Uint8Array(await file.slice(file.size - 128).arrayBuffer());
    if (String.fromCharCode(...tail.slice(0, 3)) === 'TAG') {
      const decoder = new TextDecoder('iso-8859-1'); title = decoder.decode(tail.slice(3, 33)).replace(/\0/g, '').trim(); artist ||= decoder.decode(tail.slice(33, 63)).replace(/\0/g, '').trim();
    }
  }
  return { title: title || fallback.title, artist: artist.slice(0, 80) };
}

export async function listMusicTracks() {
  const records = await transact('readonly', (store) => store.getAll());
  return (records || []).sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || a.createdAt - b.createdAt);
}

export async function getMusicTrack(id) {
  return (await transact('readonly', (store) => store.get(id))) || null;
}

export async function saveMusicTrack(file, { id = crypto.randomUUID(), plan, analysisSummary, title, artist } = {}) {
  const tracks = await listMusicTracks(), old = tracks.find((track) => track.id === id), size = Number(file?.size ?? old?.size);
  if (!file && !old) throw new Error('Audio file is unavailable');
  if (size > 25 * 1024 * 1024) throw new Error('Each library track must be smaller than 25 MB');
  if (!old && tracks.length >= MAX_LIBRARY_TRACKS) throw new Error(`The local playlist is limited to ${MAX_LIBRARY_TRACKS} tracks`);
  const total = tracks.reduce((sum, track) => sum + (track.id === id ? 0 : track.size || 0), 0) + size;
  if (total > MAX_LIBRARY_BYTES) throw new Error('The local playlist has reached its 250 MB storage limit');
  const record = {
    id, title: String(title || old?.title || cleanTrackTitle(file?.name || old.fileName)).slice(0, 120), artist: String(artist ?? old?.artist ?? '').slice(0, 80), fileName: file?.name || old.fileName, size,
    blob: file || old.blob, order: old?.order ?? tracks.length, createdAt: old?.createdAt ?? Date.now(),
    ...(plan === undefined ? (old?.plan ? { plan: old.plan } : {}) : (plan ? { plan } : {})),
    ...(analysisSummary === undefined ? (old?.analysisSummary ? { analysisSummary: old.analysisSummary } : {}) : (analysisSummary ? { analysisSummary } : {})),
  };
  await transact('readwrite', (store) => store.put(record));
  return record;
}

export async function deleteMusicTrack(id) { await transact('readwrite', (store) => store.delete(id)); }

export async function reorderMusicTrack(id, direction) {
  const tracks = await listMusicTracks(), index = tracks.findIndex((track) => track.id === id), next = index + Math.sign(direction);
  if (index < 0 || next < 0 || next >= tracks.length) return tracks;
  [tracks[index], tracks[next]] = [tracks[next], tracks[index]];
  await Promise.all(tracks.map((track, order) => transact('readwrite', (store) => store.put({ ...track, order }))));
  return listMusicTracks();
}
