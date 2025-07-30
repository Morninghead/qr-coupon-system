// /netlify/functions/generate-bulk-pdf.js

const { PDFDocument, rgb } = require('pdf-lib');
const fontkit = require('@pdf-lib/fontkit');
const fs = require('fs/promises');
const path = require('path');
const fetch = require('node-fetch');
const QRCode = require('qrcode');

const pt = mm => (mm * 72) / 25.4; // แปลง mm เป็น point สำหรับ PDF

const PAPER_SPECS = {
  A4: { width: 210, height: 297, usableWidth: 200, usableHeight: 287, safeMargin: 5 },
  A3: { width: 297, height: 420, usableWidth: 287, usableHeight: 410, safeMargin: 5 }
};

const fetchImage = async (url) => {
    try {
        const response = await fetch(url);
        if (!response.ok) return null;
        return response.arrayBuffer();
    } catch (error) {
        console.warn(`Could not fetch image at ${url}: ${error.message}`);
        return null;
    }
};

const drawElements = async (page, layoutConfig, offsetX, offsetY, scaleX, scaleY, assets, employee) => {
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
        const x = pt(offsetX + (config.x * scaleX));
        const y = page.getHeight() - pt(offsetY + (config.y * scaleY));
        const w = pt(config.width * scaleX);
        const h = pt(config.height * scaleY);

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
    const { template, employees, paperSize = "A4" } = JSON.parse(event.body);
    if (!template || !employees || employees.length === 0) {
        return { statusCode: 400, body: JSON.stringify({ message: 'Missing data.' }) };
    }

    const spec = PAPER_SPECS[paperSize] || PAPER_SPECS.A4;

    // canvas base ขนาด preview ใน px จาก card-editor
    const cpx = template.canvas_width_px || (template.orientation === "portrait" ? 255 : 405);
    const cpy = template.canvas_height_px || (template.orientation === "portrait" ? 405 : 255);

    // ขนาดบัตรจริงใน mm (CR80)
    const isPortrait = template.orientation === 'portrait';
    const target_card_width_mm  = isPortrait ? 54 : 85.6;
    const target_card_height_mm = isPortrait ? 85.6 : 54;

    // คำนวณ scale px → mm
    const scaleX = target_card_width_mm / cpx;
    const scaleY = target_card_height_mm / cpy;

    // ขนาดพื้นที่ 1 คน (2 ใบติดกันหน้า-หลัง, คู่บัตร)
    const PAIR_WIDTH = target_card_width_mm * 2;
    const PAIR_HEIGHT = target_card_height_mm;

    const maxCol = Math.floor(spec.usableWidth / PAIR_WIDTH);
    const maxRow = Math.floor(spec.usableHeight / PAIR_HEIGHT);
    const perPage = maxCol * maxRow;

    try {
        const pdfDoc = await PDFDocument.create();
        pdfDoc.registerFontkit(fontkit);

        const fontPath = path.resolve(process.cwd(), 'fonts/Noto_Sans_Thai/noto-sans-thai-latin-ext-400-normal.woff');
        const fontBytes = await fs.readFile(fontPath);
        const thaiFont = await pdfDoc.embedFont(fontBytes);

        // โหลดภาพล่วงหน้า (โลโก้, พื้นหลัง, รูปพนักงาน)
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
            const pageFront = pdfDoc.addPage([pt(spec.width), pt(spec.height)]);
            const pageBack = pdfDoc.addPage([pt(spec.width), pt(spec.height)]);
            const bgFront = imageAssetMap.get(template.background_front_url);
            const bgBack = imageAssetMap.get(template.background_back_url);
            if (bgFront) pageFront.drawImage(bgFront, { x: 0, y: 0, width: pageFront.getWidth(), height: pageFront.getHeight() });
            if (bgBack)  pageBack.drawImage(bgBack,  { x: 0, y: 0, width: pageBack.getWidth(),  height: pageBack.getHeight() });

            for (let row = 0; row < maxRow; row++) {
                for (let col = 0; col < maxCol; col++) {
                    if (i >= employees.length) break;
                    const offsetX = spec.safeMargin + col * PAIR_WIDTH;
                    const offsetY = spec.safeMargin + row * PAIR_HEIGHT;

                    await drawElements(pageFront, template.layout_config_front, offsetX, offsetY, scaleX, scaleY, assets, employees[i]);
                    await drawElements(pageBack, template.layout_config_back, offsetX, offsetY, scaleX, scaleY, assets, employees[i]);
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
