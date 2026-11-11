// Guardar y abrir recorridos en Google Drive, desde el navegador (sin servidor).
// Usa Google Identity Services para pedir un token y la API REST de Drive v3.
// El permiso `drive.file` solo deja ver los archivos que creó esta app.

const CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined;
const SCOPE = 'https://www.googleapis.com/auth/drive.file';
const API = 'https://www.googleapis.com/drive/v3';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3';
const FOLDER = 'CarteroChino';
const TAG = "appProperties has { key='app' and value='cartero-chino' }";

export const driveConfigured = !!CLIENT_ID;

export interface DriveFile {
  id: string;
  name: string;
  modifiedTime: string;
}

interface TokenResponse {
  access_token?: string;
  expires_in?: number;
  error?: string;
}
declare global {
  interface Window {
    google?: {
      accounts: {
        oauth2: {
          initTokenClient(cfg: { client_id: string; scope: string; callback: (r: TokenResponse) => void }): { requestAccessToken(o?: { prompt?: string }): void };
        };
      };
    };
  }
}

let token: { value: string; until: number } | null = null;
let gis: Promise<void> | null = null;

function loadGis() {
  gis ??= new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://accounts.google.com/gsi/client';
    s.onload = () => resolve();
    s.onerror = () => {
      gis = null;
      reject(new Error('No se pudo cargar el inicio de sesión de Google'));
    };
    document.head.appendChild(s);
  });
  return gis;
}

/** Pide permiso la primera vez (ventana de Google); luego reutiliza el token ~1 h. */
async function getToken(): Promise<string> {
  if (!CLIENT_ID) throw new Error('Falta configurar VITE_GOOGLE_CLIENT_ID (ver COMO-FUNCIONA.md)');
  if (token && Date.now() < token.until) return token.value;
  await loadGis();
  return new Promise((resolve, reject) => {
    const client = window.google!.accounts.oauth2.initTokenClient({
      client_id: CLIENT_ID,
      scope: SCOPE,
      callback: (r) => {
        if (!r.access_token) return reject(new Error(r.error === 'access_denied' ? 'No diste permiso para usar Drive' : `Google: ${r.error}`));
        token = { value: r.access_token, until: Date.now() + ((r.expires_in ?? 3600) - 60) * 1000 };
        resolve(r.access_token);
      },
    });
    client.requestAccessToken({ prompt: token ? '' : 'consent' });
  });
}

async function api(url: string, init: RequestInit = {}) {
  const res = await fetch(url, { ...init, headers: { ...(init.headers ?? {}), Authorization: `Bearer ${await getToken()}` } });
  if (res.status === 401) token = null;
  if (!res.ok) throw new Error(`Drive respondió ${res.status}`);
  return res;
}

async function folderId(): Promise<string> {
  const q = encodeURIComponent(`name='${FOLDER}' and mimeType='application/vnd.google-apps.folder' and trashed=false`);
  const found = (await (await api(`${API}/files?q=${q}&fields=files(id)`)).json()) as { files: { id: string }[] };
  if (found.files[0]) return found.files[0].id;
  const created = await api(`${API}/files?fields=id`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: FOLDER, mimeType: 'application/vnd.google-apps.folder' }),
  });
  return ((await created.json()) as { id: string }).id;
}

/** Guarda el JSON; si se da `id`, reemplaza ese archivo. Devuelve el id. */
export async function saveToDrive(name: string, data: unknown, id?: string): Promise<string> {
  const meta: Record<string, unknown> = { name, mimeType: 'application/json', appProperties: { app: 'cartero-chino' } };
  if (!id) meta.parents = [await folderId()];
  const body = new FormData();
  body.append('metadata', new Blob([JSON.stringify(meta)], { type: 'application/json' }));
  body.append('file', new Blob([JSON.stringify(data)], { type: 'application/json' }));
  const url = id ? `${UPLOAD}/files/${id}?uploadType=multipart&fields=id` : `${UPLOAD}/files?uploadType=multipart&fields=id`;
  const res = await api(url, { method: id ? 'PATCH' : 'POST', body });
  return ((await res.json()) as { id: string }).id;
}

export async function listDrive(): Promise<DriveFile[]> {
  const q = encodeURIComponent(`${TAG} and trashed=false`);
  const res = await api(`${API}/files?q=${q}&orderBy=modifiedTime desc&pageSize=50&fields=files(id,name,modifiedTime)`);
  return ((await res.json()) as { files: DriveFile[] }).files;
}

export async function openFromDrive(id: string): Promise<string> {
  return (await api(`${API}/files/${id}?alt=media`)).text();
}
