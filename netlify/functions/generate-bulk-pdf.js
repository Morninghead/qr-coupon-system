// /netlify/functions/generate-bulk-pdf.js

import { PDFDocument, rgb } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import fs from 'fs/promises'; // Use promise-based fs for modern async/await
import path from 'path';
import fetch from 'node-fetch';

// Helper to convert pixels to points for PDF (assuming 96 DPI common for web)
const pt = (px) => (px * 72) / 96;

const fetchImage = async (url) => {
    try {
        const response = await fetch(url);
        if (!response.ok) throw new Error(`Failed to fetch image: ${response.statusText}`);
        return response.arrayBuffer();
    } catch (error) {
        console.warn(`Could not fetch image at ${url}: ${error.message}`);
        return null; // Return null if an image fails to load
    }
};

export const handler = async (event) => {
    // Add your standard authentication logic here
    // const { user } = await authenticate(event); 
    
    const { template, employees } = JSON.parse(event.body);
    if (!template || !employees || employees.length === 0) {
        return { statusCode: 400, body: JSON.stringify({ message: 'Missing template or employee data.' }) };
    }

    try {
        const pdfDoc = await PDFDocument.create();
        pdfDoc.registerFontkit(fontkit);

        // Load Thai font once
        const fontPath = path.resolve(process.cwd(), 'fonts/noto-sans-thai-latin-ext-400-normal.woff');
        const fontBytes = await fs.readFile(fontPath);
        const thaiFont = await pdfDoc.embedFont(fontBytes);

        // --- Efficient Asset Loading ---
        const imageUrls = new Set();
        if (template.logo_url) imageUrls.add(template.logo_url);
        if (template.background_front_url) imageUrls.add(template.background_front_url);
        if (template.background_back_url) imageUrls.add(template.background_back_url);
        employees.forEach(emp => {
            if (emp.photo_url) imageUrls.add(emp.photo_url);
        });

        // Fetch all images concurrently
        const imagePromises = Array.from(imageUrls).map(url => fetchImage(url).then(bytes => ({ url, bytes })));
        const fetchedImages = await Promise.all(imagePromises);
        
        const imageAssetMap = new Map();
        for (const { url, bytes } of fetchedImages) {
            if (bytes) {
                try {
                     // Try embedding as PNG first, then JPG as a fallback
                    const image = await pdfDoc.embedPng(bytes).catch(() => pdfDoc.embedJpg(bytes));
                    imageAssetMap.set(url, image);
                } catch (e) {
                    console.warn(`Failed to embed image from ${url}: ${e.message}`);
                }
            }
        }
        // --- End of Efficient Asset Loading ---

        for (const employee of employees) {
            const cardWidth = pt(template.orientation === 'landscape' ? 405 : 255);
            const cardHeight = pt(template.orientation === 'landscape' ? 255 : 405);
            
            // --- Create Front Page ---
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
                const y = pageFront.getHeight() - pt(config.y); // Y is from top in config, from bottom in PDF

                if (image) {
                    pageFront.drawImage(image, { x, y: y - pt(config.height), width: pt(config.width), height: pt(config.height) });
                } else if (text) {
                     pageFront.drawText(text, { x, y: y - pt(config.fontSize || 12), font: thaiFont, size: pt(config.fontSize || 12), color: rgb(0, 0, 0) });
                }
            }
            
            // --- Create Back Page (if configured) ---
            // You can add a similar loop for layout_config_back here
        }

        const pdfBytes = await pdfDoc.save();

        return {
            statusCode: 200,
            headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': 'attachment; filename="employee-cards.pdf"' },
            body: Buffer.from(pdfBytes).toString('base64'),
            isBase64Encoded: true,
        };

    } catch (error) {
        console.error('PDF Generation Error:', error);
        return { statusCode: 500, body: JSON.stringify({ message: `Error generating PDF: ${error.message}` }) };
    }
};
