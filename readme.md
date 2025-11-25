
① 설명 : 
- 헤드리스

② 스프레드시트
- https://docs.google.com/spreadsheets/d/1rd5hkf7oMm8IVgGbISm6ZjHshZ74VmHor9I0VXVWNiM/edit?gid=175205913#gid=175205913

③ 명령어 
    윈도우(배치) 
    - C:\Users\darli\Desktop\github\naver_sell\run_all_naver_sell.bat

    맥OS
    - 


======== ======== ======== ======== ======== ======== ======== ======== ======== ======== ======== ========


준비물 :

① 구글스프레드시트 api 관련 세팅
- .env / auth.js 
- github폴더 내 auth.js 파일 준비되어있어야함

② 프로필 계정 관련 세팅
- set_login 폴더 내 '00_set_login_naver.py'로 프로필 계정 생성
- user_data 폴더 생성되면 github폴더에 user_data로 이동할 것
- 프로필 계정 관련 : 0_naver_login.txt 파일 생성되어있어야함 (5초내 안되면 여기로 로그인됨)


======== ======== ======== ======== ======== ======== ======== ======== ======== ======== ======== ========

메모 :
- 업데이트할거 : 
    - 
    - 중간에 끊기는 경우 대비
    - 몽고 디비 연결
    - 집에 서버pc 필요
    - run_all.sh (병렬 실행 스크립트) : https://chatgpt.com/c/69245d44-fff4-8323-8502-c1f40c65fad8

        
    👉 필요하면 추가로 만들어줄 수 있음

    - 윈도우 스케줄러 자동 등록(.xml) 파일 생성
    - 특정 시간마다 자동 실행(매시간, 매일, 10분 간격 등)
    - 실행 시 자동으로 cmd 창 숨김 버전 (vbs wrapper)
    - 로그 자동 압축/삭제 관리 스크립트


======== ======== ======== ======== ======== ======== ======== ======== ======== ======== ======== ========


명령어 (맥기준)
node NaverSell_v5_헤드리스.js --profile=naver_bnam91 --headless
node NaverSell_v5_헤드리스.js --profile=naver_darling_91 --headless
node NaverSell_v5_헤드리스.js --profile=naver_goodboyhand --headless
node NaverSell_v5_헤드리스.js --profile=naver_skround12 --headless


cd "/Users/a1/Documents/github/naver_sell" && node /Users/a1/Documents/github/naver_sell/NaverSell_v5_헤드리스.js --profile=naver_bnam91 --headless

cd "/Users/a1/Documents/github/naver_sell" && node /Users/a1/Documents/github/naver_sell/NaverSell_v5_헤드리스.js --profile=naver_darling_91 --headless

cd "/Users/a1/Documents/github/naver_sell" && node /Users/a1/Documents/github/naver_sell/NaverSell_v5_헤드리스.js --profile=naver_goodboyhand --headless

cd "/Users/a1/Documents/github/naver_sell" && node /Users/a1/Documents/github/naver_sell/NaverSell_v5_헤드리스.js --profile=naver_skround12 --headless



