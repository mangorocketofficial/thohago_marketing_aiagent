/**
 * KOICA·WFK 카드 템플릿 합성 예시 (Sharp + SVG 텍스트)
 * 
 * 사용법:
 *   node composite_example.js --template=template_01_cover --photo=photo.jpg --title="라오스 학생들과"
 * 
 * 필요 패키지: npm install sharp
 */

const sharp = require('sharp');
const fs = require('fs');
const path = require('path');

// ============================================
// 1. 템플릿 설정 로드
// ============================================
async function loadTemplate(templateId) {
  const templateDir = path.join(__dirname, templateId);
  const config = JSON.parse(fs.readFileSync(path.join(templateDir, 'config.json'), 'utf-8'));
  const backgroundPath = path.join(templateDir, 'background.png');
  return { config, backgroundPath, templateDir };
}

// ============================================
// 2. SVG 텍스트 생성
// ============================================
function createTextSVG(textConfig, actualText) {
  const { width, height, font_size, font_color, font_weight, align } = textConfig;
  
  const fontSize = font_size || 24;
  const fontColor = font_color || '#333333';
  const fontWeight = font_weight || 'normal';
  const textAnchor = align === 'center' ? 'middle' : (align === 'right' ? 'end' : 'start');
  const xPos = align === 'center' ? width / 2 : (align === 'right' ? width - 10 : 10);
  
  // 한글 폰트 사용 (Noto Sans KR 또는 시스템 폰트)
  const svg = `
    <svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
      <style>
        @import url('https://fonts.googleapis.com/css2?family=Noto+Sans+KR:wght@400;700&display=swap');
        .text {
          font-family: 'Noto Sans KR', 'NanumGothic', sans-serif;
          font-size: ${fontSize}px;
          font-weight: ${fontWeight === 'bold' ? 700 : 400};
          fill: ${fontColor};
        }
      </style>
      <text x="${xPos}" y="${height * 0.7}" text-anchor="${textAnchor}" class="text">
        ${escapeXml(actualText)}
      </text>
    </svg>
  `;
  
  return Buffer.from(svg);
}

function escapeXml(text) {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

// ============================================
// 3. 사진 리사이즈 (cover 모드)
// ============================================
async function resizePhoto(photoPath, targetWidth, targetHeight, fit = 'cover') {
  return sharp(photoPath)
    .resize(targetWidth, targetHeight, {
      fit: fit,
      position: 'centre'
    })
    .toBuffer();
}

// ============================================
// 4. 메인 합성 함수
// ============================================
async function compositeCard(templateId, options) {
  const { config, backgroundPath } = await loadTemplate(templateId);
  
  // 합성 레이어 배열
  const composites = [];
  
  // 4-1. 사진 합성
  if (options.photos && config.overlays.photos) {
    for (const photoConfig of config.overlays.photos) {
      const photoInput = options.photos[photoConfig.id];
      if (!photoInput) continue;
      
      const photoBuffer = await resizePhoto(
        photoInput,
        photoConfig.width,
        photoConfig.height,
        photoConfig.fit || 'cover'
      );
      
      composites.push({
        input: photoBuffer,
        left: photoConfig.x,
        top: photoConfig.y,
      });
    }
  }
  
  // 4-2. 텍스트 SVG 합성
  if (options.texts && config.overlays.texts) {
    for (const textConfig of config.overlays.texts) {
      const textContent = options.texts[textConfig.id];
      if (!textContent) continue;
      
      const svgBuffer = createTextSVG(textConfig, textContent);
      
      composites.push({
        input: svgBuffer,
        left: textConfig.x,
        top: textConfig.y,
      });
    }
  }
  
  // 4-3. 최종 합성
  const result = await sharp(backgroundPath)
    .composite(composites)
    .png()
    .toBuffer();
  
  return result;
}

// ============================================
// 5. 사용 예시
// ============================================
async function main() {
  // 예시: Template 01 (Cover Card) 합성
  const outputBuffer = await compositeCard('template_01_cover', {
    photos: {
      main_photo: './user_photo.jpg',  // 사용자 업로드 사진
    },
    texts: {
      contest_info: '2025년 KOICA·WFK 영상·사진 공모전 수상작 소개',
      title: '라오스 학생들과',
      author: '청년중기봉사단(디지털) 유다미',
    }
  });
  
  fs.writeFileSync('output_cover.png', outputBuffer);
  console.log('Cover card generated: output_cover.png');
  
  // 예시: Template 03 (Detail Card) 합성
  const detailBuffer = await compositeCard('template_03_detail', {
    photos: {
      photo_1: './festival_photo.jpg',
      photo_2: './classroom_photo.jpg',
    },
    texts: {
      caption_1: '빠마이 축제에서',
      caption_2: '컴퓨터 수업중!',
      description_line_1: '라오스 통풍마을 통풍고등학교에서',
      description_line_2: '디지털 교육을 진행하신 유다미 단원님🖥️',
      description_line_3: '진지하게 수업을 받는 학생들의 모습과 함께',
      description_line_4: '인생의 한 페이지를 보내주셨습니다📖',
    }
  });
  
  fs.writeFileSync('output_detail.png', detailBuffer);
  console.log('Detail card generated: output_detail.png');
}

// Export for use as module
module.exports = { compositeCard, loadTemplate, createTextSVG };

// Run if called directly
if (require.main === module) {
  main().catch(console.error);
}
