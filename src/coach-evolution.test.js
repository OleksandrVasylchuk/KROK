import test from 'node:test';
import assert from 'node:assert/strict';
import { createInitialState, reducer, localDate, restoreState, selectStats } from './model.js';
import { validateBackup } from './persistence.js';
import { buildCoachPersonalContext, validateCoachPersonalContext } from './coach-personal.js';
import { buildCoachActionContext, coachStateFingerprint, validateCoachActions, checkCoachProposal } from './coach-actions.js';
import { buildCoachActionPayload, buildDailyPlanPayload, createCoachClient } from './coach-client.js';
import { validateActionRequest, parseActionResponse } from '../scripts/coach-actions.mjs';
import { validatePlanRequest } from '../scripts/daily-plan.mjs';

const today = localDate();
const content = actions => ({ text: 'Пропоную переглянути зміни.', actions });
const memory = (extra={}) => ({ type:'create_memory',ref:'remember',text:'Увечері маю 15 хвилин для читання.',category:'growth',...extra });
const expense = (extra={}) => ({type:'record_expense',ref:'expense',title:'Обід у кафе',amount:180,category:'Кафе та ресторани',date:today,account:'card',note:'',...extra});
const checkin = (extra={}) => ({type:'set_checkin',ref:'checkin',date:today,mood:3,energy:2,note:'Втомився, читання перенесу.',...extra});
const editQuest = (state,extra={}) => { const quest=state.quests[0]; return {type:'update_quest',ref:'reschedule',id:quest.id,title:quest.title,description:quest.description,minutes:5,frequency:'once',weekdays:[],scheduledDate:today,...extra}; };
const proposal = (state,actions,id='evolution')=>({id,date:today,...content(actions),model:'test',sourceFingerprint:coachStateFingerprint(state,today),status:'pending',appliedIds:[]});
const saveApply = (state,actions,id='evolution')=>reducer(reducer(state,{type:'SAVE_COACH_PROPOSAL',proposal:proposal(state,actions,id)}),{type:'APPLY_COACH_PROPOSAL',id});
const fail = (status,code,message)=>{ throw Object.assign(new Error(message),{status,code}); };
const messages = [{role:'user',text:'Запам’ятай мій ритм і запиши обід.',source:'openai'}];

test('memory, expense, check-in and adaptive quest apply together without XP and survive backup/replay',()=>{
  const initial=createInitialState();
  const next=saveApply(initial,[memory(),expense(),checkin(),editQuest(initial)]);
  assert.equal(next.coachProposals[0].status,'applied');
  assert.equal(next.coachMemory[0].text,memory().text);
  assert.equal(next.expenses[0].amount,180);
  assert.deepEqual(next.checkIns[today],{mood:3,energy:2,note:checkin().note});
  assert.equal(next.quests[0].minutes,5);
  assert.equal(next.quests[0].frequency,'once');
  assert.equal(selectStats(next).totalXp,0);
  const restored=validateBackup(JSON.stringify(next));
  assert.deepEqual(restored.coachMemory,next.coachMemory);
  assert.deepEqual(restored.expenses,next.expenses);
  assert.deepEqual(restored.coachProposals[0].appliedIds,['coach-evolution-0','coach-evolution-1',`checkin-${today}`,initial.quests[0].id]);
  assert.equal(reducer(restored,{type:'APPLY_COACH_PROPOSAL',id:'evolution'}),restored);
});

test('memory edits need current authorized memory, never merely record or profile consent',()=>{
  let state=reducer(createInitialState(),{type:'UPSERT_COACH_MEMORY',memory:{id:'fact',text:'Читаю ввечері.',category:'growth'}});
  const update={type:'update_memory',ref:'edit',id:'fact',text:'Читаю вранці.',category:'growth'};
  assert.equal(validateCoachActions(content([update]),{date:today,context:buildCoachActionContext(state,today)}).error.code,'memory_context_required');
  state.profile.coachMemoryConsent=true;
  const personalContext=buildCoachPersonalContext(state,today);
  assert.equal(validateCoachActions(content([update]),{date:today,personalContext}).ok,true);
  assert.equal(validateCoachActions(content([{...update,id:'unknown'}]),{date:today,personalContext}).ok,false);
  const saved=reducer(state,{type:'SAVE_COACH_PROPOSAL',proposal:proposal(state,[update])});
  const revoked=reducer(saved,{type:'UPDATE_PROFILE',profile:{coachMemoryConsent:false}});
  const applied=reducer(revoked,{type:'APPLY_COACH_PROPOSAL',id:'evolution'});
  assert.equal(applied.coachMemory[0].text,update.text,'revoking transfer does not block downloaded local proposal');
  const deleted=saveApply(applied,[{type:'delete_memory',ref:'delete',id:'fact'}],'delete-fact');
  assert.equal(deleted.coachMemory.length,0);
  assert.equal(validateBackup(JSON.stringify(deleted)).coachProposals.at(-1).status,'applied');
});

