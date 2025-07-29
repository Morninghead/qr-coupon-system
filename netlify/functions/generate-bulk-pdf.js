// /netlify/functions/generate-bulk-pdf.js

const { PDFDocument, rgb } = require('pdf-lib');
const fontkit = require('@pdf-lib/fontkit');
const fs = require('fs/promises');
const path = require('path');
const fetch = require('node-fetch');

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

exports.handler = async (event) => {
    // Your authentication logic here...
    
    const { template, employees } = JSON.parse(event.body);
    if (!template || !employees || employees.length === 0) {
        return { statusCode: 400, body: JSON.stringify({ message: 'Missing data.' }) };
    }

    try {
        const pdfDoc = await PDFDocument.create();
        pdfDoc.registerFontkit(fontkit);

        // *** THE DEFINITIVE FIX: Updated the font path to match your directory structure ***
        const fontPath = path.resolve(process.cwd(), 'fonts/Noto_Sans_Thai/noto-sans-thai-latin-ext-400-normal.woff');
        
        const fontBytes = await fs.readFile(fontPath);
        const thaiFont = await pdfDoc.embedFont(fontBytes);

        const imageUrls = new Set();
        if (template.logo_url) imageUrls.add(template.logo_url);
        if (template.background_front_url) imageUrls.add(template.background_front_url);
        employees.forEach(emp => { if (emp.photo_url) imageUrls.add(emp.photo_url); });

        const imagePromises = Array.from(imageUrls).map(url => fetchImage(url).then(bytes => ({ url, bytes })));
        const fetchedImages = await Promise.all(imagePromises);
        
        const imageAssetMap = new Map();
        for (const { url, bytes } of fetchedImages) {
            if (bytes) {
                try {
                    const image = await pdfDoc.embedPng(bytes).catch(() => pdfDoc.embedJpg(bytes));
                    imageAssetMap.set(url, image);
                } catch (e) {
                    console.warn(`Failed to embed image from ${url}: ${e.message}`);
                }
            }
        }

        for (const employee of employees) {
            const cardWidth = pt(template.orientation === 'landscape' ? 405 : 255);
            const cardHeight = pt(template.orientation === 'landscape' ? 255 : 405);
            
            const pageFront = pdfDoc.addPage([cardWidth, cardHeight]);
            const bgFront = imageAssetMap.get(template.background_front_url);
            if (bgFront) {
                pageFront.drawImage(bgFront, { x: 0, y: 0, width: pageFront.getWidth(), height: pageFront.getHeight() });
            }

            for (const id in template.layout_config_front) {
                const config = template.layout_config_front[id];
                const type = id.split('-')[0];
                
                let text = '';
                let image;

                switch (type) {
                    case 'employee_name': text = employee.name || ''; break;
                    case 'employee_id': text = employee.employee_id || ''; break;
                    case 'department_name': text = employee.department_name || ''; break;
                    case 'text': text = config.text || ''; break;
                    case 'logo': image = imageAssetMap.get(template.logo_url); break;
                    case 'photo': image = imageAssetMap.get(employee.photo_url); break;
                }
                
                const x = pt(config.x);
                const y = pageFront.getHeight() - pt(config.y);

                if (image) {
                    pageFront.drawImage(image, { x, y: y - pt(config.height), width: pt(config.width), height: pt(config.height) });
                } else if (text) {
                     pageFront.drawText(text, { x, y: y - pt(config.fontSize || 12), font: thaiFont, size: pt(config.fontSize || 12), color: rgb(0, 0, 0) });
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
