import assert from 'node:assert/strict';
import test from 'node:test';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { stripVTControlCharacters } from 'node:util';
import { repository, fixtureGit, snapshot } from './helpers.js';
import { readComparison, readComparisonDetail, readComparisonPatch } from '../src/core/comparison.js';
import { renderPatch } from '../src/terminal/patch.js';
import { createStyle } from '../src/terminal/style.js';
import { comparisonSession } from '../src/terminal/comparison.js';
import { listLocalBranches } from '../src/core/branches.js';
import { readSnapshotPatch } from '../src/core/changes.js';
import { parseDiff } from '../src/git/diff.js';
import { runGit } from '../src/git/run.js';

test('patches preserve selected rename identity, exact paths and snapshot semantics without mutations', async t => {
  const root = await repository(t);
  await writeFile(path.join(root, 'tracked.txt'), 'one\ntwo\nthree\nfour\nfive\n');
  fixtureGit(root,'add','.'); fixtureGit(root,'commit','-m','Base');
  fixtureGit(root,'branch','base');
  fixtureGit(root,'mv','tracked.txt','renamed.txt');
  await writeFile(path.join(root,'renamed.txt'),'one\ntwo\nchanged\nfour\nfive\n');
  await writeFile(path.join(root,'[literal].txt'),'new\x1b[2J');
  await writeFile(path.join(root,'binary'),Buffer.from([0,1,2]));
  fixtureGit(root,'add','.'); fixtureGit(root,'commit','-m','Changes');
  fixtureGit(root,'config','diff.external','must-not-execute');
  fixtureGit(root,'config','diff.wordDiff','plain');
  const before = await snapshot(root);
  const c = await readComparison(root,'base','topic');
  const patch = await readComparisonPatch(c,'tips',Buffer.from('renamed.txt'));
  assert.equal(patch.file.status,'R'); assert.equal(patch.kind,'text');
  assert(patch.lines.includes('-three')); assert(patch.lines.includes('+changed'));
  const added = await readComparisonPatch(c,'since-base',Buffer.from('[literal].txt'));
  assert(added.lines.some(line=>line.startsWith('+new')));
  assert(added.lines.includes('\\ No newline at end of file'));
  const output = renderPatch(c,'since-base',added);
  assert(!output.includes('\x1b')); assert(output.includes('\\u001b'));
  assert.equal(stripVTControlCharacters(renderPatch(c,'since-base',added,createStyle(true))),output);
  assert.equal((await readComparisonPatch(c,'tips',Buffer.from('binary'))).kind,'binary');
  await assert.rejects(readComparisonPatch(c,'tips',Buffer.from('literal.txt')),/exact/);
  assert.deepEqual(await snapshot(root),before);
  fixtureGit(root,'branch','-f','base','topic');
  await assert.rejects(readComparisonPatch(c,'tips',Buffer.from('renamed.txt')),/moved/);
});

test('interactive file and patch pages preserve selection, refresh and cancellation', async t => {
  const root=await repository(t); fixtureGit(root,'branch','base');
  for(let i=0;i<51;i++) await writeFile(path.join(root,`p${String(i).padStart(2,'0')}`),'line\n'.repeat(100));
  fixtureGit(root,'add','.'); fixtureGit(root,'commit','-m','Files');
  const selected=Buffer.from('p50').toString('hex');
  const answers=['refs/heads/base','tips','file','next',selected,'next','previous','back',selected,'refresh','back'];
  let captures=0; let output=''; let selections=0;
  const unexpected=async()=>{throw new Error('Unexpected operation');};
  const operations={prs:unexpected,overview:unexpected,history:unexpected,branch:unexpected,branches:()=>listLocalBranches(root),
    compare:async(a:string,b:string)=>{captures++;return readComparison(root,a,b);},
    comparisonDetail:readComparisonDetail,comparisonPatch:readComparisonPatch};
  await comparisonSession({write:text=>{output+=text;},choose:async(message,choices,defaultValue)=>{
    const answer=answers.shift()!; assert(choices.some(c=>c.value===answer),`${message}: ${answer}`);
    if(answer===selected && selections++>0) assert.equal(defaultValue,selected);
    return answer;
  }},operations,'topic');
  assert.equal(answers.length,0); assert.equal(captures,2); assert.match(output,/Patch lines 81/);
  const cancelAnswers=['refs/heads/base','tips','file'];
  await assert.rejects(comparisonSession({write:()=>{},choose:async(message)=>{
    if(message==='Changed files') throw Object.assign(new Error('Cancelled'),{name:'ExitPromptError'});
    return cancelAnswers.shift()!;
  }},operations,'topic'),/Cancelled/);
});

