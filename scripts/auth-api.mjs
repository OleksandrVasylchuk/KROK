import { validateAuthConfig } from '../src/auth-core.js';
/** Fail closed when configuration is broken. Provider validates tokens, never client claims. */
export function createAuthApi({ port=5177, getConfig, fetchImpl=fetch, allowedHosts, allowedOrigins, requireAuth=false, allowUser }={}) {
  const hosts=new Set(allowedHosts ?? [`127.0.0.1:${port}`,`localhost:${port}`,`10.0.2.2:${port}`]);
  const origins=new Set(allowedOrigins ?? [`http://127.0.0.1:${port}`,`http://localhost:${port}`,'https://localhost']);
  return async function authApi(req,res) {
    let pathname;
    try {pathname=new URL(req.url,'http://localhost').pathname;}catch{return false;}
    const isConfig=pathname==='/api/auth/config';
    const paid=pathname.startsWith('/api/coach') && !['GET','HEAD','OPTIONS'].includes(req.method);
    if(!isConfig&&!paid)return false;
    const headers={'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Vary':'Origin'};
    function reply(status,code,message,extra){if(!res.destroyed&&!res.writableEnded){res.writeHead(status,headers);res.end(JSON.stringify(extra??{error:{code,message}}));}return true;}
    if(!hosts.has(req.headers.host?.toLowerCase()))return reply(403,'forbidden_host','Ця адреса не має доступу до сервера КРОК.');
    const origin=req.headers.origin;
    if(origin!==undefined&&!origins.has(origin))return reply(403,'forbidden_origin','Ця сторінка не має доступу до сервера.');
    if(origin)headers['Access-Control-Allow-Origin']=origin;
    if(isConfig&&req.method==='OPTIONS'){
      const requested=(req.headers['access-control-request-headers']||'').toLowerCase().split(',').map(value=>value.trim()).filter(Boolean);
      if((req.headers['access-control-request-method']&&req.headers['access-control-request-method']!=='GET')||requested.some(value=>!['content-type','authorization'].includes(value)))return reply(403,'forbidden_preflight','Цей запит до сервера не дозволений.');
      headers['Access-Control-Allow-Methods']='GET, OPTIONS';headers['Access-Control-Allow-Headers']='Content-Type, Authorization';res.writeHead(204,headers);res.end();return true;
    }
    if(isConfig&&req.method!=='GET')return reply(405,'method_not_allowed','Потрібен запит GET.');
    let config;
    try{config=validateAuthConfig(await getConfig());}catch{return reply(503,'auth_configuration_error','Налаштування акаунтів потребують перевірки.');}
    if(isConfig)return reply(200,null,null,config);
    if(!config.configured)return requireAuth ? reply(503,'auth_configuration_error','Сервіс входу ще не налаштовано. Доступ до ШІ тимчасово закритий.') : false;
    const authorization=req.headers.authorization;
    if(typeof authorization!=='string'||!/^Bearer [A-Za-z0-9_.-]{20,8192}$/.test(authorization))return reply(401,'sign_in_required','Увійди в акаунт КРОК, щоб спілкуватися з ШІ.');
    const abort=new AbortController();
    const timer=setTimeout(()=>abort.abort(),6000);
    const disconnected=()=>abort.abort();
    req.once('aborted',disconnected);
    req.once('error',disconnected);
    res.once('close',disconnected);
    try{
      const response=await fetchImpl(`${config.supabaseUrl}/auth/v1/user`,{headers:{apikey:config.publishableKey,Authorization:authorization},signal:abort.signal,redirect:'error'});
      if(req.aborted||res.destroyed)return true;
      if(response.status===401||response.status===403)return reply(401,'session_expired','Сесія завершилась. Увійди ще раз.');
      if(!response.ok)return reply(503,'auth_unavailable','Сервіс входу тимчасово недоступний. Спробуй пізніше.');
      const user=await response.json();
      if(!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(user?.id)||user.is_anonymous===true)return reply(401,'invalid_session','Увійди в підтверджений акаунт.');
      if(allowUser && !await allowUser(user))return reply(403,'beta_access_required','ШІ-тренер поки доступний учасникам закритого тестування з підтвердженою поштою. Квести, звички й цілі можна використовувати без ШІ.');
      req.krokUserId=user.id;
      return false;
    }catch{if(req.aborted||res.destroyed)return true;return reply(503,'auth_unavailable','Не вдалося перевірити сесію. Спробуй ще раз.');}
    finally{clearTimeout(timer);req.off('aborted',disconnected);req.off('error',disconnected);res.off('close',disconnected);}
  };
}
