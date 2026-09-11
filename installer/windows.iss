#ifndef WinBinary
  #error WinBinary must point to omp-wanwandequ-windows-x64.exe
#endif

[Setup]
AppId={{2A486CF7-4B87-4C4A-8F62-9E0ED6B2F7A1}
AppName=OMP-Wanwandequ
AppVersion=wq-dev
AppPublisher=YHalo-wyh
AppPublisherURL=https://github.com/YHalo-wyh/omp-wanwandequ
DefaultDirName={localappdata}\Programs\OMP-Wanwandequ
DisableProgramGroupPage=yes
PrivilegesRequired=lowest
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
OutputDir=dist
OutputBaseFilename=OMP-Wanwandequ-Setup-Windows-x64
Compression=lzma2/ultra64
SolidCompression=yes
WizardStyle=modern
UninstallDisplayName=OMP-Wanwandequ

[Tasks]
Name: "desktopicon"; Description: "Create a desktop shortcut"; GroupDescription: "Shortcuts:"; Flags: unchecked

[Files]
Source: "{#WinBinary}"; DestDir: "{app}"; DestName: "omp-wanwandequ.exe"; Flags: ignoreversion

[Icons]
Name: "{autoprograms}\OMP-Wanwandequ"; Filename: "{app}\omp-wanwandequ.exe"; WorkingDir: "{userdocs}"
Name: "{autodesktop}\OMP-Wanwandequ"; Filename: "{app}\omp-wanwandequ.exe"; WorkingDir: "{userdocs}"; Tasks: desktopicon

[Registry]
Root: HKCU; Subkey: "Environment"; ValueType: expandsz; ValueName: "Path"; ValueData: "{olddata};{app}"; Check: NeedsAddPath(ExpandConstant('{app}')); Flags: preservestringtype

[Run]
Filename: "{app}\omp-wanwandequ.exe"; Parameters: "doctor"; Description: "Run Wanwandequ doctor"; Flags: postinstall nowait skipifsilent unchecked

[Code]
function NeedsAddPath(Param: string): Boolean;
var
  OrigPath: string;
begin
  if not RegQueryStringValue(HKCU, 'Environment', 'Path', OrigPath) then
    OrigPath := '';
  Result := Pos(';' + Uppercase(Param) + ';', ';' + Uppercase(OrigPath) + ';') = 0;
end;
