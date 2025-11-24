#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
option.txt 파일의 HTML 옵션 데이터를 JSON으로 변환하는 스크립트
"""

import json
import os
import re
from bs4 import BeautifulSoup

def extract_price(text):
    """텍스트에서 가격 정보를 추출하고 숫자로 변환"""
    price_match = re.search(r'\(\+([0-9,]+)원\)', text)
    if price_match:
        price_str = price_match.group(1).replace(',', '')
        return int(price_str)
    return 0

def extract_option_name(text):
    """텍스트에서 가격 정보를 제거한 옵션명 추출"""
    # 가격 정보 제거
    name = re.sub(r'\s*\(\+[0-9,]+\원\)', '', text)
    return name.strip()

def parse_options(html_content):
    """HTML 내용을 파싱하여 옵션 리스트 반환"""
    soup = BeautifulSoup(html_content, 'html.parser')
    options = []
    
    # 모든 <li> 태그 내의 <a> 태그 찾기
    for li in soup.find_all('li', role='presentation'):
        a_tag = li.find('a', role='option')
        if a_tag:
            # data-shp-contents-id 속성에서 옵션 ID 추출
            option_id = a_tag.get('data-shp-contents-id', '')
            
            # 텍스트 내용 추출
            text_content = a_tag.get_text(strip=True)
            
            # 옵션명과 가격 분리
            option_name = extract_option_name(text_content)
            additional_price = extract_price(text_content)
            
            option_data = {
                'id': option_id,
                'name': option_name,
                'additional_price': additional_price
            }
            
            options.append(option_data)
    
    return options

def list_txt_files():
    """현재 디렉토리의 .txt 파일 목록 반환"""
    txt_files = [f for f in os.listdir('.') if f.endswith('.txt') and os.path.isfile(f)]
    return sorted(txt_files)

def select_file():
    """사용자가 .txt 파일을 선택할 수 있게 함"""
    txt_files = list_txt_files()
    
    if not txt_files:
        print("오류: 현재 디렉토리에 .txt 파일이 없습니다.")
        return None
    
    print("\n=== 사용 가능한 .txt 파일 목록 ===")
    for i, filename in enumerate(txt_files, 1):
        print(f"{i}. {filename}")
    
    while True:
        try:
            choice = input(f"\n파일을 선택하세요 (1-{len(txt_files)}): ").strip()
            file_index = int(choice) - 1
            
            if 0 <= file_index < len(txt_files):
                selected_file = txt_files[file_index]
                print(f"\n선택한 파일: {selected_file}\n")
                return selected_file
            else:
                print(f"오류: 1부터 {len(txt_files)} 사이의 숫자를 입력해주세요.")
        except ValueError:
            print("오류: 숫자를 입력해주세요.")
        except KeyboardInterrupt:
            print("\n\n작업이 취소되었습니다.")
            return None

def get_base_price():
    """사용자로부터 기본가격을 입력받음"""
    while True:
        try:
            price_input = input("기본가격을 입력하세요 (숫자만 입력, 예: 10000): ").strip()
            # 쉼표 제거
            price_str = price_input.replace(',', '').replace('원', '')
            base_price = int(price_str)
            if base_price < 0:
                print("오류: 가격은 0 이상이어야 합니다.")
                continue
            return base_price
        except ValueError:
            print("오류: 숫자를 입력해주세요.")
        except KeyboardInterrupt:
            print("\n\n작업이 취소되었습니다.")
            return None

def extract_prefix_from_filename(filename):
    """파일명에서 접두사 추출 (예: option_100jum.txt -> 100jum)"""
    base_name = os.path.splitext(filename)[0]
    # option_ 접두사 제거
    if base_name.startswith('option_'):
        prefix = base_name[7:]  # 'option_' 길이만큼 제거
    elif base_name.startswith('option'):
        prefix = base_name[6:]  # 'option' 길이만큼 제거
    else:
        prefix = base_name
    return prefix if prefix else 'option'

def main():
    """메인 함수"""
    # 사용자가 파일 선택
    selected_file = select_file()
    if not selected_file:
        return
    
    # 기본가격 입력받기
    base_price = get_base_price()
    if base_price is None:
        return
    
    # 파일명에서 접두사 추출
    prefix = extract_prefix_from_filename(selected_file)
    
    # 선택한 파일 읽기
    try:
        with open(selected_file, 'r', encoding='utf-8') as f:
            html_content = f.read()
    except FileNotFoundError:
        print(f"오류: {selected_file} 파일을 찾을 수 없습니다.")
        return
    except Exception as e:
        print(f"오류: 파일 읽기 중 문제가 발생했습니다: {e}")
        return
    
    # HTML 파싱하여 옵션 추출
    options = parse_options(html_content)
    
    # 각 옵션에 메모 필드 추가
    for option in options:
        total_price = base_price + option['additional_price']
        memo = f"{prefix} | {option['name']} | {total_price}"
        option['memo'] = memo
    
    # JSON으로 변환
    output = {
        'total_count': len(options),
        'options': options
    }
    
    # JSON 파일로 저장 (입력 파일명 기반으로 출력 파일명 생성)
    base_name = os.path.splitext(selected_file)[0]
    output_filename = f'{base_name}.json'
    try:
        with open(output_filename, 'w', encoding='utf-8') as f:
            json.dump(output, f, ensure_ascii=False, indent=2)
        print(f"성공: {len(options)}개의 옵션이 {output_filename} 파일로 저장되었습니다.")
    except Exception as e:
        print(f"오류: JSON 파일 저장 중 문제가 발생했습니다: {e}")
        return
    
    # 콘솔에도 출력 (선택사항)
    print("\n=== 옵션 목록 ===")
    for i, option in enumerate(options, 1):
        price_info = f" (+{option['additional_price']:,}원)" if option['additional_price'] > 0 else ""
        print(f"{i}. {option['name']}{price_info} (ID: {option['id']})")

if __name__ == '__main__':
    main()

