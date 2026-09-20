import assert from 'node:assert/strict';
import test from 'node:test';
import path from 'node:path';
import { writeFile, mkdir } from 'node:fs/promises';
import { configPath, loadCloudSetup } from '../src/config/user.js';
import { observePullRequests } from '../src/providers/bitbucket-cloud.js';
import type { HttpTransport } from '../src/providers/bitbucket-cloud.js';
import { checkPullRequests, prCheckSucceeded } from '../src/core/pr.js';
import { renderPrCheck, prSession } from '../src/terminal/pr.js';
import { createStyle } from '../src/terminal/style.js';
import { stripVTControlCharacters } from 'node:util';
import { repository, temp, fixtureGit, directoryAlias, snapshot } from './helpers.js';

const setup = { mapping: {workspace:'team',repository:'repo'}, email:'account@example.invalid', token:'private-token-value' };
const endpoint='https://api.bitbucket.org/2.0/repositories/team/repo/pullrequests';
const side=(branch:string,repository='team/repo')=>({branch:{name:branch},repository:{full_name:repository},commit:{hash:'a'.repeat(40)}});
const pr=(id=1)=>({id,title:'Example',state:'OPEN',links:{html:{href:`https://bitbucket.org/team/repo/pull-requests/${id}`}},source:side('topic'),destination:side('main')});
const response=(values:unknown[],next?:string)=>new Response(JSON.stringify({values,...(next?{next}:{})}));

test('user configuration is explicit, canonical, bounded and secret-safe',async t=>{
  const root=await repository(t); const alias=await directoryAlias(t,root);
  const config=path.join(await temp(t),'config.json');
  const env={TWIGLET_CONFIG:config,EMAIL:setup.email,TOKEN:setup.token};
  const mapping={path:alias,bitbucketCloud:setup.mapping};
  const data={version:1,bitbucketCloud:{emailEnv:'EMAIL',tokenEnv:'TOKEN'},repositories:[mapping]};
  assert.equal(await loadCloudSetup(root,env),undefined);
  await writeFile(config,JSON.stringify(data));
  assert.deepEqual(await loadCloudSetup(root,env),setup);
  await assert.rejects(loadCloudSetup(root,{TWIGLET_CONFIG:config}),/Missing credentials/);
  await writeFile(config,JSON.stringify({...data,repositories:[mapping,{...mapping,path:root}]}));
  await assert.rejects(loadCloudSetup(root,env),/Duplicate/);
  await writeFile(config,JSON.stringify({...data,bitbucketCloud:{token:setup.token}}));
  await assert.rejects(loadCloudSetup(root,env),error=>!String(error).includes(setup.token)&&/documented fields/.test(String(error)));
  await writeFile(config,'{"token":"'+setup.token);
  await assert.rejects(loadCloudSetup(root,env),/not valid JSON/);
  await writeFile(config,'x'.repeat(256*1024+1));
  await assert.rejects(loadCloudSetup(root,env),/256 KiB/);
  assert.equal(configPath({TWIGLET_CONFIG:config}),config);
  assert.equal(configPath({APPDATA:'/data'},'win32','/home'),path.join('/data','Twiglet','config.json'));
  assert.equal(configPath({XDG_CONFIG_HOME:'/config'},'linux','/home'),path.join('/config','twiglet','config.json'));
  assert.equal(configPath({},'darwin','/home'),path.join('/home','.config','twiglet','config.json'));
});

test('Cloud matching uses exact branch and repository, all states and complete pagination',async()=>{
  let calls=0;
  const transport:HttpTransport=async(input,options)=>{
    const url=new URL(String(input)); calls++;
    assert.equal(options?.method,'GET'); assert.equal(options?.redirect,'error');
    assert.equal((options?.headers as Record<string,string>).Authorization,`Basic ${Buffer.from(`${setup.email}:${setup.token}`).toString('base64')}`);
    if(calls===1){
      assert.equal(url.searchParams.get('q'),'source.branch.name = "topic"');
      assert.deepEqual(url.searchParams.getAll('state'),['OPEN','MERGED','DECLINED','SUPERSEDED']);
      return response([pr(),{...pr(3),source:side('topic','fork/repo')},{...pr(4),source:side('other')}],endpoint+'?page=2');
    }
    return response([{...pr(2),state:'MERGED',destination:{...side('main'),commit:null}}]);
  };
  const result=await observePullRequests(setup,'topic',undefined,transport);
  assert.equal(calls,2); assert.equal(result.complete,true); assert.equal(result.prs.length,2);
  assert.equal(result.prs[1]?.destination.tip,null); assert(Number.isFinite(Date.parse(result.observedAt)));
  const branch='feature/"quoted"';
  await observePullRequests(setup,branch,undefined,async input=>{
    assert.equal(new URL(String(input)).searchParams.get('q'),`source.branch.name = ${JSON.stringify(branch)}`);
    return response([]);
  });
  const empty=await observePullRequests(setup,'topic',undefined,async()=>response([]));
  assert.equal(empty.complete,true); assert.equal(empty.prs.length,0);
  const view={kind:'observed' as const,root:'/repo',branch:'topic',headOid:'a'.repeat(40),repository:'team/repo',observation:empty};
  assert(prCheckSucceeded(view)); assert.match(renderPrCheck(view),/No matching PR/);
});

