#define AppTitle "Mesa do Mestre"
#define AppVersion "1.7.0"
#ifndef PayloadDir
  #define PayloadDir "..\MesaDoMestreIntegrado"
#endif
#ifndef InstallerOutput
  #define InstallerOutput ".."
#endif

[Setup]
AppId={{BA8BDE10-C196-43F4-89B1-A61982DCB62F}
AppName={#AppTitle}
AppVersion={#AppVersion}
AppVerName={#AppTitle} - integrado
AppPublisher=Mesa do Mestre - projeto independente
DefaultDirName={localappdata}\Programs\MesaDoMestre
DefaultGroupName={#AppTitle}
DisableProgramGroupPage=yes
PrivilegesRequired=lowest
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
MinVersion=10.0
OutputDir={#InstallerOutput}
OutputBaseFilename=MesaDoMestre-1.7.0-Instalar-Windows-x64
SetupIconFile=src\assets\setup.ico
UninstallDisplayIcon={app}\mesa.ico
LicenseFile=LICENSE
Compression=lzma2
SolidCompression=yes
WizardStyle=modern
CloseApplications=no
RestartApplications=no
Uninstallable=not IsTestMode
CreateUninstallRegKey=not IsTestMode
UsePreviousAppDir=no
UsePreviousTasks=no

[Languages]
Name: "brazilianportuguese"; MessagesFile: "compiler:Languages\BrazilianPortuguese.isl"

[Tasks]
Name: "desktopicon"; Description: "Criar um atalho na área de trabalho"; GroupDescription: "Atalhos:"

[Files]
Source: "{#PayloadDir}\*"; DestDir: "{app}"; Excludes: "*.log,Squirrel.exe,*.sqlite*,desktop-url.txt,instance.json,instance.lock"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "src\assets\setup.ico"; DestDir: "{app}"; DestName: "mesa.ico"; Flags: ignoreversion

[Icons]
Name: "{userprograms}\{#AppTitle}"; Filename: "{app}\MesaDoMestre.exe"; WorkingDir: "{app}"; IconFilename: "{app}\mesa.ico"; Check: not IsTestMode
Name: "{userdesktop}\{#AppTitle}"; Filename: "{app}\MesaDoMestre.exe"; WorkingDir: "{app}"; IconFilename: "{app}\mesa.ico"; Tasks: desktopicon; Check: not IsTestMode

[Run]
Filename: "{app}\MesaDoMestre.exe"; Description: "Abrir Mesa do Mestre"; Flags: nowait postinstall skipifsilent; Check: not IsTestMode

[Code]
function IsTestMode: Boolean;
begin
  Result := ExpandConstant('{param:TESTMODE|0}') = '1';
end;
