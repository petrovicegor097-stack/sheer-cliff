@echo off
if not exist "%~dp0nwjs\nw.exe" (
  echo Не найдена папка nwjs. Скачай NW.js с nwjs.io и распакуй её в папку nwjs рядом с игрой. Подробности в README.txt
  pause
  exit /b
)
start "" "%~dp0nwjs\nw.exe" "%~dp0."
