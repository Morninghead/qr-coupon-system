// /netlify/functions/generate-bulk-pdf.js

import { PDFDocument, rgb, degrees } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import fs from 'fs';
import path from 'path';
import fetch from 'node-fetch';

// Helper to convert points to pixels (assuming 72 DPI)
const pt = (px) => px * 0.75;

export const handler = async (event) => {
    // Basic Authentication/Parsing (add your full logic if needed)
    const { template, employees } = JSON.parse(event.body);
    if (!template || !employees || employees.length === 0) {
        return { statusCode: 400, body: 'Missing template or employee data.' };
    }

    try {
        const pdfDoc = await PDFDocument.create();
        pdfDoc.registerFontkit(fontkit);

        // Load Thai font from the file system
        const fontPath = path.resolve(process.cwd(), 'fonts/noto-sans-thai-latin-ext-400-normal.woff');
        const fontBytes = fs.readFileSync(fontPath);
        const thaiFont = await pdfDoc.embedFont(fontBytes);

        // Pre-load assets (logo, backgrounds) to avoid re-fetching in loop
        const assets = {};
        if (template.logo_url) {
            const logoBytes = await fetch(template.logo_url).then(res => res.arrayBuffer());
            assets.logoImage = await pdfDoc.embedPng(logoBytes);
        }
        if (template.background_front_url) {
            const bgFrontBytes = await fetch(template.background_front_url).then(res => res.arrayBuffer());
            assets.bgFrontImage = await pdfDoc.embedJpg(bgFrontBytes); // Assuming JPG, adjust if needed
        }
        // Add similar logic for background_back_url if you have it

        for (const employee of employees) {
            // --- Create Front Page ---
            const pageFront = pdfDoc.addPage([pt(template.card_width || 405), pt(template.card_height || 255)]);
            if (assets.bgFrontImage) {
                pageFront.drawImage(assets.bgFrontImage, { x: 0, y: 0, width: pageFront.getWidth(), height: pageFront.getHeight() });
            }

            for (const id in template.layout_config_front) {
                const config = template.layout_config_front[id];
                const type = id.split('-')[0];
                let text = '';
                
                switch (type) {
                    case 'employee_name': text = employee.name; break;
                    case 'employee_id': text = employee.employee_id; break;
                    case 'department_name': text = employee.department_name; break;
                    case 'text': text = config.text; break;
                    case 'logo':
                        if (assets.logoImage) {
                            pageFront.drawImage(assets.logoImage, { x: pt(config.x), y: pageFront.getHeight() - pt(config.y) - pt(config.height), width: pt(config.width), height: pt(config.height) });
                        }
                        continue; // Skip text drawing for images
                    case 'photo':
                         if (employee.photo_url) {
                            const photoBytes = await fetch(employee.photo_url).then(res => res.arrayBuffer());
                            const photoImage = await pdfDoc.embedPng(photoBytes);
                            pageFront.drawImage(photoImage, { x: pt(config.x), y: pageFront.getHeight() - pt(config.y) - pt(config.height), width: pt(config.width), height: pt(config.height) });
                        }
                        continue;
                }

                if (text) {
                    pageFront.drawText(text, {
                        x: pt(config.x),
                        y: pageFront.getHeight() - pt(config.y) - pt(config.fontSize || 12),
                        font: thaiFont,
                        size: pt(config.fontSize || 12),
                        color: rgb(0, 0, 0), // You can parse color from config
                    });
                }
            }
             // Add similar loop for back page if needed
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