test('separate memory/journal gates protect raw records across chat and daily plans',()=>{
  const state=reducer(createInitialState(),{type:'UPSERT_COACH_MEMORY',memory:{id:'fact',text:'PRIVATE_MEMORY',category:'growth'}});
  state.checkIns={[today]:{mood:2,energy:1,note:'PRIVATE_JOURNAL'},'2000-01-01':{mood:5,energy:5,note:'OLD_NOTE'}};
  state.expenses=[{id:'expense',title:'PRIVATE_EXPENSE',date:today,amount:10,category:'Інше',account:'cash',type:'expense',note:''}];
  state.profile.coachActionsConsent=true;
  state.profile.coachContextConsent=true;
  assert.ok(!JSON.stringify(buildCoachActionPayload(state,messages,today)).includes('PRIVATE'));
  state.profile.coachMemoryConsent=true;
  let payload=buildCoachActionPayload(state,messages,today);
  assert.ok(JSON.stringify(payload).includes('PRIVATE_MEMORY'));
  assert.ok(!JSON.stringify(payload).includes('PRIVATE_JOURNAL'));
  state.profile.coachJournalConsent=true;
  payload=buildCoachActionPayload(state,messages,today);
  assert.equal(payload.personalContext.checkIns.length,1);
  assert.ok(!JSON.stringify(payload).includes('OLD_NOTE'));
  assert.ok(!JSON.stringify(payload).includes('PRIVATE_EXPENSE'));
  state.profile.lifeProfile.aiConsent=true;
  state.profile.lifeProfile.domains.growth.desired='Читати';
  const plan=buildDailyPlanPayload(state,today);
  assert.equal(validatePlanRequest(plan,fail).personalContext.checkIns[0].energy,1);
  assert.ok(JSON.stringify(plan).includes('PRIVATE_MEMORY'));
  state.profile.coachMemoryConsent=false;
  state.profile.coachJournalConsent=false;
  assert.equal(buildDailyPlanPayload(state,today).personalContext,undefined);
});

test('personal API gates reject false/string consent, duplicates, future journals and secret-shaped memories',()=>{
  const fact={id:'fact',text:'Тихі ранки.',category:'mind',updatedAt:today};
  const bad=[
    {memoryConsent:false,memory:[fact]},
    {memoryConsent:'true',memory:[fact]},
    {journalConsent:false,checkIns:[]},
    {memoryConsent:true,memory:[fact,fact]},
    {memoryConsent:true,memory:[{...fact,text:'password: secret-value'}]},
    {journalConsent:true,checkIns:[{date:'2199-01-01',mood:3,energy:3,note:''}]},
  ];
  for(const personalContext of bad) assert.throws(()=>validateActionRequest({date:today,personalContext},{messages:[],tone:'supportive'},fail));
  const result=validateCoachPersonalContext({memoryConsent:true,memory:[{...fact,unshared:'DO_NOT_TRANSMIT'}]},today,fail);
  assert.ok(!JSON.stringify(result).includes('DO_NOT_TRANSMIT'));
  for(const text of ['sk-proj-abcdefghijklmnopqrstuv','пароль: abc123','-----BEGIN PRIVATE KEY-----']) assert.equal(validateCoachActions(content([memory({text})]),{date:today}).ok,false);
});

test('expense validation rejects bad money and future dates; duplicate transactions stay blocked across new proposals',()=>{
  for(const action of [expense({amount:0}),expense({amount:0.001}),expense({amount:Infinity}),expense({date:'2199-01-01'}),expense({account:'bank'}),expense({currency:'USD'})]) assert.equal(validateCoachActions(content([action]),{date:today}).ok,false);
  const initial=createInitialState();
  const first=saveApply(initial,[expense()]);
  assert.equal(first.expenses.length,1);
  assert.equal(checkCoachProposal(first,proposal(first,[expense()],'again'),{today}).error.code,'already_exists');
  assert.equal(validateCoachActions(content([expense(),expense({ref:'again'})]),{date:today}).error.code,'duplicate_expense');
  const full={...initial,expenses:Array.from({length:10000},(_,i)=>({id:`exp-${i}`,title:`Інше ${i}`,date:today,amount:1,category:'Інше',account:'card',type:'expense',note:''}))};
  const saved=reducer(full,{type:'SAVE_COACH_PROPOSAL',proposal:proposal(full,[memory(),expense()])});
  assert.equal(reducer(saved,{type:'APPLY_COACH_PROPOSAL',id:'evolution'}),saved,'capacity failure is atomic');
});

