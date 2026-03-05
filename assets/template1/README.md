# KOICA·WFK 카드 템플릿 에셋

## 📁 폴더 구조

```
templates/
├── template_01_cover/          # 표지 카드
│   ├── background.png          # 1080x1080 배경 (장식 포함)
│   ├── config.json             # 오버레이 좌표 정의
│   └── thumbnail.png           # 200x200 미리보기
│
├── template_02_info/           # 정보 카드
│   ├── background.png
│   ├── config.json
│   └── thumbnail.png
│
├── template_03_detail/         # 상세 카드 (2장 사진)
│   ├── background.png
│   ├── config.json
│   └── thumbnail.png
│
├── template_04_cta/            # 마무리/CTA 카드
│   ├── background.png
│   ├── config.json
│   └── thumbnail.png
│
├── composite_example.js        # Sharp.js 합성 예시 코드
├── preview_grid.png            # 4개 템플릿 한눈에 보기
├── composite_test_01.png       # 합성 테스트 결과 (Cover)
└── composite_test_03.png       # 합성 테스트 결과 (Detail)
```

## 🎨 템플릿별 오버레이 좌표 요약

### Template 01: Cover (표지 카드)
| 요소 | x | y | 너비 | 높이 | 설명 |
|------|---|---|------|------|------|
| main_photo | 100 | 130 | 850 | 530 | 메인 사진 |
| award_badge | 855 | 565 | 110 | 110 | 수상 뱃지 (원형) |
| contest_info | 60 | 700 | 960 | 40 | 공모전 소개 텍스트 |
| title | 60 | 760 | 960 | 100 | 제목 (큰 글씨) |
| author | 60 | 880 | 960 | 60 | 작성자 정보 |

### Template 02: Info (정보 카드)
| 요소 | x | y | 너비 | 높이 | 설명 |
|------|---|---|------|------|------|
| main_photo | 120 | 200 | 820 | 460 | 메인 사진 |
| flag_icon | 810 | 560 | 120 | 90 | 국기/아이콘 (선택) |
| subtitle | 60 | 110 | 960 | 65 | 제목 (손글씨 스타일) |
| info_label_1~3 | 120 | 710/770/830 | 130 | 45 | 정보 레이블 (파란 박스) |
| info_value_1~3 | 270 | 710/770/830 | 690 | 45 | 정보 값 |

### Template 03: Detail (상세 카드)
| 요소 | x | y | 너비 | 높이 | 설명 |
|------|---|---|------|------|------|
| photo_1 | 450 | 120 | 550 | 350 | 사진 1 (우상단) |
| photo_2 | 80 | 380 | 550 | 350 | 사진 2 (좌하단) |
| caption_1 | 810 | 130 | 180 | 40 | 사진 1 캡션 |
| caption_2 | 60 | 700 | 180 | 40 | 사진 2 캡션 |
| description_line_1~4 | 100 | 770~905 | 880 | 35 | 설명 텍스트 (4줄) |

### Template 04: CTA (마무리 카드)
| 요소 | x | y | 너비 | 높이 | 설명 |
|------|---|---|------|------|------|
| contest_info | 180 | 180 | 720 | 90 | 공모전 소개 |
| cta_line_1~3 | 160 | 460/560/660 | 760 | 70 | CTA 텍스트 (3줄, 큰 글씨) |
| folder_icons | 340 | 330 | 400 | 80 | 폴더 아이콘 (장식) |

## 🔧 합성 워크플로우 (Sharp.js)

```javascript
const sharp = require('sharp');

// 1. 배경 로드
const background = sharp('template_01_cover/background.png');

// 2. 사용자 사진 리사이즈
const photo = await sharp('user_photo.jpg')
  .resize(850, 530, { fit: 'cover' })
  .toBuffer();

// 3. SVG 텍스트 생성
const titleSVG = Buffer.from(`
  <svg width="960" height="100">
    <text x="480" y="70" text-anchor="middle" 
          font-family="Noto Sans KR" font-size="52" font-weight="bold">
      라오스 학생들과
    </text>
  </svg>
`);

// 4. 합성
const result = await background
  .composite([
    { input: photo, left: 100, top: 130 },
    { input: titleSVG, left: 60, top: 760 }
  ])
  .png()
  .toBuffer();
```

## ⚠️ 디자인 개선 시 참고사항

현재 background.png는 **Pillow로 프로그래밍 생성**된 기본 버전입니다.
프로덕션 품질을 위해서는:

1. **미리캔버스/Canva에서 디자인 보강** → 에어메일 테두리, 마스킹테이프, 우표 등 디테일 추가
2. **실제 KOICA/WFK 로고 삽입** → 현재는 텍스트 플레이스홀더
3. **한글 손글씨 폰트** → SVG 텍스트에 적용
4. **좌표는 유지** → config.json의 좌표는 그대로 사용 가능

## 📐 새 템플릿 추가 방법

1. 1080x1080 PNG 배경 디자인 (사진/텍스트 영역 비움)
2. config.json에 오버레이 좌표 정의
3. thumbnail.png (200x200) 생성
4. `compositeCard('new_template_id', options)` 호출
