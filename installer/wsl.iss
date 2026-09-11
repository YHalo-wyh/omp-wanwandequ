#ifndef LinuxBinary
  #error LinuxBinary must point to omp-wanwandequ-linux-x64
#endif
#ifndef WslBridge
  #error WslBridge must point to install-wsl.ps1
#endif

[Setup]
AppId={{73D28166-0951-4828-9B0D-55C2CF754825}
AppName=OMP-Wanwandequ for WSL
AppVersion=wq-dev
AppPublisher=YHalo-wyh
AppPublisherURL=https://github.com/YHalo-wyh/omp-wanwandequ
DefaultDirName={localappdata}\Programs\OMP-Wanwandequ-WSL
DisableProgramGroupPage=yes
PrivilegesRequired=lowest
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
OutputDir=dist
OutputBaseFilename=OMP-Wanwandequ-Setup-WSL-x64
Compression=lzma2/ultra64
SolidCompression=yes
WizardStyle=modern
UninstallDisplayName=OMP-Wanwandequ for WSL

[Tasks]
Name: "desktopicon"; Description: "Create a desktop shortcut to Wanwandequ in WSL"; GroupDescription: "Shortcuts:"; Flags: unchecked

[Files]
Source: "{#LinuxBinary}"; DestDir: "{app}"; DestName: "omp-wanwandequ-linux-x64"; Flags: ignoreversion
Source: "{#WslBridge}"; DestDir: "{app}"; DestName: "install-wsl.ps1"; Flags: ignoreversion

[Icons]
Name: "{autoprograms}\OMP-Wanwandequ (WSL)"; Filename: "{sys}\wsl.exe"; Parameters: "-- bash -lc ""source ~/.bashrc >/dev/null 2>&1 || true; exec ~/.local/bin/omp-wanwandequ"""; WorkingDir: "{userdocs}"
Name: "{autodesktop}\OMP-Wanwandequ (WSL)"; Filename: "{sys}\wsl.exe"; Parameters: "-- bash -lc ""source ~/.bashrc >/dev/null 2>&1 || true; exec ~/.local/bin/omp-wanwandequ"""; WorkingDir: "{userdocs}"; Tasks: desktopicon

[Run]
Filename: "{sys}\WindowsPowerShell\v1.0\powershell.exe"; Parameters: "-NoProfile -ExecutionPolicy Bypass -File ""{app}\install-wsl.ps1"" -Binary ""{app}\omp-wanwandequ-linux-x64"""; StatusMsg: "Installing Wanwandequ into the default WSL distribution..."; Flags: waituntilterminated
