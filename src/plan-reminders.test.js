import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPlanReminders, createPlanReminderService, DEFAULT_PLAN_SETTINGS, MAX_PLAN_REMINDERS, PLAN_REMINDER_SOURCE, normalizePlanSettings } from './plan-reminders.js';
const scope='krok-state-v1:user:qa-a',otherScope='krok-state-v1:user:qa-b';
const now=()=>new Date(2026,10,18,8,0,0,0);
const settings=()=>({...DEFAULT_PLAN_SETTINGS,enabled:true,items:{},snoozes:{}});
function state(){return {quests:[{id:'q1',title:'QA квест',frequency:'daily',archived:false},{id:'once',title:'QA одноразовий',frequency:'once',scheduledDate:'2026-11-18',archived:false}],habits:[{id:'h1',title:'QA звичка',target:2,timeOfDay:'morning',frequency:'weekdays',weekdays:[3],archived:false}],completions:{},habitLogs:{}};}
function harness({permission='granted',requested='granted'}={}){
  const values=new Map(),pending=new Map(),calls=[];let listener,display=permission;
  const env={native:true,platform:'android',preferences:{get:async({key})=>({value:values.get(key)||null}),set:async({key,value})=>values.set(key,value)},notifications:{
    checkPermissions:async()=>{calls.push('check');return{display};},requestPermissions:async()=>{calls.push('request');display=requested;return{display};},
    getPending:async()=>({notifications:[...pending.values()]}),createChannel:async()=>calls.push('channel'),listChannels:async()=>({channels:[]}),
    schedule:async({notifications})=>{calls.push(['schedule',notifications.length]);for(const item of notifications)pending.set(item.id,structuredClone(item));},
    cancel:async({notifications})=>{calls.push(['cancel',notifications.length]);for(const item of notifications)pending.delete(item.id);},
    addListener:async(event,cb)=>{listener=cb;return{remove:async()=>{listener=undefined;}};},
  }};
  return{env,pending,values,calls,service:createPlanReminderService(env,now),emit:event=>listener?.(event),permission:value=>{display=value;}};
}
test('seven local calendar days respect weekdays, completion, archives and inexact scheduling',()=>{
  const s=state();s.completions['2026-11-18']=['once'];s.habitLogs['2026-11-18']={h1:2};
  const plan=buildPlanReminders(s,scope,settings(),{now:now()});assert.equal(plan.notifications.length,7);assert.equal(plan.until,'2026-11-24');
  for(const item of plan.notifications){assert.equal(item.schedule.at.getHours(),18);assert.equal(item.schedule.repeats,false);assert.equal(item.schedule.allowWhileIdle,false);assert.equal(item.isExactNotification,false);assert.equal(item.extra.ownerScope,scope);}
});
test('midnight boundary never schedules past time and once completion on another day stays complete',()=>{
  const s=state();s.completions['2026-11-17']=['once'];
  const plan=buildPlanReminders(s,scope,settings(),{now:new Date(2026,10,18,23,59)});
  assert.equal(plan.notifications.length,6);assert.equal(plan.notifications[0].extra.occurrenceDate,'2026-11-19');
});
test('quiet hours reject primary/override times; snooze crossing quiet end moves to next morning',()=>{
  assert.throws(()=>normalizePlanSettings({...settings(),questTime:'23:00'}),{code:'quiet_time'});
  assert.throws(()=>normalizePlanSettings({...settings(),items:{'quest:q1':{time:'06:00'}}}),{code:'quiet_time'});
  const s=settings();s.snoozes['quest:q1:2026-11-18']=new Date(2026,10,18,22,15).toISOString();
  const item=buildPlanReminders(state(),scope,s,{now:now()}).notifications.find(item=>item.extra.key==='quest:q1:2026-11-18');
  assert.equal(item.schedule.at.getDate(),19);assert.equal(item.schedule.at.getHours(),8);
});
test('nearest 64 cap, deduplication, deterministic collision avoidance and item disable',()=>{
  const s=state();s.quests=Array.from({length:90},(_,i)=>({...s.quests[0],id:'q'+i}));s.quests.push(s.quests[0]);
  const p=buildPlanReminders(s,scope,settings(),{now:now()});assert.equal(p.notifications.length,MAX_PLAN_REMINDERS);assert.ok(p.omitted>0);assert.equal(new Set(p.notifications.map(i=>i.extra.key)).size,p.notifications.length);
  const reserved=p.notifications[0].id;const q=buildPlanReminders(s,scope,settings(),{now:now(),reservedIds:[reserved]});assert.ok(q.notifications.every(i=>i.id!==reserved));
  const edited=settings();edited.items['quest:q1']={disabled:true,time:''};assert.ok(buildPlanReminders(state(),scope,edited,{now:now()}).notifications.every(i=>i.extra.itemId!=='q1'));
});
test('sync and navigation registration never ask permission; explicit enable requests it',async()=>{
  const h=harness({permission:'prompt'});await h.service.sync(state(),scope);await h.service.listenNavigation(()=>scope,()=>{});assert.equal(h.calls.includes('request'),false);assert.equal(h.pending.size,0);
  const result=await h.service.enable(state(),scope,settings());assert.equal(result.enabled,true);assert.equal(h.calls.filter(c=>c==='request').length,1);assert.ok(h.pending.size>0);
});
test('permission denial does not schedule or save enabled; revoked permission cancels our pending only',async()=>{
  const denied=harness({permission:'prompt',requested:'denied'});await assert.rejects(denied.service.enable(state(),scope,settings()),{code:'permission'});assert.equal(denied.pending.size,0);assert.equal(denied.values.size,0);
  const h=harness();h.pending.set(43101,{id:43101,body:'Daily'});await h.service.enable(state(),scope,settings());h.permission('denied');await h.service.sync(state(),scope);assert.deepEqual([...h.pending.keys()],[43101]);assert.equal(h.calls.includes('request'),false);
});
test('state sync cancels completed item occurrence, preserves future repetition and unrelated notifications',async()=>{
  const h=harness();h.pending.set(7,{id:7,body:'Other'});await h.service.enable(state(),scope,settings());const s=state();s.completions['2026-11-18']=['q1'];s.habitLogs['2026-11-18']={h1:2};await h.service.sync(s,scope);
  assert.equal([...h.pending.values()].some(i=>i.extra?.key==='quest:q1:2026-11-18'),false);assert.equal([...h.pending.values()].some(i=>i.extra?.key==='quest:q1:2026-11-19'),true);assert.ok(h.pending.has(7));
  const schedules=h.calls.filter(c=>Array.isArray(c)&&c[0]==='schedule').length;await h.service.sync(s,scope);assert.equal(h.calls.filter(c=>Array.isArray(c)&&c[0]==='schedule').length,schedules);
});
test('disable queued during permission dialog wins and no schedule launches',async()=>{
  const h=harness({permission:'prompt'});let resolve,entered;
  const started=new Promise(r=>entered=r);h.env.notifications.requestPermissions=()=>{entered();return new Promise(r=>resolve=r);};
  const enabling=h.service.enable(state(),scope,settings());await started;const disabling=h.service.disable(scope);resolve({display:'granted'});assert.equal((await enabling).cancelled,true);await disabling;assert.equal(h.pending.size,0);assert.equal(h.calls.some(c=>Array.isArray(c)&&c[0]==='schedule'),false);
});
test('account switch removes previous scopes; navigation refuses foreign scope and clear preserves daily',async()=>{
  const h=harness();h.pending.set(43101,{id:43101});await h.service.enable(state(),scope,settings());const old=[...h.pending.values()].find(i=>i.extra?.ownerScope===scope);await h.service.enable(state(),otherScope,settings());assert.equal([...h.pending.values()].some(i=>i.extra?.ownerScope===scope),false);
  const navigation=[];const remove=await h.service.listenNavigation(()=>otherScope,(...args)=>navigation.push(args));h.emit({notification:old,actionId:'tap'});assert.equal(navigation.length,0);h.emit({notification:[...h.pending.values()].find(i=>i.extra?.ownerScope===otherScope),actionId:'tap'});assert.equal(navigation.length,1);await remove();await h.service.clearOwnedSchedules();assert.deepEqual([...h.pending.keys()],[43101]);
});
test('snooze postpones original time by 30 minutes and quiet window to next allowed time',async()=>{
  const h=harness();const preferences=settings();preferences.questTime='21:45';await h.service.enable(state(),scope,preferences);await h.service.snooze(state(),scope,'quest','q1','2026-11-18');const item=[...h.pending.values()].find(i=>i.extra?.key==='quest:q1:2026-11-18');assert.equal(item.schedule.at.getDate(),19);assert.equal(item.schedule.at.getHours(),8);
});
test('schedule readback mismatch and cancellation failure remain errors',async()=>{
  const h=harness();h.env.notifications.schedule=async()=>{};await assert.rejects(h.service.enable(state(),scope,settings()),{code:'schedule_mismatch'});assert.equal(h.values.size,0);
  const g=harness();await g.service.enable(state(),scope,settings());g.env.notifications.cancel=async()=>{};await assert.rejects(g.service.clearOwnedSchedules(),{code:'not_cancelled'});
});
test('browser saves editable settings without claiming background delivery',async()=>{
  const values=new Map();const service=createPlanReminderService({native:false,platform:'web',storage:{getItem:key=>values.get(key),setItem:(key,value)=>values.set(key,value)}},now);
  const result=await service.enable(state(),scope,{...settings(),questTime:'19:30'});assert.equal(result.supported,false);assert.equal(result.enabled,false);assert.equal(result.settings.questTime,'19:30');assert.equal(result.pending,0);assert.ok(result.notifications.length>0);
});
