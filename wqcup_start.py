#!/usr/bin/env python3
from __future__ import annotations
import os, shutil, subprocess, sys
from pathlib import Path

ROOT=Path(__file__).resolve().parent
WQ=ROOT/'.wq'; LOGS=WQ/'logs'; PIDFILE=WQ/'poller.pid'
PROFILE=ROOT/'.omp/profiles/wqcup-unlimited.yml'

def alive(pid:int)->bool:
    try: os.kill(pid,0); return True
    except Exception: return False

def start_poller():
    LOGS.mkdir(parents=True,exist_ok=True)
    if PIDFILE.exists():
        try:
            pid=int(PIDFILE.read_text().strip())
            if alive(pid):
                print(f'[WQCup] poller 已运行 pid={pid}')
                return
        except Exception: pass
    log=(LOGS/'poller.log').open('ab',buffering=0)
    kw=dict(cwd=str(ROOT),stdin=subprocess.DEVNULL,stdout=log,stderr=subprocess.STDOUT,close_fds=True)
    if os.name=='nt':
        kw['creationflags']=getattr(subprocess,'CREATE_NEW_PROCESS_GROUP',0)|getattr(subprocess,'CREATE_NO_WINDOW',0)
    else:
        kw['start_new_session']=True
    p=subprocess.Popen([sys.executable,str(ROOT/'tools/wqctl.py'),'watch'],**kw)
    PIDFILE.write_text(str(p.pid))
    print(f'[WQCup] poller started pid={p.pid}; log={LOGS/"poller.log"}')

def main()->int:
    os.chdir(ROOT)
    start_poller()
    omp=shutil.which('omp')
    if not omp:
        print('[x] 当前 shell 找不到 omp，请先把 OMP 加入 PATH')
        return 2
    print('进入 OMP 后发送：')
    print('用 task 启动 wqcup。接管当前比赛；保持主线并发解题，同时启用一个 ChatGPT Browser Expert 槽位，first verified candidate wins。')
    return subprocess.call([omp,'--config',str(PROFILE)],cwd=str(ROOT))

if __name__=='__main__':
    raise SystemExit(main())
