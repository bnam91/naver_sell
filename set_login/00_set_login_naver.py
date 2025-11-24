import os
import shutil
from selenium import webdriver
from selenium.webdriver.chrome.options import Options
import time

def setup_new_login():
    # 현재 스크립트의 디렉토리 경로
    current_dir = os.path.dirname(os.path.dirname(__file__))
    
    # 프로필 이름 입력 받기
    profile_name = input("사용할 프로필 이름을 입력하세요 (예: test): ").strip()
    
    # naver_ 접두사 추가 (이미 있으면 제외)
    if not profile_name.startswith("naver_"):
        profile_name_with_prefix = f"naver_{profile_name}"
    else:
        profile_name_with_prefix = profile_name
    
    # 0_naver_login.txt 파일 생성
    login_file_path = os.path.join(current_dir, "0_naver_login.txt")
    with open(login_file_path, 'w', encoding='utf-8') as f:
        f.write(profile_name_with_prefix)
    print(f"\n프로필 이름이 {login_file_path}에 저장되었습니다.")
    
    # user_data 디렉토리 생성
    user_data_dir = os.path.join(current_dir, "user_data")
    if not os.path.exists(user_data_dir):
        os.makedirs(user_data_dir)
        print(f"\nuser_data 디렉토리가 생성되었습니다: {user_data_dir}")
    
    # 프로필 디렉토리 생성
    profile_dir = os.path.join(user_data_dir, profile_name_with_prefix)
    if not os.path.exists(profile_dir):
        os.makedirs(profile_dir)
        print(f"\n프로필 디렉토리가 생성되었습니다: {profile_dir}")
    
    # 크롬 옵션 설정
    options = Options()
    options.add_argument(f"user-data-dir={profile_dir}")
    options.add_argument("--start-maximized")
    options.add_experimental_option("detach", True)
    options.add_argument("disable-blink-features=AutomationControlled")
    options.add_experimental_option("excludeSwitches", ["enable-logging"])
    
    print("\n크롬 브라우저가 실행됩니다. 네이버에 로그인해주세요.")
    print("로그인이 완료되면 브라우저를 닫아주세요.")
    
    # 크롬 실행
    driver = webdriver.Chrome(options=options)
    driver.get("https://nid.naver.com/nidlogin.login")
    
    # 사용자가 브라우저를 닫을 때까지 대기
    try:
        input("\n로그인이 완료되면 엔터키를 눌러주세요...")
        print("\n설정이 완료되었습니다.")
    except KeyboardInterrupt:
        print("\n설정이 완료되었습니다.")
    finally:
        driver.quit()

if __name__ == "__main__":
    setup_new_login() 