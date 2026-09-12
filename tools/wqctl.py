#!/usr/bin/env python3
from __future__ import annotations
import argparse, hashlib, json, os, re, shutil, subprocess, sys, time, urllib.parse, urllib.request
from datetime import datetime, timezone
from pathlib import Path

BASE="https://apiterminator.ichunqiu.com"
QUERY="/04cb510e425bd8f64fa97ba66f3935e1"
RESET="/deed3dba39e57b7cf95ea63ddd84e0c8"
SUBMIT="/ff874ef3172cbf4fd6ec2c5653a568e2"
ROOT=Path.cwd(); WQ=ROOT/'.wq'; BOARD=WQ/'board.json'; EVENTS=WQ/'events.jsonl'; CH=WQ/'challenges'; SUBS=WQ/'submissions.json'; LOCK=WQ/'submit.lock'

def now(): return datetime.now(timezone.utc).isoformat()
def envfile():
    p=ROOT/'.env'
    if not p.exists(): return
    for raw in p.read_text(encoding='utf-8',errors='ignore').splitlines():
        s=raw.strip()
        if not s or s.startswith('#') or '=' not in s: continue
        k,v=s.split('=',1); os.environ.setdefault(k.strip(),v.strip().strip('"').strip("'"))
envfile()
def ensure(): WQ.mkdir(exist_ok=True); CH.mkdir(exist_ok=True)
def cint(n,d):
    try:return max(1,int(os.environ.get(n,str(d))))
    except:return d
def cfg(): return {'base_url':os.environ.get('WQCUP_BASE_URL',BASE).rstrip('/'),'poll_interval':cint('WQCUP_POLL_INTERVAL',5),'max_challenges':cint('WQCUP_MAX_CHALLENGES',6),'max_solvers_per_challenge':cint('WQCUP_MAX_SOLVERS_PER_CHALLENGE',3),'browser_expert_max_concurrency':cint('WQCUP_BROWSER_EXPERT_MAX_CONCURRENCY',1)}
def token():
    t=os.environ.get('WQCUP_TEAM_TOKEN') or os.environ.get('WQ_TEAM_TOKEN')
    if not t: raise SystemExit('Missing WQCUP_TEAM_TOKEN in .env')
    return t
def event(kind,**kw):
    ensure()
    with EVENTS.open('a',encoding='utf-8') as f:f.write(json.dumps({'ts':now(),'kind':kind,**kw},ensure_ascii=False)+'\n')
def req(path,**params):
    params['token']=token(); url=cfg()['base_url']+path+'?'+urllib.parse.urlencode(params)
    r=urllib.request.Request(url,headers={'User-Agent':'wqcup/3','Accept':'application/json'})
    with urllib.request.urlopen(r,timeout=30) as x:return json.loads(x.read().decode())
def loadboard():
    if not BOARD.exists(): return {'updated_at':None,'challenges':{}}
    return json.loads(BOARD.read_text(encoding='utf-8'))
def atomic(p,obj):
    t=p.with_suffix(p.suffix+'.tmp'); t.write_text(json.dumps(obj,ensure_ascii=False,indent=2),encoding='utf-8'); t.replace(p)
def state(q):return f"# {q.get('title','')}\n\nquestion_id: {q.get('question_id','')}\ncategory: {q.get('category','')}\n\n## CONFIRMED FACTS\n\n## HYPOTHESES\n\n## REJECTED\n\n## ARTIFACTS\n\n## BOTTLENECK\n\n## NEXT\n"
def sync(silent=False):
    ensure(); old=loadboard().get('challenges',{}); r=req(QUERY)
    if r.get('code')!=0: raise RuntimeError(r)
    items=r.get('data')
    if not isinstance(items,list): raise RuntimeError(r)
    out={}; changes=[]
    for q in items:
        if not isinstance(q,dict): continue
        qid=str(q.get('question_id','')).strip()
        if not qid: continue
        out[qid]=q; d=CH/qid; (d/'attachments').mkdir(parents=True,exist_ok=True); (d/'runs').mkdir(exist_ok=True); (d/'browser-runs').mkdir(exist_ok=True)
        atomic(d/'challenge.json',q)
        if not (d/'STATE.md').exists():(d/'STATE.md').write_text(state(q),encoding='utf-8')
        b=old.get(qid)
        if b is None: changes.append(f'NEW {qid}')
        elif bool(b.get('is_solved'))!=bool(q.get('is_solved')): changes.append(f'SOLVED_CHANGE {qid}')
    board={'updated_at':now(),'challenges':out}; atomic(BOARD,board)
    for x in changes:event('sync_change',message=x)
    if not silent: print(f"[+] synced {len(out)} challenges; unsolved={sum(not q.get('is_solved') for q in out.values())}")
    return board
