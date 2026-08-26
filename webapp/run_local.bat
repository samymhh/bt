@echo off
REM Serve esta pasta (webapp/) num servidor HTTP local e abre no browser.
REM Usa a API do Apps Script ja publicada em js/config.js -- ou seja, mostra
REM os dados reais da Google Sheet, tal como a app publicada mostraria.
setlocal

cd /d "%~dp0"

set "PORT=8080"
set "PYEXE=C:\Users\Samuel\AppData\Local\Programs\Python\Python39\python.exe"
if not exist "%PYEXE%" set "PYEXE=python"

echo A iniciar servidor local em http://localhost:%PORT% ...
echo (fecha essa janela, ou Ctrl+C nela, para parar o servidor)
start "Bet Tracker - servidor local" cmd /k ""%PYEXE%" -m http.server %PORT%"

timeout /t 2 /nobreak >nul
start "" "http://localhost:%PORT%"

endlocal
