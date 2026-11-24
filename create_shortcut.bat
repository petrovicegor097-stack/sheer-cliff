@echo off
rem Creates a desktop shortcut to start.bat (game "Skala"). Run once.
if not exist "%~dp0start.bat" (
  echo start.bat not found next to this file.
  pause
  exit /b 1
)
set "TARGET=%~dp0start.bat"
set "WORKDIR=%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -Command "$n=[string]([char]0x0421)+[char]0x043A+[char]0x0430+[char]0x043B+[char]0x0430; $d=[Environment]::GetFolderPath('Desktop'); $s=(New-Object -ComObject WScript.Shell).CreateShortcut((Join-Path $d ($n+'.lnk'))); $s.TargetPath=$env:TARGET; $s.WorkingDirectory=$env:WORKDIR; $s.WindowStyle=7; $ic=@($env:ProgramFiles+'\Google\Chrome\Application\chrome.exe',${env:ProgramFiles(x86)}+'\Google\Chrome\Application\chrome.exe',$env:LocalAppData+'\Google\Chrome\Application\chrome.exe',${env:ProgramFiles(x86)}+'\Microsoft\Edge\Application\msedge.exe',$env:ProgramFiles+'\Microsoft\Edge\Application\msedge.exe') | Where-Object { Test-Path $_ } | Select-Object -First 1; if($ic){$s.IconLocation=$ic+',0'}; $s.Save()"
if errorlevel 1 (
  echo Could not create the shortcut. Right-click start.bat - Send to - Desktop (create shortcut).
  pause
  exit /b 1
)
echo Done. Shortcut is on your Desktop.
timeout /t 3 >nul