def getq(qid,refresh=False):
    if refresh or not BOARD.exists(): sync(True)
    q=loadboard().get('challenges',{}).get(qid)
    if not q: raise SystemExit(f'Unknown question_id: {qid}')
    return q
def safe(s):return re.sub(r'[^A-Za-z0-9_.-]+','-',s).strip('-') or 'lane'
def listcmd(a):
    b=sync(True) if a.sync else loadboard(); rows=[]
    for qid,q in b.get('challenges',{}).items():
        if a.unsolved and q.get('is_solved'):continue
        rows.append((float(q.get('solved_number') or 0)*1000+float(q.get('score') or 0),qid,q))
    for _,qid,q in sorted(rows,reverse=True): print(f"[{'✓' if q.get('is_solved') else ' '}] {qid} | {q.get('category','')} | {q.get('score','')} | {q.get('title','')}")
def showcmd(a):print(json.dumps(getq(a.question_id,a.sync),ensure_ascii=False,indent=2))
def resetcmd(a):
    q=getq(a.question_id,True)
    if str(q.get('interactive','')).lower()!='true': raise SystemExit('Refusing reset: interactive != true')
    r=req(RESET,question_id=a.question_id); print(json.dumps(r,ensure_ascii=False,indent=2)); event('reset',question_id=a.question_id,response=r); time.sleep(a.wait); sync(False)
def lock():
    ensure(); end=time.time()+12
    while True:
        try:LOCK.mkdir(); return
        except FileExistsError:
            if time.time()>end: raise RuntimeError('submit lock timeout')
            time.sleep(.15)
def unlock(): shutil.rmtree(LOCK,ignore_errors=True)
def submitcmd(a):
    lock()
    try:
        recs=json.loads(SUBS.read_text()) if SUBS.exists() else {}; key=hashlib.sha256((a.question_id+'\0'+a.answer).encode()).hexdigest()
        if key in recs: print(json.dumps({'dedup':True,'previous':recs[key]},ensure_ascii=False,indent=2)); return
        r=req(SUBMIT,question_id=a.question_id,answer=a.answer); recs[key]={'ts':now(),'question_id':a.question_id,'status':r.get('status'),'code':r.get('code'),'message':r.get('message'),'candidate_sha256':hashlib.sha256(a.answer.encode()).hexdigest()}; atomic(SUBS,recs)
        event('submit',question_id=a.question_id,status=r.get('status'),code=r.get('code'),message=r.get('message')); print(json.dumps(r,ensure_ascii=False,indent=2)); sync(False)
    finally: unlock()
def prep_run(a):
    q=getq(a.question_id); d=CH/a.question_id; stamp=datetime.now().strftime('%Y%m%d-%H%M%S'); run=d/'runs'/f'{stamp}-{safe(a.lane)}'; run.mkdir(parents=True)
    src=d/'attachments'; dst=run/'challenge_files'
    try: dst.symlink_to(src,target_is_directory=True)
    except: shutil.copytree(src,dst,dirs_exist_ok=True)
    (run/'TASK.md').write_text(f"# WQCup Solver Task\n\nquestion_id: {a.question_id}\ntitle: {q.get('title','')}\ncategory: {q.get('category','')}\nlane: {a.lane}\nrun_dir: {run.as_posix()}\nshared_state: {(d/'STATE.md').as_posix()}\nchallenge_json: {(d/'challenge.json').as_posix()}\n\nWork only inside run_dir for writes.\nWrite final handoff to RESULT.md.\n",encoding='utf-8'); print(run.as_posix())
def fetchcmd(a):
    q=getq(a.question_id,a.sync); url=str(q.get('file_url') or '').strip()
    if not url: raise SystemExit('Challenge has no file_url')
    d=CH/a.question_id/'attachments'; d.mkdir(parents=True,exist_ok=True); name=Path(urllib.parse.unquote(urllib.parse.urlparse(url).path)).name or 'attachment.bin'; dst=d/name
    with urllib.request.urlopen(urllib.request.Request(url,headers={'User-Agent':'wqcup/3'}),timeout=a.timeout) as r: dst.write_bytes(r.read())
    event('fetch',question_id=a.question_id,path=str(dst),size=dst.stat().st_size); print(dst.as_posix())
