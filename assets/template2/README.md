# ODA 채용소식 카드 템플릿 에셋 (레트로 픽셀 아트 스타일)

## 📁 폴더 구조

```
oda_career_templates/
├── template_01_cover/          # 표지 카드 (사진 + 날짜 + 채용소식)
│   ├── background.png          # 1080x1080 배경
│   ├── config.json             # 오버레이 좌표
│   └── thumbnail.png           # 200x200 미리보기
│
├── template_02_ngo/            # NGO 채용 리스트 (브라우저 창 3건)
│   ├── background.png
│   ├── config.json
│   └── thumbnail.png
│
├── template_03_intl/           # 국제기구/공공기관 리스트 (브라우저 창 2건)
│   ├── background.png
│   ├── config.json
│   └── thumbnail.png
│
├── template_04_cta/            # 마무리 CTA (하늘색 + 해시태그)
│   ├── background.png
│   ├── config.json
│   └── thumbnail.png
│
└── preview_grid.png            # 4개 템플릿 한눈에 보기
```

## 🎮 디자인 컨셉: 레트로 픽셀 아트 / 8비트 게임

- 어두운 배경 + 네온 컬러 (초록 #50E682, 노랑 #D2FF32)
- 픽셀 하트, 병아리, 커서, 선글라스, 모래시계 등 8비트 장식
- 브라우저 창 UI 메타포 (검색바, 폴더 아이콘, 체크마크)
- 폴라로이드 사진 프레임

## 🎨 템플릿별 오버레이 좌표 요약

### Template 01: Cover (표지)
| 요소 | x | y | 너비 | 높이 | 설명 |
|------|---|---|------|------|------|
| main_photo | 75 | 45 | 720 | 525 | 메인 사진 (폴라로이드 내부) |
| date_badge | 75 | 95 | 110 | 70 | 날짜 (노란 원 위) |
| oda_tag | 120 | 650 | 530 | 70 | "ODA취업하지?" (녹색 바) |
| center_tag | 240 | 735 | 460 | 55 | "개발협력커리어센터" (노랑 바) |
| main_title | 80 | 830 | 620 | 120 | "채용소식" (보라색, 큰 글씨) |

### Template 02: NGO 채용 리스트
| 요소 | x | y | 너비 | 높이 | 설명 |
|------|---|---|------|------|------|
| category_title | 125 | 58 | 160 | 32 | "NGO" (탭 제목) |
| job_1_org | 195 | 170 | 700 | 25 | 채용 1 - 기관명 |
| job_1_title | 195 | 200 | 750 | 35 | 채용 1 - 직무명 (굵게) |
| job_1_detail | 195 | 245 | 750 | 25 | 채용 1 - 상세 |
| job_2_org~detail | 195 | 360~435 | - | - | 채용 2 (동일 구조) |
| job_3_org~detail | 195 | 545~620 | - | - | 채용 3 (동일 구조) |

### Template 03: 국제기구/공공기관 리스트
| 요소 | x | y | 너비 | 높이 | 설명 |
|------|---|---|------|------|------|
| category_title | 125 | 58 | 340 | 32 | "국제기구/공공기관" (탭 제목) |
| job_1_org~detail | 215 | 220~295 | - | - | 채용 1 |
| job_2_org~detail | 215 | 440~515 | - | - | 채용 2 |

### Template 04: CTA (마무리)
| 요소 | x | y | 너비 | 높이 | 설명 |
|------|---|---|------|------|------|
| date_badge | 45 | 55 | 110 | 70 | 날짜 (노란 원 위) |
| cta_line_1 | 180 | 130 | 760 | 50 | "더 자세한 사항은" |
| cta_line_2 | 180 | 190 | 760 | 50 | "WFK 블로그를 확인해주세요" |
| oda_tag | 300 | 410 | 480 | 65 | "ODA취업하지?" (녹색 바) |
| tag_1~4 | 각각 다름 | - | - | 60 | 해시태그 (#NGO취업 등) |

## 🔧 Sharp.js 합성 시 참고

```javascript
// 브라우저 창 스타일 카드 (02, 03)의 경우
// 배경 사진을 opacity 15%로 합성 후 브라우저 창 배경 합성
const bg = await sharp('user_photo.jpg')
  .resize(1080, 1080, { fit: 'cover' })
  .modulate({ brightness: 0.3 })
  .toBuffer();

// 그 위에 template background 합성
const result = await sharp(bg)
  .composite([
    { input: 'template_02_ngo/background.png', left: 0, top: 0 }
  ])
  .toBuffer();
```

## ⚠️ 프로덕션 참고
- 현재 background.png는 Pillow 프로토타입
- 미리캔버스/Canva에서 디자인 보강 필요 (픽셀 아트 디테일, 배터리 아이콘 등)
- config.json 좌표는 그대로 유지 가능
