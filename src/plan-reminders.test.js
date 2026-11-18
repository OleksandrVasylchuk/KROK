import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPlanReminders, createPlanReminderService, DEFAULT_PLAN_SETTINGS, MAX_PLAN_REMINDERS, PLAN_ACTION_TYPE, PLAN_REMINDER_ACTIONS, PLAN_REMINDER_SOURCE, normalizePlanSettings, planActionEffect } from './plan-reminders.js';
import { localDate, reducer } from './model.js';
const scope='krok-state-v1:user:qa-a',otherScope='krok-state-v1:user:qa-b';
const now=()=>new Date(2026,10,18,8,0,0,0);
const settings=()=>({...DEFAULT_PLAN_SETTINGS,enabled:true,items:{},snoozes:{},skips:{}});
const today='2026-11-18',storageKey='krok-plan-reminders-v1:'+encodeURIComponent(scope);
const at=(hour,minute=0,day=18)=>new Date(2026,10,day,hour,minute,0,0);
const pendingKey=(h,key)=>[...h.pending.values()].find(item=>item.extra?.key===key);
const scheduleCalls=h=>h.calls.filter(call=>Array.isArray(call)&&call[0]==='schedule');
function state(){return {quests:[{id:'q1',title:'QA квест',frequency:'daily',archived:false},{id:'once',title:'QA одноразовий',frequency:'once',scheduledDate:'2026-11-18',archived:false}],habits:[{id:'h1',title:'QA звичка',target:2,timeOfDay:'morning',frequency:'weekdays',weekdays:[3],archived:false}],completions:{},habitLogs:{}};}
function harness({permission='granted',requested='granted',actionTypes=true,androidReadback=false}={}){
  const values=new Map(),pending=new Map(),calls=[],types=[];let listener,display=permission,time=now();
  const env={native:true,platform:'android',preferences:{get:async({key})=>({value:values.get(key)||null}),set:async({key,value})=>values.set(key,value)},notifications:{
    checkPermissions:async()=>{calls.push('check');return{display};},requestPermissions:async()=>{calls.push('request');display=requested;return{display};},
    // Real Android getPending() omits the top-level actionTypeId; `androidReadback` reproduces that.
    getPending:async()=>({notifications:[...pending.values()].map(item=>{if(!androidReadback)return item;const {actionTypeId,...rest}=item;return rest;})}),createChannel:async()=>calls.push('channel'),listChannels:async()=>({channels:[]}),
    registerActionTypes:async({types:list})=>{calls.push('actions');types.push(...structuredClone(list));},
    schedule:async({notifications})=>{calls.push(['schedule',notifications.length]);for(const item of notifications)pending.set(item.id,structuredClone(item));},
    cancel:async({notifications})=>{calls.push(['cancel',notifications.length]);for(const item of notifications)pending.delete(item.id);},
    addListener:async(event,cb)=>{listener=cb;return{remove:async()=>{listener=undefined;}};},
  }};
  if(!actionTypes)delete env.notifications.registerActionTypes;
  return{env,pending,values,calls,types,service:createPlanReminderService(env,()=>new Date(time)),emit:event=>listener?.(event),permission:value=>{display=value;},setNow:value=>{time=value;},stored:()=>JSON.parse(values.get(storageKey))};
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
test('answer buttons are registered before scheduling and every plan notification carries the action type',async()=>{
  assert.deepEqual(PLAN_ACTION_TYPE,{id:'krok-plan-actions-v1',actions:[{id:'done',title:'Зробив'},{id:'snooze',title:'Через 30 хв'},{id:'skip',title:'Сьогодні пропускаю'}]});
  const plan=buildPlanReminders(state(),scope,settings(),{now:now()});assert.ok(plan.notifications.length>0);
  for(const item of plan.notifications){assert.equal(item.actionTypeId,PLAN_REMINDER_ACTIONS);assert.equal(item.extra.actionTypeId,PLAN_REMINDER_ACTIONS);assert.equal(item.extra.source,PLAN_REMINDER_SOURCE);}
  const h=harness();await h.service.enable(state(),scope,settings());assert.deepEqual(h.types,[PLAN_ACTION_TYPE]);
  assert.ok(h.calls.indexOf('actions')>h.calls.indexOf('channel'));assert.ok(h.calls.indexOf('actions')<h.calls.findIndex(call=>Array.isArray(call)&&call[0]==='schedule'));
  assert.ok([...h.pending.values()].every(item=>item.actionTypeId===PLAN_REMINDER_ACTIONS));
  const off=harness();await off.service.disable(scope);assert.equal(off.calls.includes('actions'),false);
  const bare=harness({actionTypes:false});const result=await bare.service.enable(state(),scope,settings());assert.equal(result.enabled,true);assert.ok(bare.pending.size>0);
});
test('pending notifications without the action type are upgraded once; Android readback without the top-level field still confirms',async()=>{
  const h=harness();await h.service.enable(state(),scope,settings());const total=h.pending.size;h.pending.set(43101,{id:43101,body:'Daily'});
  for(const item of h.pending.values()){if(item.extra?.source!==PLAN_REMINDER_SOURCE)continue;delete item.actionTypeId;delete item.extra.actionTypeId;}
  const first=scheduleCalls(h).length;await h.service.sync(state(),scope);assert.equal(scheduleCalls(h).length,first+1);assert.deepEqual(scheduleCalls(h).at(-1),['schedule',total]);assert.ok([...h.pending.values()].filter(item=>item.extra?.source===PLAN_REMINDER_SOURCE).every(item=>item.actionTypeId===PLAN_REMINDER_ACTIONS&&item.extra.actionTypeId===PLAN_REMINDER_ACTIONS));
  const count=scheduleCalls(h).length;await h.service.sync(state(),scope);assert.equal(scheduleCalls(h).length,count);assert.deepEqual(h.pending.get(43101),{id:43101,body:'Daily'});
  const android=harness({androidReadback:true});const result=await android.service.enable(state(),scope,settings());assert.equal(result.enabled,true);assert.equal(result.pending,android.pending.size);
  const before=scheduleCalls(android).length;await android.service.sync(state(),scope);assert.equal(scheduleCalls(android).length,before);
});
test('listener passes done, snooze, skip and open; dismiss, foreign scope and foreign notifications stay ignored',async()=>{
  const h=harness();await h.service.enable(state(),scope,settings());const quest=pendingKey(h,'quest:q1:2026-11-18'),habit=pendingKey(h,'habit:h1:2026-11-18'),events=[];
  const remove=await h.service.listenNavigation(()=>scope,(...args)=>events.push(args));
  for(const actionId of ['done','snooze','skip','tap','unknown-button'])h.emit({notification:quest,actionId});
  assert.deepEqual(events.map(([destination,info])=>[destination,info.action]),[['quests','done'],['quests','snooze'],['quests','skip'],['quests','open'],['quests','open']]);
  assert.deepEqual(events[0][1],{kind:'quest',id:'q1',date:'2026-11-18',action:'done'});
  h.emit({notification:habit,actionId:'done'});assert.deepEqual(events.at(-1),['habits',{kind:'habit',id:'h1',date:'2026-11-18',action:'done'}]);
  const size=events.length;h.emit({notification:quest,actionId:'dismiss'});h.emit({notification:{...quest,extra:{...quest.extra,ownerScope:otherScope}},actionId:'done'});
  h.emit({notification:{id:43101,extra:{source:'krok-daily',destination:'quests'}},actionId:'done'});h.emit({notification:{...quest,extra:{...quest.extra,destination:'money'}},actionId:'skip'});h.emit({actionId:'done'});
  assert.equal(events.length,size);await remove();h.emit({notification:quest,actionId:'done'});assert.equal(events.length,size);
});
test('skip omits only that occurrence, persists, never touches app state and rejects past dates',async()=>{
  const skipped=settings();skipped.skips['quest:q1:2026-11-18']=true;const plan=buildPlanReminders(state(),scope,skipped,{now:now()});
  assert.equal(plan.notifications.some(item=>item.extra.key==='quest:q1:2026-11-18'),false);assert.equal(plan.notifications.some(item=>item.extra.key==='quest:q1:2026-11-19'),true);assert.equal(plan.total,buildPlanReminders(state(),scope,settings(),{now:now()}).total-1);
  const h=harness();h.pending.set(43101,{id:43101,body:'Daily'});await h.service.enable(state(),scope,settings());assert.ok(pendingKey(h,'quest:q1:2026-11-18'));
  const s=state(),snapshot=structuredClone(s);const result=await h.service.skip(s,scope,'quest','q1',today);
  assert.deepEqual(s,snapshot);assert.equal(result.settings.skips['quest:q1:2026-11-18'],true);assert.deepEqual(h.stored().skips,{'quest:q1:2026-11-18':true});
  assert.equal(pendingKey(h,'quest:q1:2026-11-18'),undefined);assert.ok(pendingKey(h,'quest:q1:2026-11-19'));assert.ok(pendingKey(h,'habit:h1:2026-11-18'));assert.ok(h.pending.has(43101));
  await h.service.sync(s,scope);assert.equal(pendingKey(h,'quest:q1:2026-11-18'),undefined);
  await h.service.skip(s,scope,'quest','q1',today);assert.deepEqual(h.stored().skips,{'quest:q1:2026-11-18':true});
  await h.service.skip(s,scope,'quest','q1','2026-11-20');assert.equal(pendingKey(h,'quest:q1:2026-11-20'),undefined);assert.ok(pendingKey(h,'quest:q1:2026-11-21'));
  await assert.rejects(h.service.skip(s,scope,'quest','q1','2026-11-17'),{code:'skip'});await assert.rejects(h.service.skip(s,scope,'quest','absent',today),{code:'missing'});await assert.rejects(h.service.skip(s,scope,'habit','h1','2026-11-19'),{code:'missing'});
  const done=state();done.completions[today]=['once'];await assert.rejects(h.service.skip(done,scope,'quest','once',today),{code:'missing'});
  assert.throws(()=>h.service.skip(s,scope,'goal','q1',today),{code:'skip'});assert.throws(()=>h.service.skip(s,scope,'quest','q1','today'),{code:'skip'});
  assert.deepEqual(Object.keys(h.stored().skips),['quest:q1:2026-11-18','quest:q1:2026-11-20']);
  h.setNow(at(18,5));await h.service.snooze(s,scope,'habit','h1',today);assert.ok(h.stored().snoozes['habit:h1:2026-11-18']);
  await h.service.skip(s,scope,'habit','h1',today);assert.equal(h.stored().snoozes['habit:h1:2026-11-18'],undefined);assert.equal(h.stored().skips['habit:h1:2026-11-18'],true);assert.equal(pendingKey(h,'habit:h1:2026-11-18'),undefined);assert.deepEqual(s,snapshot);
  await h.service.disable(scope);assert.deepEqual(h.stored().skips,{});assert.equal(h.stored().enabled,false);assert.deepEqual([...h.pending.keys()],[43101]);
  const off=harness();await assert.rejects(off.service.skip(state(),scope,'quest','q1',today),{code:'disabled'});assert.equal(off.pending.size,0);
});
test('snooze works after the reminder was delivered: now plus 30 minutes for a due, unfinished occurrence only',async()=>{
  const h=harness();await h.service.enable(state(),scope,settings());h.setNow(at(18,5));await h.service.sync(state(),scope);assert.equal(pendingKey(h,'quest:q1:2026-11-18'),undefined);
  const result=await h.service.snooze(state(),scope,'quest','q1',today);const item=pendingKey(h,'quest:q1:2026-11-18');
  assert.equal(new Date(item.schedule.at).getTime(),at(18,35).getTime());assert.equal(item.actionTypeId,PLAN_REMINDER_ACTIONS);assert.equal(h.stored().snoozes['quest:q1:2026-11-18'],at(18,35).toISOString());assert.ok(result.notifications.some(entry=>entry.extra.key==='quest:q1:2026-11-18'));
  h.setNow(at(18,40));await h.service.snooze(state(),scope,'quest','q1',today);assert.equal(new Date(pendingKey(h,'quest:q1:2026-11-18').schedule.at).getTime(),at(19,10).getTime());
  await h.service.snooze(state(),scope,'quest','q1','2026-11-19');assert.equal(new Date(pendingKey(h,'quest:q1:2026-11-19').schedule.at).getTime(),at(18,30,19).getTime());
  const done=state();done.completions[today]=['q1'];await assert.rejects(h.service.snooze(done,scope,'quest','q1',today),{code:'missing'});
  const full=state();full.habitLogs[today]={h1:2};await assert.rejects(h.service.snooze(full,scope,'habit','h1',today),{code:'missing'});
  const archived=state();archived.quests[0].archived=true;await assert.rejects(h.service.snooze(archived,scope,'quest','q1',today),{code:'missing'});
  await assert.rejects(h.service.snooze(state(),scope,'habit','h1','2026-11-19'),{code:'missing'});await assert.rejects(h.service.snooze(state(),scope,'quest','q1','2026-11-17'),{code:'missing'});
  assert.throws(()=>h.service.snooze(state(),scope,'quest','q1',today,45),{code:'snooze'});
  const partial=state();partial.habitLogs[today]={h1:1};await h.service.snooze(partial,scope,'habit','h1',today);assert.equal(new Date(pendingKey(h,'habit:h1:2026-11-18').schedule.at).getTime(),at(19,10).getTime());
});
test('snooze of a delivered reminder that lands in quiet hours moves to the next allowed time',async()=>{
  const h=harness();await h.service.enable(state(),scope,{...settings(),questTime:'21:45'});h.setNow(at(21,50));
  await h.service.snooze(state(),scope,'quest','q1',today);assert.equal(new Date(pendingKey(h,'quest:q1:2026-11-18').schedule.at).getTime(),at(8,0,19).getTime());
  const day=harness();await day.service.enable(state(),scope,{...settings(),quietStart:'13:00',quietEnd:'15:00',questTime:'12:40',day:'16:00'});day.setNow(at(12,45));
  await day.service.snooze(state(),scope,'quest','q1',today);assert.equal(new Date(pendingKey(day,'quest:q1:2026-11-18').schedule.at).getTime(),at(15,0).getTime());
});
test('snoozes and skips of past days are dropped on normalize and save; current ones and the 300 cap stay',async()=>{
  const value={...settings(),snoozes:{'quest:q1:2026-11-17':at(19,0,17).toISOString(),'quest:q1:2026-11-18':at(19).toISOString(),'bad':at(19).toISOString(),'quest:q1:2026-11-19':'not a date'},skips:{'habit:h1:2026-11-17':true,'habit:h1:2026-11-18':true,'habit:h1:2026-11-19':'yes','goal:g1:2026-11-18':true}};
  const kept=normalizePlanSettings(value);assert.deepEqual(Object.keys(kept.snoozes),['quest:q1:2026-11-17','quest:q1:2026-11-18']);assert.deepEqual(kept.skips,{'habit:h1:2026-11-17':true,'habit:h1:2026-11-18':true});
  const cleaned=normalizePlanSettings(value,today);assert.deepEqual(cleaned.snoozes,{'quest:q1:2026-11-18':at(19).toISOString()});assert.deepEqual(cleaned.skips,{'habit:h1:2026-11-18':true});
  assert.deepEqual(normalizePlanSettings(value,today),cleaned);assert.deepEqual(normalizePlanSettings(value,'bad-date').skips,kept.skips);assert.deepEqual(normalizePlanSettings().skips,{});assert.notEqual(normalizePlanSettings().skips,DEFAULT_PLAN_SETTINGS.skips);
  const many={};for(let i=0;i<10;i++)many['quest:old'+i+':2026-11-17']=true;for(let i=0;i<320;i++)many['quest:q'+i+':2026-11-18']=true;
  const capped=normalizePlanSettings({...settings(),skips:many},today);assert.equal(Object.keys(capped.skips).length,300);assert.ok(Object.keys(capped.skips).every(key=>key.endsWith(today)));
  const h=harness();h.values.set(storageKey,JSON.stringify(value));const result=await h.service.sync(state(),scope);
  assert.deepEqual(result.settings.skips,{'habit:h1:2026-11-18':true});assert.deepEqual(h.stored().skips,{'habit:h1:2026-11-18':true});assert.deepEqual(h.stored().snoozes,{'quest:q1:2026-11-18':at(19).toISOString()});
  assert.equal(pendingKey(h,'habit:h1:2026-11-18'),undefined);assert.equal(new Date(pendingKey(h,'quest:q1:2026-11-18').schedule.at).getTime(),at(19).getTime());
});
test('an answer superseded by a newer sync is saved for it; a refused answer still leaves the schedule reconciled',async()=>{
  const h=harness();await h.service.enable(state(),scope,settings());
  const skipping=h.service.skip(state(),scope,'quest','q1',today),syncing=h.service.sync(state(),scope);assert.deepEqual(await skipping,{cancelled:true,saved:true});await syncing;
  assert.equal(pendingKey(h,'quest:q1:2026-11-18'),undefined);assert.equal(h.stored().skips['quest:q1:2026-11-18'],true);
  const g=harness();g.values.set(storageKey,JSON.stringify(settings()));const queued=g.service.sync(state(),scope);
  await assert.rejects(g.service.snooze(state(),scope,'quest','q1','2026-11-17'),{code:'missing'});assert.equal((await queued).cancelled,true);assert.ok(pendingKey(g,'quest:q1:2026-11-18'));assert.deepEqual(g.stored().snoozes,{});
});
test('planActionEffect: every branch, and a finished quest is never toggled',()=>{
  const base=()=>{const s=state();s.quests=s.quests.map(quest=>({...quest,xp:15}));s.quests.push({id:'old',title:'QA архів',frequency:'daily',archived:true,xp:5},{id:'fri',title:'QA в інший день',frequency:'weekdays',weekdays:[5],archived:false,xp:5});s.habits.push({id:'gone',title:'QA архівна звичка',target:1,frequency:'daily',archived:true});return s;};
  const info=(kind,id,action,date=today)=>({kind,id,date,action});
  assert.deepEqual(planActionEffect(base(),info('quest','q1','done'),today),{type:'dispatch',action:{type:'TOGGLE_QUEST',id:'q1'},message:'Крок зроблено! +15 XP'});
  assert.deepEqual(planActionEffect(base(),info('habit','h1','done'),today),{type:'dispatch',action:{type:'LOG_HABIT',id:'h1'},message:'Ще один маленький крок: 1 / 2'});
  const half=base();half.habitLogs[today]={h1:1};assert.deepEqual(planActionEffect(half,info('habit','h1','done'),today),{type:'dispatch',action:{type:'LOG_HABIT',id:'h1'},message:'Звичку виконано на сьогодні'});
  const finished=base();finished.completions[today]=['q1'];finished.habitLogs[today]={h1:2};const copy=structuredClone(finished);
  for(const action of ['done','snooze','skip']){assert.deepEqual(planActionEffect(finished,info('quest','q1',action),today),{type:'none',message:'Цю справу вже відмічено.'});assert.deepEqual(planActionEffect(finished,info('habit','h1',action),today),{type:'none',message:'Цю справу вже відмічено.'});}
  assert.deepEqual(finished,copy);
  const once=base();once.completions['2026-11-17']=['once'];assert.deepEqual(planActionEffect(once,info('quest','once','done'),today),{type:'none',message:'Цю справу вже відмічено.'});
  assert.deepEqual(planActionEffect(base(),info('quest','q1','done','2026-11-17'),today),{type:'none',message:'Це нагадування за інший день. Відміть справу у списку.'});
  assert.equal(planActionEffect(base(),info('quest','q1','done','2026-11-19'),today).type,'none');
  for(const action of ['snooze','skip'])assert.deepEqual(planActionEffect(base(),info('quest','q1',action,'2026-11-17'),today),{type:'none',message:'Це нагадування за інший день. Воно вже неактуальне.'});
  for(const [kind,id] of [['quest','absent'],['quest','old'],['habit','gone'],['goal','q1'],['habit','q1']])for(const action of ['done','snooze','skip'])assert.deepEqual(planActionEffect(base(),info(kind,id,action),today),{type:'none',message:'Цієї справи вже немає серед активних.'});
  assert.deepEqual(planActionEffect(base(),info('quest','fri','done'),today),{type:'none',message:'Сьогодні цієї справи немає в плані.'});
  assert.deepEqual(planActionEffect(base(),info('quest','q1','snooze'),today),{type:'snooze',message:'Нагадаю через 30 хвилин, поза тихими годинами.'});
  assert.deepEqual(planActionEffect(base(),info('habit','h1','skip'),today),{type:'skip',message:'Сьогодні без цього нагадування. Справу не відмічено.'});
  for(const value of [info('quest','q1','open'),info('quest','q1','dismiss'),info('quest','q1',undefined),null,'done'])assert.deepEqual(planActionEffect(base(),value,today),{type:'none',message:''});
  assert.deepEqual(planActionEffect({},info('quest','q1','done'),today),{type:'none',message:'Цієї справи вже немає серед активних.'});
});
test('planActionEffect actions are accepted by the real reducer: one completion, one habit step, no second toggle',()=>{
  const date=localDate();
  let s={quests:[{id:'q1',title:'QA квест',frequency:'daily',archived:false,xp:15}],habits:[{id:'h1',title:'QA звичка',target:3,frequency:'daily',archived:false}],completions:{},habitLogs:{}};
  const quest=planActionEffect(s,{kind:'quest',id:'q1',date,action:'done'},date);s=reducer(s,quest.action);assert.deepEqual(s.completions[date],['q1']);
  const again=planActionEffect(s,{kind:'quest',id:'q1',date,action:'done'},date);assert.equal(again.type,'none');assert.equal(again.action,undefined);
  const habit=planActionEffect(s,{kind:'habit',id:'h1',date,action:'done'},date);s=reducer(s,habit.action);assert.equal(s.habitLogs[date].h1,1);assert.deepEqual(s.completions[date],['q1']);
});
