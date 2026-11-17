import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createAuthApi } from './auth-api.mjs';
import { loadAuthConfig } from './auth-config.mjs';
const config={configured:true,supabaseUrl:'https://qa-project.supabase.co',publishableKey:'sb_publishable_qa_public_test_key_123456',googleEnabled:true};
const id='11111111-1111-4111-8111-111111111111';
async function call(handler,{url='/api/coach/actions',method='POST',headers={}}={}){
 const req=Object.assign(new EventEmitter(),{url,method,headers:{host:'127.0.0.1:5177',origin:'http://127.0.0.1:5177',...headers},aborted:false});
 const res=Object.assign(new EventEmitter(),{destroyed:false,writeHead(status,headers){this.status=status;this.headers=headers;},end(body){this.body=body?JSON.parse(body):null;}});
 return {handled:await handler(req,res),req,res};
}
test('unconfigured accounts preserve local access and do not call auth provider',async()=>{
 const handler=createAuthApi({getConfig:async()=>({configured:false}),fetchImpl:async()=>{throw new Error('unexpected');}});
 assert.equal((await call(handler)).handled,false);const c=await call(handler,{url:'/api/auth/config',method:'GET'});assert.equal(c.res.status,200);assert.deepEqual(c.res.body,{configured:false});
});
test('mandatory deployment auth cannot fall back to anonymous paid access',async()=>{
 const handler=createAuthApi({requireAuth:true,getConfig:async()=>({configured:false}),fetchImpl:async()=>{throw new Error('must not fetch');}});
 const result=await call(handler);assert.equal(result.handled,true);assert.equal(result.res.status,503);assert.equal(result.res.body.error.code,'auth_configuration_error');
});
test('configured paid requests require a verified user before coach dispatch',async()=>{
 let calls=0;
 const handler=createAuthApi({getConfig:async()=>config,fetchImpl:async(url,options)=>{calls++;assert.equal(url,config.supabaseUrl+'/auth/v1/user');assert.equal(options.headers.apikey,config.publishableKey);return new Response(JSON.stringify({id}),{status:200});}});
 assert.equal((await call(handler)).res.status,401);assert.equal(calls,0);
 const accepted=await call(handler,{headers:{authorization:'Bearer qa.token.12345678901234567890'}});assert.equal(accepted.handled,false);assert.equal(accepted.req.krokUserId,id);assert.equal(calls,1);
 assert.equal((await call(handler,{url:'/api/coach/status',method:'GET'})).handled,false);
});
test('host and origin are rejected before leaking token or making provider call',async()=>{
 let calls=0;const handler=createAuthApi({getConfig:async()=>config,fetchImpl:async()=>{calls++;}});
 assert.equal((await call(handler,{headers:{host:'evil.test'}})).res.status,403);assert.equal((await call(handler,{headers:{origin:'https://evil.test'}})).res.status,403);assert.equal(calls,0);
});
test('invalid sessions, anonymous users and provider failures fail closed without raw diagnostics',async()=>{
 for(const result of [new Response('{}',{status:401}),new Response('{}',{status:503}),new Response(JSON.stringify({id,is_anonymous:true}),{status:200}),new Response(JSON.stringify({id:'bad'}),{status:200})]){
  const handler=createAuthApi({getConfig:async()=>config,fetchImpl:async()=>result});const response=await call(handler,{headers:{authorization:'Bearer qa.token.12345678901234567890'}});assert.equal(response.handled,true);assert.ok([401,503].includes(response.res.status));assert.equal(response.req.krokUserId,undefined);
 }
 const broken=createAuthApi({getConfig:async()=>{throw new Error('secret details');}});assert.equal((await call(broken)).res.status,503);
});
test('public config excludes unrelated environment values and rejects secret keys',async()=>{
 const loaded=await loadAuthConfig({env:{SUPABASE_URL:config.supabaseUrl,SUPABASE_PUBLISHABLE_KEY:config.publishableKey,OPENAI_API_KEY:'synthetic-never-output',KROK_GOOGLE_AUTH:'true'}});assert.deepEqual(loaded,config);assert.equal('OPENAI_API_KEY'in loaded,false);
 await assert.rejects(()=>loadAuthConfig({env:{SUPABASE_URL:config.supabaseUrl,SUPABASE_PUBLISHABLE_KEY:'sb_secret_bad'}}));
 assert.deepEqual(await loadAuthConfig({env:{},read:async()=>{throw Object.assign(new Error(),{code:'ENOENT'});}}),{configured:false});
 await assert.rejects(()=>loadAuthConfig({env:{},read:async()=>'{broken'}));
});
