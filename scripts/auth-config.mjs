import { readFile } from 'node:fs/promises';
import { validateAuthConfig } from '../src/auth-core.js';
const localConfig = new URL('../.local/auth-public.json',import.meta.url);
export async function loadAuthConfig({ env=process.env, read=readFile }={}) {
  let raw;
  if(env.SUPABASE_URL || env.SUPABASE_PUBLISHABLE_KEY) raw={configured:true,supabaseUrl:env.SUPABASE_URL,publishableKey:env.SUPABASE_PUBLISHABLE_KEY,googleEnabled:env.KROK_GOOGLE_AUTH==='true'};
  else { try {raw=JSON.parse(await read(localConfig,'utf8'));raw={...raw,configured:true};}catch(error){if(error.code==='ENOENT')return {configured:false};throw new Error('Invalid auth configuration');} }
  return validateAuthConfig(raw);
}