test('deleted, mode-only, large and paged changes have explicit results', async t => {
  const root=await repository(t); fixtureGit(root,'branch','base');
  fixtureGit(root,'rm','tracked.txt');
  for(let i=0;i<51;i++) await writeFile(path.join(root,`file${String(i).padStart(2,'0')}`), 'line\n'.repeat(100));
  await writeFile(path.join(root,'large'),'x'.repeat(1024*1024+1));
  fixtureGit(root,'add','.'); fixtureGit(root,'commit','-m','Changes');
  const c=await readComparison(root,'base','topic');
  const d=await readComparisonDetail(c,'tips');
  assert(d.kind==='files'); assert.equal(d.allFiles?.length,53);
  const deleted=await readComparisonPatch(c,'tips',Buffer.from('tracked.txt'));
  assert(deleted.lines.includes('-initial'));
  const patch=await readComparisonPatch(c,'tips',Buffer.from('file50'));
  assert.match(renderPatch(c,'tips',patch,undefined,0),/Patch lines 1–80/);
  assert.match(renderPatch(c,'tips',patch,undefined,1),/Patch lines 81–/);
  await assert.rejects(readComparisonPatch(c,'tips',Buffer.from('large')),/1 MiB/);
  fixtureGit(root,'branch','mode-base'); fixtureGit(root,'update-index','--chmod=+x','file00'); fixtureGit(root,'commit','-m','Mode');
  const mode=await readComparisonPatch(await readComparison(root,'mode-base','topic'),'tips',Buffer.from('file00'));
  assert.equal(mode.kind,'metadata'); assert.equal(mode.file.afterMode,'100755');
});

test('patch endpoints stay distinct; symlinks, pointers, guards and failed queries stay read-only', async t => {
  const root=await repository(t); fixtureGit(root,'branch','base');
  await writeFile(path.join(root,'tracked.txt'),'topic content\n');
  fixtureGit(root,'add','.'); fixtureGit(root,'commit','-m','Topic');
  fixtureGit(root,'checkout','base');
  await writeFile(path.join(root,'tracked.txt'),'reference content\n');
  fixtureGit(root,'add','.'); fixtureGit(root,'commit','-m','Reference');
  const c=await readComparison(root,'base','topic');
  assert((await readComparisonPatch(c,'tips',Buffer.from('tracked.txt'))).lines.includes('-reference content'));
  assert((await readComparisonPatch(c,'since-base',Buffer.from('tracked.txt'))).lines.includes('-initial'));
  const oid=fixtureGit(root,'rev-parse','HEAD:tracked.txt');
  fixtureGit(root,'update-index','--add','--cacheinfo',`120000,${oid},link`);
  fixtureGit(root,'update-index','--add','--cacheinfo',`160000,${c.a.oid},module`);
  fixtureGit(root,'commit','-m','Special entries');
  const special=await readComparison(root,'topic','base');
  assert.equal((await readComparisonPatch(special,'tips',Buffer.from('link'))).file.afterMode,'120000');
  assert.equal((await readComparisonPatch(special,'tips',Buffer.from('module'))).kind,'metadata');
  await writeFile(path.join(root,'.git','index'),'broken index');
  await writeFile(path.join(root,'.gitattributes'),'* diff=hostile\n');
  fixtureGit(root,'config','diff.hostile.command','must-not-execute');
  fixtureGit(root,'config','diff.hostile.textconv','must-not-execute');
  const before=await snapshot(root);
  assert.equal((await readComparisonPatch(special,'tips',Buffer.from('tracked.txt'))).kind,'text');
  assert.equal((await readComparisonPatch(special,'tips',Buffer.from('link'))).kind,'text');
  assert.deepEqual(await snapshot(root),before);
  await assert.rejects(readComparisonPatch(special,'tips',Buffer.from('tracked.txt'),undefined,async(cwd,args,signal)=>{
    if(args.includes('--patch')) throw new Error('Patch timed out');
    return runGit(cwd,args,signal);
  }),/timed out/);
  const abort=new AbortController(); abort.abort();
  await assert.rejects(readComparisonPatch(special,'tips',Buffer.from('tracked.txt'),abort.signal),/cancelled/);
  fixtureGit(root,'config','remote.origin.promisor','true');
  await assert.rejects(readComparisonPatch(special,'tips',Buffer.from('tracked.txt')),/Partial-clone/);
});

test('unrepresentable paths and non-UTF8 patch content are explicit, not silently replaced', async () => {
  const file=parseDiff(Buffer.concat([Buffer.from(':000000 100644 000 abc A\0'),Buffer.from([255,0])]))[0]!;
  await assert.rejects(readSnapshotPatch('/unused','abc','def',file),/not valid UTF-8/);
  const modified={...file,status:'M' as const,beforeOid:'def',beforeMode:'100644'};
  await assert.rejects(readSnapshotPatch('/unused','abc','def',modified,undefined,async()=>({code:0,stdout:Buffer.from([255]),stderr:''})),/not valid UTF-8/);
});
