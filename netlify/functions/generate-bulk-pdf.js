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

const fetchImage = async (url) => {
  try {
    const response = await fetch(url);
    if (!response.ok) return null;
    return response.arrayBuffer();
  } catch {
    return null;
  }
};

const drawElements = async (page, layoutConfig, absX, absY, scaleX, scaleY, assets, employee) => {
  const { pdfDoc, thaiFont, imageAssetMap, template } = assets;
  for (const id in layoutConfig) {
    const config = layoutConfig[id];
    const type = id.split('-')[0];
    let text = '', imageBuffer;
    switch (type) {
      case 'employee_name': text = employee.name || ''; break;
      case 'employee_id': text = employee.employee_id || ''; break;
      case 'department_name': text = employee.department_name || ''; break;
      case 'text': text = config.text || ''; break;
      case 'logo': imageBuffer = imageAssetMap.get(template.logo_url); break;
      case 'photo': imageBuffer = imageAssetMap.get(employee.photo_url); break;
      case 'qr_code':
        const qrData = employee.employee_id || 'no-id';
        const qrImageBuffer = await QRCode.toBuffer(qrData, { type: 'png' });
        imageBuffer = { image: await pdfDoc.embedPng(qrImageBuffer), isQr: true };
        break;
    }
    const x = pt(absX + (config.x * scaleX));
    const y = page.getHeight() - pt(absY + (config.y * scaleY));
    const w = pt(config.width * scaleX), h = pt(config.height * scaleY);
    if (imageBuffer) {
      const image = imageBuffer.isQr ? imageBuffer.image : imageBuffer;
      if (image) page.drawImage(image, { x, y: y - h, width: w, height: h });
    } else if (text) {
      const fontSize = pt((config.fontSize || 12) * ((scaleX + scaleY) / 2));
      page.drawText(text, { x, y: y - fontSize, font: thaiFont, size: fontSize, color: rgb(0, 0, 0) });
    }
  }
};

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

  const spec = PAPER_SPECS[paperSize] || PAPER_SPECS.A4;
  const cpx = template.canvas_width_px || (template.orientation === "portrait" ? 255 : 405);
  const cpy = template.canvas_height_px || (template.orientation === "portrait" ? 405 : 255);
  const isPortrait = template.orientation === 'portrait';
  const card_w = isPortrait ? 54 : 85.6, card_h = isPortrait ? 85.6 : 54;
  const scaleX = card_w / cpx, scaleY = card_h / cpy;
  // 1 คู่: card_w * 2, block: 3 คู่
  const PAIR_WIDTH = card_w * 2;
  const PAIR_PER_BLOCK = 3;
  const BLOCK_WIDTH = PAIR_WIDTH * PAIR_PER_BLOCK;
  const BLOCK_GAP_PX = 50; // 50 px (design px), convert to mm เหมือน scale เครื่อง
  // convert 50px (design) ไปเป็น mm
  const pxPerMm = cpx / card_w; // (px / mm)
  const blockGap = 50 / pxPerMm; // mm

  // วาง block ต่อแถว (แนวนอน) เท่าไหร่ที่ใส่ได้ใน usableWidth
  const maxBlockPerRow = Math.floor((spec.usableWidth + blockGap) / (BLOCK_WIDTH + blockGap));
  const maxRow = Math.floor(spec.usableHeight / card_h);

  try {
    const pdfDoc = await PDFDocument.create();
    pdfDoc.registerFontkit(fontkit);
    const fontPath = path.resolve(process.cwd(), 'fonts/Noto_Sans_Thai/noto-sans-thai-latin-ext-400-normal.woff');
    const fontBytes = await fs.readFile(fontPath);
    const thaiFont = await pdfDoc.embedFont(fontBytes);

    // โหลด images
    const imageUrls = new Set();
    if (template.logo_url) imageUrls.add(template.logo_url);
    if (template.background_front_url) imageUrls.add(template.background_front_url);
    if (template.background_back_url) imageUrls.add(template.background_back_url);
    employees.forEach(emp => { if(emp.photo_url) imageUrls.add(emp.photo_url); });
    const fetchedImages = await Promise.all(Array.from(imageUrls).map(url => fetchImage(url).then(bytes => ({ url, bytes }))));
    const imageAssetMap = new Map();
    for (const { url, bytes } of fetchedImages) {
      if (bytes) {
        try {
          const image = await pdfDoc.embedPng(bytes).catch(() => pdfDoc.embedJpg(bytes));
          imageAssetMap.set(url, image);
        } catch {}
      }
    }
    const assets = { pdfDoc, thaiFont, imageAssetMap, template };

    let i = 0;
    while (i < employees.length) {
      const page = pdfDoc.addPage([pt(spec.width), pt(spec.height)]);
      const bg = imageAssetMap.get(template.background_front_url);
      if (bg) {
        page.drawImage(bg, { x: 0, y: 0, width: page.getWidth(), height: page.getHeight() });
      }

      for (let row = 0; row < maxRow; row++) {
        for (let block = 0; block < maxBlockPerRow; block++) {
          const baseX = spec.safeMargin + block * (BLOCK_WIDTH + blockGap);
          const baseY = spec.safeMargin + row * card_h;
          for (let pair = 0; pair < PAIR_PER_BLOCK; pair++) {
            if (i >= employees.length) break;
            const offsetX = baseX + pair * PAIR_WIDTH;
            // วาดหน้าบัตร
            await drawElements(page, template.layout_config_front, offsetX, baseY, scaleX, scaleY, assets, employees[i]);
            // วาดหลังบัตร (ขวา ชิด)
            await drawElements(page, template.layout_config_back, offsetX + card_w, baseY, scaleX, scaleY, assets, employees[i]);
            i++;
          }
        }
      }
    }

    const pdfBytes = await pdfDoc.save();

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/pdf' },
      body: Buffer.from(pdfBytes).toString('base64'),
      isBase64Encoded: true
    };

  } catch (error) {
    return {
      statusCode: 500,
      body: JSON.stringify({ message: `Error generating PDF: ${error.message}` })
    };
  }
};
