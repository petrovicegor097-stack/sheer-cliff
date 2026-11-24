@echo off
setlocal EnableDelayedExpansion
rem Запуск игры Скала в отдельном окне. Работает и в папках с пробелами в названии.
set "GAME=%~dp0index.html"
set "URL=file:///!GAME:\=/!"
set "URL=!URL: =%%20!"
set "PROF=%~dp0browser_profile"
for %%B in ("%ProgramFiles%\Google\Chrome\Application\chrome.exe" "%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe" "%LocalAppData%\Google\Chrome\Application\chrome.exe" "%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe" "%ProgramFiles%\Microsoft\Edge\Application\msedge.exe") do (
  if exist %%B (
    start "" %%B --app="!URL!" --allow-file-access-from-files --user-data-dir="!PROF!" --start-fullscreen
    exit /b
  )
)
echo Не найден Chrome или Edge.
pause
