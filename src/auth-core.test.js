import test from 'node:test';
import assert from 'node:assert/strict';
import { createAuthController, validateAuthConfig, accountScope, accountStorageKey, isAuthCallback, NATIVE_AUTH_REDIRECT } from './auth-core.js';
const config={configured:true,supabaseUrl:'https://qa-project.supabase.co',publishableKey:'sb_publishable_qa_public_test_key_123456',googleEnabled:true};
const user={id:'11111111-1111-4111-8111-111111111111',email:'qa@example.test'};
const session={user,access_token:'qa-test-access-token'};
function fixture({native=false}={}){
  const calls=[],changes=[];let eventHandler;let currentSession=null;let nextError=null;
  const response=data=>({data,error:nextError});
  const client={auth:{
    onAuthStateChange(fn){eventHandler=fn;return {data:{subscription:{unsubscribe(){calls.push(['unsubscribe']);}}}};},
    async getSession(){calls.push(['getSession']);return response({session:currentSession});},
    async signInWithPassword(value){calls.push(['signin',value]);return response({session});},
    async signUp(value){calls.push(['signup',value]);return response({session:null,user});},
    async resetPasswordForEmail(...args){calls.push(['reset',...args]);return response({});},
    async updateUser(value){calls.push(['update',value]);return response({user});},
    async signInWithOAuth(value){calls.push(['oauth',value]);return response({url:config.supabaseUrl+'/auth/v1/authorize?provider=google'});},
    async exchangeCodeForSession(code){calls.push(['exchange',code]);return response({session});},
    async signOut(value){calls.push(['signout',value]);return response({});},
  }};
  const runtime={native,origin:'http://127.0.0.1:5178',url:'http://127.0.0.1:5178/#today',openBrowser:async url=>calls.push(['open',url]),closeBrowser:async()=>calls.push(['close']),clearCallback:()=>calls.push(['clear'])};
  const auth=createAuthController({client,config,runtime,onChange:value=>changes.push(value)});
  return {auth,calls,changes,runtime,emit:(...args)=>eventHandler(...args),setSession:value=>{currentSession=value;},setError:value=>{nextError=value;}};
}
test('public auth configuration rejects secrets, credentials and insecure URLs',()=>{
  assert.equal(validateAuthConfig(config).configured,true);
  for(const change of [{publishableKey:'sb_secret_do_not_share_123456789'},{publishableKey:'legacy.jwt.token'},{supabaseUrl:'http://qa-project.supabase.co'},{supabaseUrl:'https://user:password@qa-project.supabase.co'},{supabaseUrl:'https://qa-project.supabase.co/path'}])assert.throws(()=>validateAuthConfig({...config,...change}));
  assert.deepEqual(validateAuthConfig({configured:false}),{configured:false});
});
test('account storage separates local, user identities and Supabase projects',()=>{
  const a=accountStorageKey(accountScope(config,user));
  const b=accountStorageKey(accountScope(config,{...user,id:'22222222-2222-4222-8222-222222222222'}));
  const c=accountStorageKey(accountScope({...config,supabaseUrl:'https://second.supabase.co'},user));
  assert.equal(accountStorageKey('local'),'krok-state-v1');assert.notEqual(a,b);assert.notEqual(a,c);assert.notEqual(a,'krok-state-v1');
  assert.throws(()=>accountScope(config,{id:'../other'}));assert.throws(()=>accountStorageKey('../local'));
});
test('initialization and typing do not sign in, create users or open Google',async()=>{
  const f=fixture();await f.auth.initialize();assert.equal(f.auth.snapshot().scope,'local');assert.deepEqual(f.calls.map(x=>x[0]),['getSession']);
});
test('signup asks Supabase to confirm email and does not invent a session',async()=>{
  const f=fixture();const result=await f.auth.signUp(' qa@example.test ','safe-password-123');assert.equal(result.confirmationRequired,true);assert.equal(f.auth.snapshot().user,null);assert.equal(f.calls[0][1].options.emailRedirectTo,'http://127.0.0.1:5178/?auth=callback');
  await assert.rejects(()=>f.auth.signUp('qa@example.test','short'),/10/);assert.equal(f.calls.length,1);
});
test('signin publishes only account metadata and signout returns local scope',async()=>{
  const f=fixture();await f.auth.signIn(user.email,'test-password');assert.equal(f.auth.snapshot().user.id,user.id);assert.equal('access_token' in f.auth.snapshot(),false);await f.auth.signOut();assert.equal(f.auth.snapshot().scope,'local');assert.deepEqual(f.calls.at(-1),['signout',{scope:'local'}]);
});
test('Google uses explicit PKCE SDK redirect and only the configured authorize endpoint',async()=>{
  const f=fixture({native:true});await f.auth.google();assert.equal(f.calls[0][1].options.skipBrowserRedirect,true);assert.equal(f.calls[0][1].options.redirectTo,NATIVE_AUTH_REDIRECT);assert.equal(f.calls[1][0],'open');
});
test('callbacks accept exact destination once; wrong paths and repeat codes do not exchange',async()=>{
  const f=fixture({native:true});assert.equal(await f.auth.callback('app.krok.mobile://other/callback?code=one'),false);assert.equal(await f.auth.callback(NATIVE_AUTH_REDIRECT+'?code=one'),true);assert.equal(await f.auth.callback(NATIVE_AUTH_REDIRECT+'?code=one'),false);assert.equal(f.calls.filter(x=>x[0]==='exchange').length,1);assert.equal(f.calls.filter(x=>x[0]==='close').length,1);assert.equal(f.auth.snapshot().user.id,user.id);
  assert.equal(isAuthCallback('https://evil.test/?code=one','http://127.0.0.1:5178/?auth=callback'),false);
});
test('password recovery does not disclose account existence and update requires recovery session',async()=>{
  const f=fixture();await f.auth.reset('unknown@example.test');assert.equal(f.calls[0][0],'reset');await assert.rejects(()=>f.auth.updatePassword('new-password-123'),/посилання/);f.emit('PASSWORD_RECOVERY',session);await f.auth.updatePassword('new-password-123');assert.equal(f.auth.snapshot().recovery,false);
});
test('provider errors are sanitized and disposed subscriptions ignore late events',async()=>{
  const f=fixture();f.setError({code:'bad_error',message:'secret diagnostic token'});await assert.rejects(()=>f.auth.signIn(user.email,'test-password'),error=>!error.message.includes('secret'));f.auth.dispose();f.emit('SIGNED_IN',session);assert.equal(f.auth.snapshot().user,null);assert.equal(f.calls.at(-1)[0],'unsubscribe');
});
test('failed callback does not briefly publish an account or local profile before its error',async()=>{
  const f=fixture();f.runtime.url='http://127.0.0.1:5178/?auth=callback&error=access_denied';
  f.emit('INITIAL_SESSION',null);
  await assert.rejects(()=>f.auth.initialize(),/Вхід скасовано/);
  assert.equal(f.changes.length,0);assert.equal(f.calls.filter(call=>call[0]==='clear').length,1);assert.equal(f.calls.filter(call=>call[0]==='exchange').length,0);
});
