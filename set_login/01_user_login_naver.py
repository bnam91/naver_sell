from selenium import webdriver
from selenium.webdriver.chrome.options import Options
import os
import shutil
import sys
from pathlib import Path

def clear_chrome_data(user_data_dir, keep_login=True):
    default_dir = os.path.join(user_data_dir, 'Default')
    if not os.path.exists(default_dir):
        print("Default 디렉토리가 존재하지 않습니다.")
        return

    # Lock 파일 삭제 (Chrome이 실행 중이 아닐 때 프로필을 사용할 수 있도록)
    lock_files = ['SingletonLock', 'SingletonSocket', 'SingletonCookie']
    for lock_file in lock_files:
        lock_path = os.path.join(user_data_dir, lock_file)
        if os.path.exists(lock_path):
            try:
                os.remove(lock_path)
                print(f"{lock_file} 파일을 삭제했습니다.")
            except Exception as e:
                print(f"{lock_file} 파일 삭제 중 오류: {e}")

    # 로그인 정보를 유지하기 위해 최소한의 파일만 삭제
    dirs_to_clear = ['Cache', 'Code Cache', 'GPUCache']
    # History와 Visited Links는 삭제하지 않음 (로그인 세션 유지에 필요할 수 있음)
    files_to_clear = []
    
    for dir_name in dirs_to_clear:
        dir_path = os.path.join(default_dir, dir_name)
        if os.path.exists(dir_path):
            shutil.rmtree(dir_path)
            print(f"{dir_name} 디렉토리를 삭제했습니다.")

    # keep_login이 False일 때만 로그인 관련 파일 삭제
    if not keep_login:
        files_to_clear.extend(['Cookies', 'Login Data', 'History', 'Visited Links', 'Web Data'])

    for file_name in files_to_clear:
        file_path = os.path.join(default_dir, file_name)
        if os.path.exists(file_path):
            os.remove(file_path)
            print(f"{file_name} 파일을 삭제했습니다.")





def get_available_profiles(user_data_parent):
    """사용 가능한 프로필 목록을 가져옴"""
    profiles = []
    if not os.path.exists(user_data_parent):
        os.makedirs(user_data_parent)
        return profiles
        
    for item in os.listdir(user_data_parent):
        item_path = os.path.join(user_data_parent, item)
        if os.path.isdir(item_path):
            if (os.path.exists(os.path.join(item_path, 'Default')) or 
                any(p.startswith('Profile') for p in os.listdir(item_path) if os.path.isdir(os.path.join(item_path, p)))):
                profiles.append(item)
    return profiles