test('HTTP errors, malformed/oversized data and pagination never leak credentials',async()=>{
  for(const status of [401,403,404,429,500]) {
    await assert.rejects(observePullRequests(setup,'topic',undefined,async()=>new Response(setup.token,{status})),error=>!String(error).includes(setup.token));
  }
  await assert.rejects(observePullRequests(setup,'topic',undefined,async()=>{throw new Error(setup.token);}),/network request failed/);
  await assert.rejects(observePullRequests(setup,'topic',undefined,async()=>new Response(setup.token)),/invalid JSON/);
  await assert.rejects(observePullRequests(setup,'topic',undefined,async()=>new Response(new Uint8Array([255]))),/invalid JSON/);
  await assert.rejects(observePullRequests(setup,'topic',undefined,async()=>response([{...pr(),source:{...side('topic'),commit:{hash:'bad'}}}])),/commit ID/);
  await assert.rejects(observePullRequests(setup,'topic',undefined,async()=>new Response('x'.repeat(1024*1024+1))),/1 MiB/);
  for(const next of ['https://evil.invalid/steal',endpoint.replace('/pullrequests','/src'),endpoint+'#fragment']) {
    let calls=0;
    await assert.rejects(observePullRequests(setup,'topic',undefined,async()=>{calls++;return response([],next);}),/pagination/);
    assert.equal(calls,1);
  }
  let calls=0;
  const incomplete=await observePullRequests(setup,'topic',undefined,async()=>response([],endpoint+`?page=${++calls+1}`));
  assert.equal(calls,10); assert.equal(incomplete.complete,false);
  const unknown=await observePullRequests(setup,'topic',undefined,async()=>response([{...pr(),source:{...side('topic'),repository:null}}]));
  assert.equal(unknown.complete,false);
  let repeatedCalls=0;
  await assert.rejects(observePullRequests(setup,'topic',undefined,async()=>{repeatedCalls++;return response([],endpoint+'?page=2');}),/repeated pagination/);
  assert.equal(repeatedCalls,2);
  const reflected=await observePullRequests(setup,'topic',undefined,async()=>response([{...pr(),title:setup.token}]));
  assert(!JSON.stringify(reflected).includes(setup.token));
});

test('PR context preserves repository state, rejects stale association and never requests for missing setup or detached HEAD',async t=>{
  const root=await repository(t); const config=path.join(await temp(t),'config.json');
  const env={TWIGLET_CONFIG:config,EMAIL:setup.email,TOKEN:setup.token};
  const unexpected:HttpTransport=async()=>{throw new Error('Unexpected HTTP');};
  assert.equal((await checkPullRequests(root,undefined,env,unexpected)).kind,'not-configured');
  await writeFile(config,JSON.stringify({version:1,bitbucketCloud:{emailEnv:'EMAIL',tokenEnv:'TOKEN'},repositories:[{path:root,bitbucketCloud:setup.mapping}]}));
  const nested=path.join(root,'nested'); await mkdir(nested);
  const before=await snapshot(root);
  const result=await checkPullRequests(nested,undefined,env,async()=>response([pr()]));
  assert(prCheckSucceeded(result)); assert.deepEqual(await snapshot(root),before);
  assert.equal(stripVTControlCharacters(renderPrCheck(result,createStyle(true))),renderPrCheck(result));
  const changed=await checkPullRequests(root,undefined,env,async()=>{
    fixtureGit(root,'commit','--allow-empty','-m','Advance'); return response([pr()]);
  });
  assert.equal(changed.kind,'local-context');
  fixtureGit(root,'checkout','--detach');
  assert.equal((await checkPullRequests(root,undefined,env,unexpected)).kind,'local-context');
  const unborn=await repository(t,false);
  assert.equal((await checkPullRequests(unborn,undefined,env,unexpected)).kind,'local-context');
});

test('interactive PR selection reuses observations and Check again is explicit',async()=>{
  const observation=await observePullRequests(setup,'topic',undefined,async()=>response([pr(),pr(2)]));
  const result={kind:'observed' as const,root:'/repo',branch:'topic',headOid:'a'.repeat(40),repository:'team/repo',observation};
  const answers=['2','back','refresh','back']; let calls=0; let output='';
  await prSession({write:text=>{output+=text;},choose:async(message,choices)=>{
    const answer=answers.shift()!;assert(choices.some(c=>c.value===answer),message);return answer;
  }},async()=>{calls++;return result;});
  assert.equal(calls,2);assert.equal(answers.length,0);assert.match(output,/PR #2/);
  const abort=new AbortController();abort.abort();let sent=false;
  await assert.rejects(observePullRequests(setup,'topic',abort.signal,async()=>{sent=true;return response([]);}));
  assert.equal(sent,false);
  await assert.rejects(prSession({write:()=>{},choose:async()=>{throw Object.assign(new Error('Cancelled'),{name:'ExitPromptError'});}},async()=>result),/Cancelled/);
});
