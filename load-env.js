// Loads .env.local into process.env for LOCAL dev only.
//
// Imported first by server.js so the /api handlers see GEMINI_API_KEYS at module
// load. On Railway there is no .env.local (vars are injected directly), so this
// is a no-op there. process.loadEnvFile is native (Node 20.12+); guarded so older
// Node just skips it (then keys must be exported manually, as before).
import { existsSync } from 'fs';

if (existsSync('.env.local') && typeof process.loadEnvFile === 'function') {
  try {
    process.loadEnvFile('.env.local');
  } catch (err) {
    console.warn('load-env: could not read .env.local —', err.message);
  }
}