def iswsl(): return bool(os.environ.get('WSL_DISTRO_NAME')) or (Path('/proc/sys/kernel/osrelease').exists() and 'microsoft' in Path('/proc/sys/kernel/osrelease').read_text(errors='ignore').lower())
def hostpath(p):
    if os.name=='nt': return str(p)
    if iswsl():
        try:return subprocess.check_output(['wslpath','-w',str(p.resolve())],text=True).strip()
        except:pass
    return str(p.resolve())
def prep_browser(a):
    q=getq(a.question_id); d=CH/a.question_id; stamp=datetime.now().strftime('%Y%m%d-%H%M%S'); run=d/'browser-runs'/f'{stamp}-{safe(a.lane)}'; run.mkdir(parents=True)
    for n in ['challenge.json','STATE.md']:
        if (d/n).exists(): shutil.copy2(d/n,run/n)
    up=run/'upload'; up.mkdir(); srcs=[]; ups=[]
    if iswsl():
        try:
            wt=subprocess.check_output(['cmd.exe','/d','/s','/c','echo %TEMP%'],text=True).strip(); ul=Path(subprocess.check_output(['wslpath','-u',wt],text=True).strip())/'wqcup-browser'/a.question_id/run.name; ul.mkdir(parents=True,exist_ok=True); up=ul
        except: pass
    for src in sorted((d/'attachments').rglob('*')):
        if src.is_file():
            dst=up/src.name; shutil.copy2(src,dst); srcs.append(src.as_posix()); ups.append(hostpath(dst))
    for n in ['challenge.json','STATE.md']:
        src=run/n
        if src.exists(): dst=up/n; shutil.copy2(src,dst); srcs.append(src.as_posix()); ups.append(hostpath(dst))
    man={'question_id':a.question_id,'title':q.get('title',''),'category':q.get('category',''),'description':q.get('description',''),'browser_run_dir':run.as_posix(),'source_files':srcs,'upload_files':ups}
    atomic(run/'browser.json',man); (run/'TASK.md').write_text(f"# WQCup Browser Expert Task\n\nquestion_id: {a.question_id}\nbrowser_run_dir: {run.as_posix()}\nmanifest: {(run/'browser.json').as_posix()}\n\nUse chrome-devtools MCP only for chatgpt.com. Save latest answer to CHATGPT_RESPONSE.md and final handoff to RESULT.md.\n",encoding='utf-8'); print(run.as_posix())
def watch(a):
    interval=a.interval or cfg()['poll_interval']; back=interval; print(f'[*] polling every {interval}s; Ctrl-C to stop')
    while True:
        try: sync(False); back=interval; time.sleep(interval)
        except KeyboardInterrupt: return
        except Exception as e: event('watch_error',error=str(e)); print(f'[!] {e}; retry in {back}s',file=sys.stderr); time.sleep(back); back=min(30,back*2)
def configcmd(a): c=cfg(); c['team_token_present']=bool(os.environ.get('WQCUP_TEAM_TOKEN') or os.environ.get('WQ_TEAM_TOKEN')); print(json.dumps(c,ensure_ascii=False,indent=2))
def parser():
    p=argparse.ArgumentParser(description='WQCup deterministic control plane'); s=p.add_subparsers(dest='cmd',required=True)
    x=s.add_parser('sync'); x.set_defaults(func=lambda a:sync(False))
    x=s.add_parser('list'); x.add_argument('--unsolved',action='store_true'); x.add_argument('--sync',action='store_true'); x.set_defaults(func=listcmd)
    x=s.add_parser('show'); x.add_argument('question_id'); x.add_argument('--sync',action='store_true'); x.set_defaults(func=showcmd)
    x=s.add_parser('reset'); x.add_argument('question_id'); x.add_argument('--wait',type=int,default=2); x.set_defaults(func=resetcmd)
    x=s.add_parser('submit'); x.add_argument('question_id'); x.add_argument('answer'); x.set_defaults(func=submitcmd)
    x=s.add_parser('watch'); x.add_argument('--interval',type=int); x.set_defaults(func=watch)
    x=s.add_parser('prepare-run'); x.add_argument('question_id'); x.add_argument('--lane',default='baseline'); x.set_defaults(func=prep_run)
    x=s.add_parser('fetch'); x.add_argument('question_id'); x.add_argument('--sync',action='store_true'); x.add_argument('--timeout',type=int,default=60); x.set_defaults(func=fetchcmd)
    x=s.add_parser('prepare-browser'); x.add_argument('question_id'); x.add_argument('--lane',default='chatgpt'); x.set_defaults(func=prep_browser)
    x=s.add_parser('config'); x.set_defaults(func=configcmd)
    return p
def main(): ensure(); a=parser().parse_args(); a.func(a)
if __name__=='__main__': main()