def select_profile(user_data_parent):
    """사용자에게 프로필을 선택하도록 함"""
    profiles = get_available_profiles(user_data_parent)
    if not profiles:
        print("\n사용 가능한 프로필이 없습니다.")
        create_new = input("새 프로필을 생성하시겠습니까? (y/n): ").lower()
        if create_new == 'y':
            while True:
                name = input("새 프로필 이름을 입력하세요: ")
                if not name:
                    print("프로필 이름을 입력해주세요.")
                    continue
                    
                if any(c in r'\\/:*?""<>|' for c in name):
                    print("프로필 이름에 다음 문자를 사용할 수 없습니다: \\ / : * ? \" < > |")
                    continue
                    
                new_profile_path = os.path.join(user_data_parent, name)
                if os.path.exists(new_profile_path):
                    print(f"'{name}' 프로필이 이미 존재합니다.")
                    continue
                    
                try:
                    os.makedirs(new_profile_path)
                    os.makedirs(os.path.join(new_profile_path, 'Default'))
                    print(f"'{name}' 프로필이 생성되었습니다.")
                    return name
                except Exception as e:
                    print(f'프로필 생성 중 오류가 발생했습니다: {e}')
                    retry = input("다시 시도하시겠습니까? (y/n): ").lower()
                    if retry != 'y':
                        return None
        return None
        
    print("\n사용 가능한 프로필 목록:")
    for idx, profile in enumerate(profiles, 1):
        print(f"{idx}. {profile}")
    print(f"{len(profiles) + 1}. 새 프로필 생성")
        
    while True:
        try:
            choice = int(input("\n사용할 프로필 번호를 선택하세요: "))
            if 1 <= choice <= len(profiles):
                selected_profile = profiles[choice - 1]
                print(f"\n선택된 프로필: {selected_profile}")
                return selected_profile
            elif choice == len(profiles) + 1:
                # 새 프로필 생성
                while True:
                    name = input("새 프로필 이름을 입력하세요: ")
                    if not name:
                        print("프로필 이름을 입력해주세요.")
                        continue
                        
                    if any(c in r'\\/:*?""<>|' for c in name):
                        print("프로필 이름에 다음 문자를 사용할 수 없습니다: \\ / : * ? \" < > |")
                        continue
                        
                    new_profile_path = os.path.join(user_data_parent, name)
                    if os.path.exists(new_profile_path):
                        print(f"'{name}' 프로필이 이미 존재합니다.")
                        continue
                        
                    try:
                        os.makedirs(new_profile_path)
                        os.makedirs(os.path.join(new_profile_path, 'Default'))
                        print(f"'{name}' 프로필이 생성되었습니다.")
                        return name
                    except Exception as e:
                        print(f'프로필 생성 중 오류가 발생했습니다: {e}')
                        retry = input("다시 시도하시겠습니까? (y/n): ").lower()
                        if retry != 'y':
                            break
            else:
                print("유효하지 않은 번호입니다. 다시 선택해주세요.")
        except ValueError:
            print("숫자를 입력해주세요.")

def main():
    # 사용자 프로필 경로 설정 - 상위 디렉토리(프로젝트 루트)에 user_data 폴더 생성
    user_data_parent = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "user_data")
    
    # 프로필 선택
    selected_profile = select_profile(user_data_parent)
    if not selected_profile:
        print("프로필을 선택할 수 없습니다. 프로그램을 종료합니다.")
        return
        
    user_data_dir = os.path.join(user_data_parent, selected_profile)
    
    if not os.path.exists(user_data_dir):
        os.makedirs(user_data_dir)
        os.makedirs(os.path.join(user_data_dir, 'Default'))

    # Chrome 옵션 설정
    options = Options()
    options.add_argument("--start-maximized")
    options.add_experimental_option("detach", True)
    options.add_argument("disable-blink-features=AutomationControlled")
    options.add_experimental_option("excludeSwitches", ["enable-logging"])
    options.add_argument(f"user-data-dir={user_data_dir}")
    # 로그인 정보 유지를 위해 캐시 비활성화 옵션 제거
    # options.add_argument("--disable-application-cache")
    # options.add_argument("--disable-cache")
    options.add_argument("--no-sandbox")
    options.add_argument("--disable-dev-shm-usage")
    options.add_argument("--disable-gpu")

    # 캐시와 임시 파일 정리 (로그인 정보 유지)
    clear_chrome_data(user_data_dir)

    # Chrome 드라이버 생성 및 네이버 열기
    try:
        driver = webdriver.Chrome(options=options)
        print("Chrome 브라우저가 시작되었습니다.")
        
        # 네이버 메인 페이지로 이동
        print("네이버로 이동합니다...")
        driver.get("https://www.naver.com/")
        
        print(f"\n선택된 프로필: {selected_profile}")
        print("네이버가 열렸습니다. 프로그램을 종료합니다.")
        
    except Exception as e:
        print(f"Chrome 드라이버 생성 중 오류 발생: {e}")
        print("\n가능한 해결 방법:")
        print("1. Chrome 브라우저가 실행 중인지 확인하고 모두 종료하세요.")
        print("2. 프로필 디렉토리가 손상되었을 수 있습니다. 새 프로필을 생성해보세요.")
        print("3. ChromeDriver 버전이 Chrome 브라우저 버전과 호환되는지 확인하세요.")
        print("프로그램을 종료합니다.")

if __name__ == "__main__":
    main()
