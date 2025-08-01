const { PDFDocument, rgb } = require('pdf-lib');
const fontkit = require('@pdf-lib/fontkit');
const fs = require('fs/promises');
const path = require('path');
const fetch = require('node-fetch');
const QRCode = require('qrcode');


const pt = mm => (mm * 72) / 25.4;
const PAPER_SPECS = {
  A4: { width: 210, height: 297, usableWidth: 200, usableHeight: 287, safeMargin: 5 },
  A3: { width: 297, height: 420, usableWidth: 287, usableHeight: 410, safeMargin: 5 }
};

// ... (ฟังก์ชัน Helper ทั้งหมด drawCropMarks, drawCardBorder, fetchImage, drawElements ไม่มีการเปลี่ยนแปลง) ...
function drawCropMarks(page, absX, absY, card_w, card_h, color) { /* ... */ }
function drawCardBorder(page, absX, absY, card_w, card_h, color) { /* ... */ }
const fetchImage = async (url) => { /* ... */ };
const drawElements = async (page, layoutConfig, absX, absY, scaleX, scaleY, assets, employee) => { /* ... */ };


exports.handler = async (event) => {
  let data;
  try {
    data = JSON.parse(event.body);
  } catch (error) {
    return {
      statusCode: 400,
      body: JSON.stringify({ message: 'Invalid or empty JSON body.', error: error.message })
    };
  }


  const { template, employees, paperSize = "A4", guideType = "border" } = data || {};
  if (!template || !employees || employees.length === 0) {
    return {
      statusCode: 400,
      body: JSON.stringify({ message: 'Missing required fields: template or employees.' })
    };
  }

  // <<< FIX: เปลี่ยนวิธีการกำหนดค่า spec ให้ปลอดภัยยิ่งขึ้น
  // ตรวจสอบว่า paperSize ที่ส่งมาเป็น key ที่ถูกต้องใน PAPER_SPECS หรือไม่
  // หากไม่ถูกต้อง ให้บังคับใช้ "A4" เสมอ
  const safePaperSize = (paperSize && PAPER_SPECS.hasOwnProperty(paperSize)) ? paperSize : "A4";
  const spec = PAPER_SPECS[safePaperSize];

  const cpx = template.canvas_width_px || (template.orientation === "portrait" ? 255 : 405);
  const cpy = template.canvas_height_px || (template.orientation === "portrait" ? 405 : 255);
  const isPortrait = template.orientation === 'portrait';
  const card_w = isPortrait ? 54 : 85.6, card_h = isPortrait ? 85.6 : 54;
  const scaleX = card_w / cpx, scaleY = card_h / cpy;

  const maxPairCol = 3;
  const PAIR_WIDTH = card_w * 2, PAIR_PER_BLOCK = maxPairCol;
  const BLOCK_WIDTH = PAIR_WIDTH * PAIR_PER_BLOCK;
  const blockGap = 0;
  const maxBlockPerRow = Math.floor((spec.usableWidth + blockGap) / (BLOCK_WIDTH + blockGap));
  const maxRow = Math.floor(spec.usableHeight / card_h);
  const borderColor = rgb(0.7, 0.7, 0.7);


  try {
    // ... (ส่วนที่เหลือของโค้ดไม่มีการเปลี่ยนแปลง) ...
    const pdfDoc = await PDFDocument.create();
    pdfDoc.registerFontkit(fontkit);
    const fontPath = path.resolve(process.cwd(), 'fonts/Noto_Sans_Thai/noto-sans-thai-latin-ext-400-normal.woff');
    const fontBytes = await fs.readFile(fontPath);
    const thaiFont = await pdfDoc.embedFont(fontBytes);
    
    // ... (ส่วน Load Images ไม่เปลี่ยนแปลง)
    
    const assets = { pdfDoc, thaiFont, imageAssetMap, template };


    let i = 0;
    while (i < employees.length) {
      // บรรทัดนี้จะทำงานได้อย่างปลอดภัยแล้ว เพราะ spec จะมีค่าที่ถูกต้องเสมอ
      const page = pdfDoc.addPage([pt(spec.width), pt(spec.height)]);
      const bg = imageAssetMap.get(template.background_front_url);
      if (bg) page.drawImage(bg, { x: 0, y: 0, width: page.getWidth(), height: page.getHeight() });

      // ... (ส่วน for loops และการวาดบัตรไม่เปลี่ยนแปลง) ...
    }
    const pdfBytes = await pdfDoc.save();
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/pdf' },
      body: Buffer.from(pdfBytes).toString('base64'),
      isBase64Encoded: true
    };
  } catch (error) {
    console.error('PDF generate error:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({
        message: "Error generating PDF: " + error.message,
        stack: error.stack
      })
    };
  }
};
