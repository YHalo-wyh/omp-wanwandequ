#!/usr/bin/env python3
from __future__ import annotations
import json, os, shutil, subprocess, sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent

def is_wsl() -> bool:
    if os.name == "nt": return False
    if os.environ.get("WSL_DISTRO_NAME"): return True
    try:
        t=Path('/proc/sys/kernel/osrelease').read_text(encoding='utf-8',errors='ignore').lower()
        return 'microsoft' in t or 'wsl' in t
    except Exception:
        return False

def mcp_server() -> dict:
    common = ['-y','chrome-devtools-mcp@latest','--autoConnect','--channel','stable','--no-usage-statistics']
    if is_wsl():
        return {
            'type':'stdio',
            'command':'cmd.exe',
            'args':['/d','/s','/c','npx -y chrome-devtools-mcp@latest --autoConnect --channel stable --no-usage-statistics']
        }
    if os.name == 'nt':
        return {'type':'stdio','command':'npx.cmd','args':common}
    return {'type':'stdio','command':'npx','args':common}

def main() -> int:
    env = ROOT/'.env'
    if not env.exists():
        shutil.copy2(ROOT/'.env.example', env)
        try: os.chmod(env,0o600)
        except Exception: pass
        print('[+] 已创建 .env，请填 WQCUP_TEAM_TOKEN')
    else:
        print('[=] 保留现有 .env')

    mcp = {
        '$schema':'https://raw.githubusercontent.com/can1357/oh-my-pi/main/packages/coding-agent/src/config/mcp-schema.json',
        'mcpServers': {'chrome-devtools': mcp_server()},
    }
    (ROOT/'.omp/mcp.json').write_text(json.dumps(mcp,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    print('[+] 已按当前系统生成 .omp/mcp.json')

    try:
        subprocess.check_call([sys.executable, str(ROOT/'tools/install_ctf_skills.py')], cwd=ROOT)
    except Exception as e:
        print(f'[!] CTF Skills 更新失败，不影响 WQCup core：{e}')

    print('\n完成。下一步：')
    print('1) 编辑 .env，填写比赛 token')
    print('2) Windows Chrome 登录 chatgpt.com')
    print('3) Chrome 打开 chrome://inspect/#remote-debugging 并启用 Remote Debugging')
    print('4) 检查 Windows/本机 npx --version')
    print('5) 运行 python3 wqcup_start.py（Windows 可用 py wqcup_start.py）')
    return 0

if __name__=='__main__':
    raise SystemExit(main())
