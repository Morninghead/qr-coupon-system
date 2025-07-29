// /netlify/functions/generate-bulk-pdf.js

const { PDFDocument, rgb } = require('pdf-lib');
const fontkit = require('@pdf-lib/fontkit');
const fs = require('fs/promises');
const path = require('path');
const fetch = require('node-fetch');
const QRCode = require('qrcode');

const pt = (px) => (px * 72) / 96;

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

const drawElements = async (page, layoutConfig, assets, employee) => {
    const { pdfDoc, thaiFont, imageAssetMap } = assets;

    for (const id in layoutConfig) {
        const config = layoutConfig[id];
        const type = id.split('-')[0];
        
        let text = '';
        let imageBuffer;

        switch (type) {
            case 'employee_name': text = employee.name || ''; break;
            case 'employee_id': text = employee.employee_id || ''; break;
            case 'department_name': text = employee.department_name || ''; break;
            case 'text': text = config.text || ''; break;
            case 'logo': imageBuffer = imageAssetMap.get(assets.template.logo_url); break;
            case 'photo': imageBuffer = imageAssetMap.get(employee.photo_url); break;
            case 'qr_code':
                const qrData = employee.employee_id || 'no-id'; // Use employee ID for QR code
                const qrImageBuffer = await QRCode.toBuffer(qrData, { type: 'png' });
                imageBuffer = { image: await pdfDoc.embedPng(qrImageBuffer), isQr: true };
                break;
        }
        
        const x = pt(config.x);
        const y = page.getHeight() - pt(config.y);

        if (imageBuffer) {
            const image = imageBuffer.isQr ? imageBuffer.image : imageBuffer;
            if (image) {
                 page.drawImage(image, { x, y: y - pt(config.height), width: pt(config.width), height: pt(config.height) });
            }
        } else if (text) {
             const fontSize = pt(config.fontSize || 12);
             page.drawText(text, { x, y: y - fontSize, font: thaiFont, size: fontSize, color: rgb(0, 0, 0) });
        }
    }
};


exports.handler = async (event) => {
    const { template, employees } = JSON.parse(event.body);
    if (!template || !employees || !employees.length) {
        return { statusCode: 400, body: JSON.stringify({ message: 'Missing data.' }) };
    }

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

        const imagePromises = Array.from(imageUrls).map(url => fetchImage(url).then(bytes => ({ url, bytes })));
        const fetchedImages = await Promise.all(imagePromises);
        
        const imageAssetMap = new Map();
        for (const { url, bytes } of fetchedImages) {
            if (bytes) {
                try {
                    const image = await pdfDoc.embedPng(bytes).catch(() => pdfDoc.embedJpg(bytes));
                    imageAssetMap.set(url, image);
                } catch (e) { console.warn(`Failed to embed image from ${url}`); }
            }
        }

        const assets = { pdfDoc, thaiFont, imageAssetMap, template };
        const cardWidth = pt(template.orientation === 'landscape' ? 405 : 255);
        const cardHeight = pt(template.orientation === 'landscape' ? 255 : 405);

        for (const employee of employees) {
            // --- Draw Front Page ---
            const pageFront = pdfDoc.addPage([cardWidth, cardHeight]);
            const bgFront = imageAssetMap.get(template.background_front_url);
            if (bgFront) pageFront.drawImage(bgFront, { x: 0, y: 0, width: cardWidth, height: cardHeight });
            await drawElements(pageFront, template.layout_config_front, assets, employee);

            // --- Draw Back Page ---
            const pageBack = pdfDoc.addPage([cardWidth, cardHeight]);
            const bgBack = imageAssetMap.get(template.background_back_url);
            if (bgBack) pageBack.drawImage(bgBack, { x: 0, y: 0, width: cardWidth, height: cardHeight });
            await drawElements(pageBack, template.layout_config_back, assets, employee);
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
