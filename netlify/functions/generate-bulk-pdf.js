const { PDFDocument, rgb } = require('pdf-lib');
const fontkit = require('@pdf-lib/fontkit');
const fs = require('fs/promises');
const path = require('path');
const fetch = require('node-fetch');
const QRCode = require('qrcode');

// --- Helper Functions (ไม่มีการเปลี่ยนแปลง) ---
const pt = mm => (mm * 72) / 25.4;
const PAPER_SPECS = {
    A4: { width: 210, height: 297, usableWidth: 200, usableHeight: 287, safeMargin: 5 },
    A3: { width: 297, height: 420, usableWidth: 287, usableHeight: 410, safeMargin: 5 }
};
function drawCropMarks(page, absX, absY, card_w, card_h, color) { /* ... โค้ดเดิม ... */ }
function drawCardBorder(page, absX, absY, card_w, card_h, color) { /* ... โค้ดเดิม ... */ }
const fetchImage = async (url) => { /* ... โค้ดเดิมที่มี Timeout ... */ };
const drawElements = async (page, layoutConfig, absX, absY, scaleX, scaleY, assets, employee) => { /* ... โค้ดเดิม ... */ };


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
    const PAIR_WIDTH = card_w * 2;
    const borderColor = rgb(0.7, 0.7, 0.7);

    try {
        const pdfDoc = await PDFDocument.create();
        pdfDoc.registerFontkit(fontkit);
        const fontPath = path.resolve(process.cwd(), 'fonts/Noto_Sans_Thai/noto-sans-thai-latin-ext-400-normal.woff');
        const fontBytes = await fs.readFile(fontPath);
        const thaiFont = await pdfDoc.embedFont(fontBytes);

        // --- Load Images (Logic เดิม) ---
        const imageUrls = new Set();
        if (template.logo_url) imageUrls.add(template.logo_url);
        if (template.background_front_url) imageUrls.add(template.background_front_url);
        if (template.background_back_url) imageUrls.add(template.background_back_url);
        employees.forEach(emp => { if (emp.photo_url) imageUrls.add(emp.photo_url); });
        const fetchedImages = await Promise.all(Array.from(imageUrls).map(url => fetchImage(url).then(bytes => ({ url, bytes }))));
        const imageAssetMap = new Map();
        for (const { url, bytes } of fetchedImages) {
            if (bytes) {
                try {
                    const image = await pdfDoc.embedPng(bytes).catch(() => pdfDoc.embedJpg(bytes));
                    imageAssetMap.set(url, image);
                } catch (err) { console.error(`Error embedding image for URL ${url}:`, err); }
            }
        }
        const assets = { pdfDoc, thaiFont, imageAssetMap, template };

        // <<< FIX: เปลี่ยน Logic การจัดวางใหม่ทั้งหมด ---
        for (let i = 0; i < employees.length; i++) {
            const employee = employees[i];
            const page = pdfDoc.addPage([pt(spec.width), pt(spec.height)]);

            const bg = imageAssetMap.get(template.background_front_url);
            if (bg) page.drawImage(bg, { x: 0, y: 0, width: page.getWidth(), height: page.getHeight() });
            
            // 1. หา "ดัชนีกลุ่ม" (0, 1, 2, ...) โดยการหารด้วย 3
            const groupIndex = Math.floor(i / 3);
            
            // 2. ตรวจสอบว่ากลุ่มเป็นเลขคู่หรือไม่ (กลุ่ม 0, 2, 4... คือกลุ่มซ้าย)
            const isLeftGroup = (groupIndex % 2 === 0);
            
            let baseX;
            if (isLeftGroup) {
                // กลุ่มซ้าย (พนักงาน 1-3, 7-9, ...)
                baseX = spec.safeMargin;
            } else {
                // กลุ่มขวา (พนักงาน 4-6, 10-12, ...)
                baseX = spec.width - spec.safeMargin - PAIR_WIDTH;
            }
            
            // จัดวางกึ่งกลางแนวตั้ง
            const baseY = (spec.height - card_h) / 2;

            // วาดองค์ประกอบของบัตร (Logic เดิม)
            try {
                await drawElements(page, template.layout_config_front, baseX, baseY, scaleX, scaleY, assets, employee);
                await drawElements(page, template.layout_config_back, baseX + card_w, baseY, scaleX, scaleY, assets, employee);
                
                if (guideType === "border") {
                    drawCardBorder(page, baseX, baseY, card_w, card_h, borderColor);
                    drawCardBorder(page, baseX + card_w, baseY, card_w, card_h, borderColor);
                } else if (guideType === "cropmark") {
                    drawCropMarks(page, baseX, baseY, card_w, card_h, borderColor);
                    drawCropMarks(page, baseX + card_w, baseY, card_w, card_h, borderColor);
                }
            } catch (cellErr) {
                console.error('Draw cell error:', cellErr, { empID: employee?.employee_id });
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
