const { PDFDocument, rgb } = require('pdf-lib');
const fontkit = require('@pdf-lib/fontkit');
const fs = require('fs/promises');
const path = require('path');
const fetch = require('node-fetch');
const QRCode = require('qrcode');

// --- Helper Functions (ไม่มีการเปลี่ยนแปลง) ---
const pt = mm => (mm * 72) / 25.4;
const PAPER_SPECS = { /* ... */ };
function drawCropMarks(page, absX, absY, card_w, card_h, color) { /* ... */ }
function drawCardBorder(page, absX, absY, card_w, card_h, color) { /* ... */ }
// --- จบ Helper Functions ---


// <<< FIX 1: ปรับปรุงฟังก์ชัน fetchImage ให้มีการจำกัดเวลา (Timeout)
const fetchImage = async (url) => {
    if (!url) return null; // ถ้าไม่มี URL ให้ข้ามไปเลย
    const controller = new AbortController();
    const timeout = setTimeout(() => {
        controller.abort();
    }, 5000); // กำหนด Timeout ที่ 5 วินาที

    try {
        const response = await fetch(url, { signal: controller.signal });
        if (!response.ok) {
            console.warn(`Failed to fetch image: ${url}, Status: ${response.status}`);
            return null;
        }
        return response.arrayBuffer();
    } catch (error) {
        if (error.name === 'AbortError') {
            console.warn(`Image fetch timed out: ${url}`);
        } else {
            console.error(`Error fetching image ${url}:`, error.message);
        }
        return null;
    } finally {
        clearTimeout(timeout);
    }
};

const drawElements = async (page, layoutConfig, absX, absY, scaleX, scaleY, assets, employee) => {
    // ... (โค้ดใน drawElements ไม่มีการเปลี่ยนแปลง)
};


exports.handler = async (event) => {
    // <<< FIX 2: เพิ่ม Log เพื่อติดตามการทำงาน
    console.log("Function invoked. Parsing request body...");
    
    let data;
    try {
        data = JSON.parse(event.body);
    } catch (error) {
        console.error("Failed to parse JSON body:", error);
        return { statusCode: 400, body: JSON.stringify({ message: 'Invalid or empty JSON body.', error: error.message }) };
    }

    const { template, employees, paperSize = "A4", guideType = "border" } = data || {};
    if (!template || !employees || employees.length === 0) {
        console.warn("Request validation failed: Missing template or employees.");
        return { statusCode: 400, body: JSON.stringify({ message: 'Missing required fields: template or employees.' }) };
    }

    console.log(`Processing ${employees.length} employee(s) for template "${template.id || 'N/A'}".`);

    const spec = PAPER_SPECS[paperSize] || PAPER_SPECS.A4;
    // ... (โค้ดส่วนคำนวณขนาดไม่มีการเปลี่ยนแปลง)

    try {
        console.log("Creating PDF document and registering fontkit...");
        const pdfDoc = await PDFDocument.create();
        pdfDoc.registerFontkit(fontkit);
        
        console.log("Loading font file...");
        const fontPath = path.resolve(process.cwd(), 'fonts/Noto_Sans_Thai/noto-sans-thai-latin-ext-400-normal.woff');
        const fontBytes = await fs.readFile(fontPath);
        const thaiFont = await pdfDoc.embedFont(fontBytes);
        console.log("Font loaded successfully.");

        // --- Load images ---
        const imageUrls = new Set();
        if (template.logo_url) imageUrls.add(template.logo_url);
        if (template.background_front_url) imageUrls.add(template.background_front_url);
        if (template.background_back_url) imageUrls.add(template.background_back_url);
        employees.forEach(emp => { if (emp.photo_url) imageUrls.add(emp.photo_url); });
        
        console.log(`Fetching ${imageUrls.size} unique images...`);
        const fetchedImages = await Promise.all(Array.from(imageUrls).map(url => fetchImage(url).then(bytes => ({ url, bytes }))));
        console.log("Image fetching complete.");

        const imageAssetMap = new Map();
        for (const { url, bytes } of fetchedImages) {
            if (bytes) {
                try {
                    const image = await pdfDoc.embedPng(bytes).catch(() => pdfDoc.embedJpg(bytes));
                    imageAssetMap.set(url, image);
                } catch (err) {
                    console.error(`Error embedding image for URL ${url}:`, err.message);
                }
            }
        }
        console.log("Image embedding complete.");
        const assets = { pdfDoc, thaiFont, imageAssetMap, template };

        // --- Start PDF Generation Loop ---
        console.log("Starting to draw pages...");
        let i = 0;
        while (i < employees.length) {
            const page = pdfDoc.addPage([pt(spec.width), pt(spec.height)]);
            // ... (โค้ดส่วนที่เหลือใน Loop ไม่มีการเปลี่ยนแปลง)
        }
        console.log("Page drawing finished.");

        console.log("Saving PDF document...");
        const pdfBytes = await pdfDoc.save();
        console.log("PDF saved successfully. Returning response.");
        return {
            statusCode: 200,
            headers: { 'Content-Type': 'application/pdf' },
            body: Buffer.from(pdfBytes).toString('base64'),
            isBase64Encoded: true
        };
    } catch (error) {
        console.error('An unhandled error occurred during PDF generation:', error);
        return {
            statusCode: 500,
            body: JSON.stringify({ message: "Error generating PDF: " + error.message, stack: error.stack })
        };
    }
};
