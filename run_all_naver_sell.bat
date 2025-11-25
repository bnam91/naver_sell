@echo off
chcp 65001 > nul
cd /d "C:\Users\darli\Desktop\github\naver_sell"

set SCRIPT=NaverSell_v5_헤드리스.js

:: 날짜 변수 (YYYY-MM-DD)
for /f "tokens=1 delims= " %%a in ('powershell -command "(Get-Date).ToString(\'yyyy-MM-dd\')"') do set TODAY=%%a

echo === 네이버 크롤링 자동 실행 시작 %TODAY% ===

:: 로그 폴더 생성
if not exist log mkdir log

echo [1] naver_bnam91 실행 중...
start /B node "%SCRIPT%" --profile=naver_bnam91 --headless > log\log_%TODAY%_bnam91.txt 2>&1
timeout /t 90 /nobreak > nul

echo [2] naver_darling_91 실행 중...
start /B node "%SCRIPT%" --profile=naver_darling_91 --headless > log\log_%TODAY%_darling_91.txt 2>&1
timeout /t 90 /nobreak > nul

echo [3] naver_goodboyhand 실행 중...
start /B node "%SCRIPT%" --profile=naver_goodboyhand --headless > log\log_%TODAY%_goodboyhand.txt 2>&1
timeout /t 90 /nobreak > nul

echo [4] naver_skround12 실행 중...
start /B node "%SCRIPT%" --profile=naver_skround12 --headless > log\log_%TODAY%_skround12.txt 2>&1

echo === 모든 프로필 병렬 실행 완료 ===
echo === 각 로그는 log 폴더 안에 날짜별로 저장됩니다 ===
