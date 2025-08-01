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
const fetchImage = async (url) => { /* ... (ใช้เวอร์ชันที่มี Timeout) ... */ };
const drawElements = async (page, layoutConfig, absX, absY, scaleX, scaleY, assets, employee) => { /* ... */ };


exports.handler = async (event) => {
    let data;
    try {
        data = JSON.parse(event.body);
    } catch (error) {
        return { statusCode: 400, body: JSON.stringify({ message: 'Invalid or empty JSON body.', error: error.message }) };
    }

    const { template, employees, paperSize = "A4", guideType = "border" } = data || {};
    if (!template || !employees || employees.length === 0) {
        return { statusCode: 400, body: JSON.stringify({ message: 'Missing required fields: template or employees.' }) };
    }

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
        const pdfDoc = await PDFDocument.create();
        pdfDoc.registerFontkit(fontkit);
        const fontPath = path.resolve(process.cwd(), 'fonts/Noto_Sans_Thai/noto-sans-thai-latin-ext-400-normal.woff');
        const fontBytes = await fs.readFile(fontPath);
        const thaiFont = await pdfDoc.embedFont(fontBytes);

        // <<< FIX: เพิ่มโค้ดส่วน "Load Images" ที่หายไปกลับเข้ามาที่นี่
        const imageUrls = new Set();
        if (template.logo_url) imageUrls.add(template.logo_url);
        if (template.background_front_url) imageUrls.add(template.background_front_url);
        if (template.background_back_url) imageUrls.add(template.background_back_url);
        employees.forEach(emp => { if (emp.photo_url) imageUrls.add(emp.photo_url); });

        const fetchedImages = await Promise.all(Array.from(imageUrls).map(url => fetchImage(url).then(bytes => ({ url, bytes }))));
        
        // สร้าง imageAssetMap ขึ้นมาก่อนใช้งาน
        const imageAssetMap = new Map(); 
        for (const { url, bytes } of fetchedImages) {
            if (bytes) {
                try {
                    const image = await pdfDoc.embedPng(bytes).catch(() => pdfDoc.embedJpg(bytes));
                    imageAssetMap.set(url, image);
                } catch (err) {
                    console.error(`Error embedding image for URL ${url}:`, err);
                }
            }
        }
        
        // บรรทัดนี้จะทำงานได้ถูกต้องแล้ว เพราะ imageAssetMap ถูกสร้างแล้ว
        const assets = { pdfDoc, thaiFont, imageAssetMap, template };

        let i = 0;
        while (i < employees.length) {
            const page = pdfDoc.addPage([pt(spec.width), pt(spec.height)]);
            const bg = imageAssetMap.get(template.background_front_url);
            if (bg) page.drawImage(bg, { x: 0, y: 0, width: page.getWidth(), height: page.getHeight() });

            // ... (ส่วน for loops และการวาดบัตรไม่เปลี่ยนแปลง) ...
            for (let row = 0; row < maxRow && i < employees.length; row++) {
                for (let block = 0; block < maxBlockPerRow && i < employees.length; block++) {
                    const baseX = spec.safeMargin + block * (BLOCK_WIDTH + blockGap);
                    if (baseX + BLOCK_WIDTH > spec.safeMargin + spec.usableWidth) continue;
                    for (let pair = 0; pair < maxPairCol && i < employees.length; pair++) {
                        const offsetX = baseX + pair * PAIR_WIDTH, baseY = spec.safeMargin + row * card_h;
                        try {
                            await drawElements(page, template.layout_config_front, offsetX, baseY, scaleX, scaleY, assets, employees[i]);
                            await drawElements(page, template.layout_config_back, offsetX + card_w, baseY, scaleX, scaleY, assets, employees[i]);
                            if (guideType === "border") {
                                drawCardBorder(page, offsetX, baseY, card_w, card_h, borderColor);
                                drawCardBorder(page, offsetX + card_w, baseY, card_w, card_h, borderColor);
                            } else if (guideType === "cropmark") {
                                drawCropMarks(page, offsetX, baseY, card_w, card_h, borderColor);
                                drawCropMarks(page, offsetX + card_w, baseY, card_w, card_h, borderColor);
                            }
                        } catch (cellErr) {
                            console.error('Draw cell error:', cellErr, { block, row, pair, empID: employees[i]?.employee_id });
                        }
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
        console.error('PDF generate error:', error);
        return {
            statusCode: 500,
            body: JSON.stringify({ message: "Error generating PDF: " + error.message, stack: error.stack })
        };
    }
};
