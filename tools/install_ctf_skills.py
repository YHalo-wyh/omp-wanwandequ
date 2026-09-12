#!/usr/bin/env python3
from pathlib import Path
import shutil, subprocess, tempfile, sys

UPSTREAM = "https://github.com/ljagiello/ctf-skills.git"
SKILLS = [
    "ctf-pwn", "ctf-reverse", "ctf-web", "ctf-crypto", "ctf-forensics",
    "ctf-misc", "ctf-ai-ml", "ctf-malware", "ctf-osint",
]

def main() -> int:
    root = Path(__file__).resolve().parents[1]
    if not shutil.which("git"):
        print("[!] git 未安装，跳过 CTF Skills 更新")
        return 0
    dst_root = root / ".omp" / "skills"
    dst_root.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="wqcup-skills-") as td:
        repo = Path(td) / "repo"
        subprocess.check_call(["git", "clone", "--depth", "1", UPSTREAM, str(repo)])
        for name in SKILLS:
            src = repo / name
            dst = dst_root / name
            if not (src / "SKILL.md").exists():
                continue
            if dst.exists():
                shutil.rmtree(dst)
            shutil.copytree(src, dst)
            print(f"[+] {name}")
    return 0

if __name__ == "__main__":
    raise SystemExit(main())
