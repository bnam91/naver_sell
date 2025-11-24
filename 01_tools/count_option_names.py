import json
import os
from pathlib import Path
from datetime import datetime

# 현재 스크립트의 상위 디렉토리 경로
current_dir = Path(__file__).parent
parent_dir = current_dir.parent

# 상위 디렉토리에서 JSON 파일 목록 가져오기 (package-lock.json, package.json 제외)
excluded_files = {'package-lock.json', 'package.json'}
json_files = [f for f in os.listdir(parent_dir) 
              if f.endswith('.json') and f not in excluded_files]

if not json_files:
    print("상위 디렉토리에 JSON 파일이 없습니다.")
    exit()

# JSON 파일 목록 표시
print("=" * 50)
print("상위 디렉토리의 JSON 파일 목록:")
print("=" * 50)
for idx, filename in enumerate(json_files, 1):
    print(f"{idx}. {filename}")
print("=" * 50)

# 사용자 입력 받기
try:
    choice = int(input("\n파일 번호를 선택하세요: "))
    if choice < 1 or choice > len(json_files):
        print("잘못된 번호입니다.")
        exit()
    
    selected_file = json_files[choice - 1]
    file_path = parent_dir / selected_file
    
    print(f"\n선택된 파일: {selected_file}")
    print("계산 중...")
    
    # JSON 파일 읽기
    with open(file_path, 'r', encoding='utf-8') as f:
        data = json.load(f)
    
    # option_name 필드 개수 세기 및 모든 타임스탬프 수집
    total_count = 0
    all_timestamps = []  # 모든 option_name의 stock 타임스탬프를 저장
    
    # 모든 store 순회
    for store in data.get('stores', []):
        # 각 store의 모든 product 순회
        for product in store.get('products', []):
            # 각 product의 모든 option 순회
            for option in product.get('options', []):
                # option_name 필드가 있으면 카운트 증가
                if 'option_name' in option:
                    total_count += 1
                    
                    # stock 필드에서 타임스탬프 수집
                    stock = option.get('stock', {})
                    if stock and isinstance(stock, dict):
                        # stock 딕셔너리의 키들(타임스탬프)을 파싱
                        for timestamp_str in stock.keys():
                            try:
                                # ISO 8601 형식의 타임스탬프를 datetime 객체로 변환
                                dt = datetime.fromisoformat(timestamp_str.replace('Z', '+00:00'))
                                all_timestamps.append(dt)
                            except (ValueError, AttributeError):
                                continue
    
    # 결과 출력
    print("=" * 50)
    print(f"파일: {selected_file}")
    print(f"총 option_name 필드 개수: {total_count}")
    
    if total_count > 0 and len(all_timestamps) >= 2:
        # 모든 타임스탬프를 시간 순으로 정렬
        all_timestamps.sort()
        first_time = all_timestamps[0]
        last_time = all_timestamps[-1]
        
        # 전체 시간 차이 계산 (초 단위)
        total_time_diff_seconds = (last_time - first_time).total_seconds()
        total_time_minutes = total_time_diff_seconds / 60
        
        # option_name 필드 개당 평균 시간 (초 단위)
        avg_time_per_option_seconds = total_time_diff_seconds / total_count if total_count > 0 else 0
        
        print(f"가장 처음 시간: {first_time.strftime('%Y-%m-%d %H:%M:%S')}")
        print(f"가장 마지막 시간: {last_time.strftime('%Y-%m-%d %H:%M:%S')}")
        print(f"전체 시간 차이: {total_time_minutes:.2f}분 ({total_time_diff_seconds:.2f}초)")
        print(f"option_name 필드 개당 평균 시간: {avg_time_per_option_seconds:.2f}초")
    elif total_count > 0 and len(all_timestamps) == 1:
        print("타임스탬프가 1개만 있어서 시간 차이를 계산할 수 없습니다.")
    elif total_count > 0:
        print("타임스탬프를 찾을 수 없습니다.")
    else:
        print("시간 차이를 계산할 수 없습니다 (option_name 필드가 없음)")
    
    print("=" * 50)
    
except ValueError:
    print("숫자를 입력해주세요.")
except FileNotFoundError:
    print(f"파일을 찾을 수 없습니다: {selected_file}")
except json.JSONDecodeError:
    print(f"JSON 파일 형식이 올바르지 않습니다: {selected_file}")
except Exception as e:
    print(f"오류가 발생했습니다: {e}")