test('rescheduling requires authorized context and never changes a quest with earned history',()=>{
  const state=createInitialState();
  const action=editQuest(state);
  assert.equal(validateCoachActions(content([action]),{date:today}).error.code,'context_required');
  const completed=reducer(state,{type:'SET_QUEST_COMPLETED',id:action.id,date:today});
  assert.equal(validateCoachActions(content([action]),{date:today,context:buildCoachActionContext(completed,today)}).error.code,'quest_update_unavailable');
  const context=buildCoachActionContext(state,today);
  assert.equal(validateCoachActions(content([action,{type:'complete_quest',ref:'complete',id:action.id,date:today}]),{date:today,context}).error.code,'duplicate_action');
  const future=editQuest(state,{scheduledDate:'2099-01-01'});
  const next=saveApply(state,[future]);
  const complete={type:'complete_quest',ref:'complete',id:action.id,date:today};
  assert.equal(validateCoachActions(content([complete]),{date:today,context:buildCoachActionContext(next,today)}).error.code,'quest_not_due');
});

test('memory, journal and expense edits stale a pending batch; malformed memory backup cannot silently drop facts',()=>{
  let state=reducer(createInitialState(),{type:'UPSERT_COACH_MEMORY',memory:{id:'fact',text:'Читаю вранці.',category:'growth'}});
  const pending=proposal(state,[expense()]);
  for(const operation of [
    {type:'UPSERT_COACH_MEMORY',memory:{id:'fact',text:'Читаю ввечері.',category:'growth'}},
    {type:'SET_CHECKIN',date:today,checkIn:{mood:2,energy:2,note:'Втома'}},
    {type:'ADD_EXPENSE',expense:{title:'Кава',amount:50,date:today}}
  ]) assert.equal(checkCoachProposal(reducer(state,operation),pending,{today}).error.code,'stale_proposal');
  for(const corrupt of [s=>s.coachMemory.push({...s.coachMemory[0]}),s=>s.coachMemory[0].text='password: abc',s=>s.coachMemory[0].updatedAt='2199-01-01',s=>s.profile.coachMemoryConsent='true',s=>s.profile.coachJournalConsent=1]) { const bad=structuredClone(state);corrupt(bad);assert.throws(()=>validateBackup(JSON.stringify(bad))); }
  const old=structuredClone(state);delete old.coachMemory;delete old.profile.coachMemoryConsent;delete old.profile.coachJournalConsent;old.schemaRevision=4;
  const restored=validateBackup(JSON.stringify(old));assert.equal(restored.schemaRevision,5);assert.deepEqual(restored.coachMemory,[]);assert.equal(restored.profile.coachMemoryConsent,false);
  assert.equal(restoreState(state).coachMemory[0].text,state.coachMemory[0].text);
});

test('check-in is explicit today-only data, cannot occur twice in one batch or invent numeric scores',()=>{
  for(const action of [checkin({mood:0}),checkin({energy:'low'}),checkin({date:'2000-01-01'}),checkin({note:'x'.repeat(501)})]) assert.equal(validateCoachActions(content([action]),{date:today}).ok,false);
  assert.equal(validateCoachActions(content([checkin(),checkin({ref:'again'})]),{date:today}).error.code,'duplicate_checkin');
  const first=saveApply(createInitialState(),[checkin()]);
  const second=saveApply(first,[checkin({mood:4,note:'Уточнено'})],'second');
  assert.deepEqual(second.checkIns[today],{mood:4,energy:2,note:'Уточнено'});
});

test('API output validator rejects unauthorized memory edits and accepts explicit expense without financial history',()=>{
  const data=validateActionRequest({date:today},{messages:[],tone:'supportive'},fail);
  assert.equal(parseActionResponse(JSON.stringify(content([expense()])),data,fail).actions[0].amount,180);
  assert.throws(()=>parseActionResponse(JSON.stringify(content([{type:'delete_memory',ref:'delete',id:'fact'}])),data,fail),{code:'invalid_actions'});
});

test('coach transport requests fresh auth token per call and cancellation during token load prevents fetch',async()=>{
  let token=0;const headers=[];
  const runtime={isNative:false,fetch:async(url,options)=>{headers.push(options.headers);return {status:200,json:async()=>({provider:'openai',configured:true,model:'test'})};}};
  const client=createCoachClient(runtime,{accessTokenSource:async()=>`test-token-${++token}`});
  await client.status();await client.status();
  assert.equal(headers[0].Authorization,'Bearer test-token-1');assert.equal(headers[1].Authorization,'Bearer test-token-2');
  let release;const controller=new AbortController();
  const slow=createCoachClient(runtime,{accessTokenSource:()=>new Promise(resolve=>{release=resolve;})});
  const request=slow.status({signal:controller.signal});
  while(!release) await new Promise(resolve=>setTimeout(resolve,0));
  controller.abort();release('late-token');
  await assert.rejects(request,{name:'AbortError'});assert.equal(headers.length,2);
});
