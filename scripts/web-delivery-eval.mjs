// Small paired evaluation. All expectations are fixed before any model run.
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { ModelRuntime, SessionManager, createAgentSessionServices, createAgentSessionFromServices } from '../lib/server/pi-sdk.js';
import { PILOOP_CONTEXT } from '../lib/server/tui.js';
import { webCheckExtension, checkWeb } from '../lib/server/web-check.js';

const click = selector => ({action:'click',selector});
const text = (selector,expected) => ({action:'text',selector,expected});
const fill = (selector,expected) => ({action:'fill',selector,expected});
const page = body => '<!doctype html><meta name="viewport" content="width=device-width"><meta charset="utf-8">'+body;
const tasks = [
 {id:'counter', prompt:'修好 index.html 的计数器。初始0，每次加一，15之后回到0；复位回到0，复位后还能继续加一。保留现有按钮和id，不增加功能。',
 html:page('<button id="inc">加一</button><button id="reset">复位</button><output id="count">0</output><script>let n=0;inc.onclick=()=>{document.getElementById("c"+"ounter").textContent=++n};reset.onclick=()=>{count.textContent=0}</script>'),
 checks:[text('#count','0'),...Array.from({length:17},()=>click('#inc')),text('#count','1'),click('#reset'),text('#count','0'),click('#inc'),text('#count','1')]},
 {id:'mux', prompt:'修好 index.html 的一位二选一交互演示：a、b、sel按钮每点一次切换0/1，sel=0输出a，sel=1输出b。任何输入变化都立即更新y。保留现有按钮和id。',
 html:page('<button id="a">0</button><button id="b">0</button><button id="sel">0</button><output id="y">0</output><script>const state={a:0,b:0,sel:0};function render(){document.getElementById("y").textContent=state.sel?state.a:state.b}for(const key of ["a","b","sel"]){document.getElementById(key).onclick=()=>{state[key]^=1;document.getElementById(key).textContent=state[key];if(key!=="sel")render()}}</script>'),
 checks:[text('#y','0'),click('#a'),text('#y','1'),click('#sel'),text('#y','0'),click('#b'),text('#y','1'),click('#a'),text('#y','1'),click('#sel'),text('#y','0'),click('#b'),text('#y','0')]},
 {id:'filter', prompt:'修好 index.html 的水果筛选：搜索不区分大小写并忽略首尾空格；搜索和“只看有货”一起生效；数量显示当前可见项数；没有匹配时显示“无结果”；清空搜索后恢复符合库存条件的列表。保留现有输入、按钮和id。',
 html:page('<input id="search" aria-label="搜索"><button id="stock">只看有货：关</button><output id="total">3</output><ul id="list"></ul><p id="empty" hidden>无结果</p><script>const items=[{name:"Apple",stock:true},{name:"Apricot",stock:false},{name:"Banana",stock:true}];let only=false;function render(){const q=search.value;const visible=items.filter(x=>x.name.includes(q)||only&&x.stock);list.innerHTML=visible.map(x=>`<li>${x.name}</li>`).join("");total.textContent=items.length}search.oninput=render;stock.onclick=()=>{only=!only;stock.textContent="只看有货："+(only?"开":"关");render()};render()</script>'),
 checks:[text('#total','3'),fill('#search',' AP '),text('#total','2'),click('#stock'),text('#total','1'),text('#list','Apple'),fill('#search','zzz'),text('#total','0'),{action:'visible',selector:'#empty'},fill('#search',''),text('#total','2'),click('#stock'),text('#total','3')]},
];
const root = path.resolve(process.argv[2] || `.piloop-eval-${Date.now()}`);
await fs.mkdir(root,{recursive:true});
const baseline = PILOOP_CONTEXT.split('\n').filter(line => !line.startsWith('For implementation and bug fixes,') && !line.startsWith('For local websites,')).join('\n');
const protocol={tasks,arms:['baseline','verification'],repeats:2,timeoutMs:150000,thinking:'low',maxToolCalls:24,baselineContext:baseline,verificationContext:PILOOP_CONTEXT};
const protocolText=JSON.stringify(protocol,null,2);
await fs.writeFile(path.join(root,'protocol.json'),protocolText,{flag:'wx'});
console.log('PROTOCOL',createHash('sha256').update(protocolText).digest('hex'));
const userDir=path.join(os.homedir(),'.piloop','agent');
const settings=JSON.parse(await fs.readFile(path.join(userDir,'settings.json'),'utf8'));
const runtime=await ModelRuntime.create({authPath:path.join(userDir,'auth.json'),modelsPath:path.join(userDir,'models.json'),allowModelNetwork:false});
const results=[];
for(let repeat=0;repeat<2;repeat++) for(const task of tasks) {
  for(const arm of repeat%2?['verification','baseline']:['baseline','verification']) {
    const id=`${task.id}-${repeat}-${arm}`;
    const cwd=path.join(root,id,'site'), agentDir=path.join(root,id,'agent');
    await fs.mkdir(cwd,{recursive:true}); await fs.mkdir(agentDir,{recursive:true});
    await fs.writeFile(path.join(cwd,'index.html'),task.html);
    await fs.writeFile(path.join(agentDir,'settings.json'),JSON.stringify({defaultProvider:settings.defaultProvider,defaultModel:settings.defaultModel,defaultThinkingLevel:'low'}));
    const services=await createAgentSessionServices({cwd,agentDir,modelRuntime:runtime,resourceLoaderOptions:{noExtensions:true,noSkills:true,noPromptTemplates:true,appendSystemPrompt:[arm==='baseline'?baseline:PILOOP_CONTEXT],extensionFactories:[{name:'web-check',factory:webCheckExtension,hidden:true}]}});
    const {session}=await createAgentSessionFromServices({services,sessionManager:SessionManager.create(cwd,path.join(agentDir,'sessions'))});
    const trace=[]; let timedOut=false; let toolCount=0; const started=Date.now();
    session.subscribe(event=>{if(event.type==='tool_execution_start'){trace.push({tool:event.toolName,args:event.args});if(++toolCount>24){timedOut=true;void session.abort();}}});
    const timer=setTimeout(()=>{timedOut=true;void session.abort();},150000);
    let error=null;
    try {await session.prompt(task.prompt);} catch(e){error=String(e);} finally{clearTimeout(timer);session.dispose();}
    const durationMs=Date.now()-started;
    let assessment;
    try {assessment=await checkWeb({url:pathToFileURL(path.join(cwd,'index.html')).href,steps:task.checks},cwd);}catch(e){assessment={status:'unverified',error:String(e)};}
    const result={id,task:task.id,repeat,arm,model:settings.defaultModel,timedOut,error,durationMs,toolCount,browserCalls:trace.filter(t=>t.tool==='verify_web_page').length,success:!timedOut&&!error&&assessment.status==='passed',assessment,trace};
    results.push(result);await fs.writeFile(path.join(root,'results.json'),JSON.stringify(results,null,2));
    console.log(JSON.stringify({id,success:result.success,browserCalls:result.browserCalls,durationMs,error}));
  }
}
for(const arm of ['baseline','verification']){const rows=results.filter(r=>r.arm===arm);console.log('SUMMARY',arm,rows.filter(r=>r.success).length+'/'+rows.length,'browser',rows.filter(r=>r.browserCalls).length+'/'+rows.length);}
