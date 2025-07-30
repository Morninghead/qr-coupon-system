// /netlify/functions/generate-bulk-pdf.js

const { PDFDocument, rgb } = require('pdf-lib');
const fontkit = require('@pdf-lib/fontkit');
const fs = require('fs/promises');
const path = require('path');
const fetch = require('node-fetch');
const QRCode = require('qrcode');

const pt = mm => (mm * 72) / 25.4; // มม. --> pt

const PAPER_SPECS = {
  A4: { width: 210, height: 297, usableWidth: 200, usableHeight: 287, safeMargin: 5 },
  A3: { width: 297, height: 420, usableWidth: 287, usableHeight: 410, safeMargin: 5 }
};
const CARD_WIDTH = 85.6;
const CARD_HEIGHT = 54;
// คู่วางแนวนอน
const COUPLE_WIDTH = CARD_WIDTH * 2; // 171.2 mm (คู่ 1 คน)
const COUPLE_HEIGHT = CARD_HEIGHT;

const fetchImage = async (url) => {
    try {
        const response = await fetch(url);
        if (!response.ok) return null;
        return response.arrayBuffer();
    } catch (error) {
        return null;
    }
};

const drawElements = async (page, layoutConfig, assets, employee) => {
    const { pdfDoc, thaiFont, imageAssetMap } = assets;
    for (const id in layoutConfig) {
        const config = layoutConfig[id];
        const type = id.split('-')[0];
        let text = '', imageBuffer;

        switch (type) {
            case 'employee_name': text = employee.name || ''; break;
            case 'employee_id': text = employee.employee_id || ''; break;
            case 'department_name': text = employee.department_name || ''; break;
            case 'text': text = config.text || ''; break;
            case 'logo': imageBuffer = imageAssetMap.get(assets.template.logo_url); break;
            case 'photo': imageBuffer = imageAssetMap.get(employee.photo_url); break;
            case 'qr_code':
                const qrData = employee.employee_id || 'no-id';
                const qrImageBuffer = await QRCode.toBuffer(qrData, { type: 'png' });
                imageBuffer = { image: await pdfDoc.embedPng(qrImageBuffer), isQr: true };
                break;
        }
        const x = pt(config.x), y = page.getHeight() - pt(config.y);
        if (imageBuffer) {
            const image = imageBuffer.isQr ? imageBuffer.image : imageBuffer;
            if (image) page.drawImage(image, { x, y: y - pt(config.height), width: pt(config.width), height: pt(config.height) });
        } else if (text) {
            const fontSize = pt(config.fontSize || 12);
            page.drawText(text, { x, y: y - fontSize, font: thaiFont, size: fontSize, color: rgb(0, 0, 0) });
        }
    }
};

exports.handler = async (event) => {
    const { template, employees, paperSize = "A4" } = JSON.parse(event.body);
    if (!template || !employees || !employees.length) {
        return { statusCode: 400, body: JSON.stringify({ message: 'Missing data.' }) };
    }
    const spec = PAPER_SPECS[paperSize] || PAPER_SPECS.A4;

    try {
        const pdfDoc = await PDFDocument.create();
        pdfDoc.registerFontkit(fontkit);
        const fontPath = path.resolve(process.cwd(), 'fonts/Noto_Sans_Thai/noto-sans-thai-latin-ext-400-normal.woff');
        const fontBytes = await fs.readFile(fontPath);
        const thaiFont = await pdfDoc.embedFont(fontBytes);

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
                } catch {}
            }
        }

        // วนแบ่งหน้าอัตโนมัติ
        const maxCol = Math.floor(spec.usableWidth / COUPLE_WIDTH);
        const maxRow = Math.floor(spec.usableHeight / COUPLE_HEIGHT);
        const perPage = maxCol * maxRow;

        const assets = { pdfDoc, thaiFont, imageAssetMap, template };
        let i=0;
        while (i < employees.length) {
            // สร้างหน้าใหม่
            const pageFront = pdfDoc.addPage([pt(spec.width), pt(spec.height)]);
            const pageBack = pdfDoc.addPage([pt(spec.width), pt(spec.height)]);
            const bgFront = imageAssetMap.get(template.background_front_url);
            const bgBack = imageAssetMap.get(template.background_back_url);
            if (bgFront) pageFront.drawImage(bgFront, { x: 0, y: 0, width: pageFront.getWidth(), height: pageFront.getHeight() });
            if (bgBack) pageBack.drawImage(bgBack, { x: 0, y: 0, width: pageBack.getWidth(), height: pageBack.getHeight() });

            for (let row = 0; row < maxRow; row++) {
                for (let col = 0; col < maxCol; col++) {
                    if (i >= employees.length) break;
                    // คำนวณตำแหน่ง (ไล่จากซ้ายบน)
                    const offsetX = pt(spec.safeMargin + col*COUPLE_WIDTH);
                    const offsetY = pt(spec.safeMargin + row*COUPLE_HEIGHT);

                    // วาด front
                    const layoutFront = Object.assign({}, template.layout_config_front);
                    for (const key in layoutFront) {
                        layoutFront[key] = Object.assign({}, layoutFront[key]);
                        layoutFront[key].x += spec.safeMargin + col*COUPLE_WIDTH;
                        layoutFront[key].y += spec.safeMargin + row*COUPLE_HEIGHT;
                    }
                    await drawElements(pageFront, layoutFront, assets, employees[i]);

                    // วาด back (mirror position)
                    const layoutBack = Object.assign({}, template.layout_config_back);
                    for (const key in layoutBack) {
                        layoutBack[key] = Object.assign({}, layoutBack[key]);
                        layoutBack[key].x += spec.safeMargin + col*COUPLE_WIDTH;
                        layoutBack[key].y += spec.safeMargin + row*COUPLE_HEIGHT;
                    }
                    await drawElements(pageBack, layoutBack, assets, employees[i]);
                    i++;
                }
            }
        }

        const pdfBytes = await pdfDoc.save();

        return {
            statusCode: 200,
            headers: { 'Content-Type': 'application/pdf' },
            body: Buffer.from(pdfBytes).toString('base64'),
            isBase64Encoded: true,
        };

    } catch (error) {
        console.error('PDF Generation Error:', error);
        return { statusCode: 500, body: JSON.stringify({ message: `Error generating PDF: ${error.message}` }) };
    }
};
