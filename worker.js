// worker.js

// --- Imports ---
const express = require('express');
const { createClient } = require('@supabase/supabase-js');
const { PDFDocument } = require('pdf-lib');
const QRCode = require('qrcode');
const chromium = require('@sparticuz/chromium');
const puppeteer = require('puppeteer-core');
require('dotenv').config();

// --- Express App Setup ---
const app = express();
const PORT = process.env.PORT || 3000;
app.get('/', (req, res) => {
    res.status(200).send('PDF Worker is alive and polling for jobs.');
});

// --- Supabase Admin Client Setup ---
const supabaseUrl = process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = createClient(supabaseUrl, serviceKey);

// =========================================================================
// --- PDF GENERATION LOGIC (REVISED FOR RELIABILITY) ---
// =========================================================================

// NEW: Define reference canvas dimensions used by the card editor.
const CANVAS_DIMENSIONS = {
    portrait: { width: 255, height: 405 },
    landscape: { width: 405, height: 255 }
};

/**
 * Generates the HTML for a single card side (front or back).
 */
const generateCardHtml = async (employee, template, side) => {
    console.log(`--- Generating HTML for Employee ID: ${employee.employee_id}, Side: ${side} ---`);

    const layoutConfig = side === 'front' ? template.layout_config_front : template.layout_config_back;
    const backgroundUrl = side === 'front' ? template.background_front_url : template.background_back_url;

    if (!layoutConfig || Object.keys(layoutConfig).length === 0) {
        console.log(`No layout_config found for side: ${side}. Returning empty page.`);
        return `<html><body></body></html>`;
    }

    // --- Asset Fallbacks ---
    let finalPhotoUrl;
    if (employee.photo_url) {
        finalPhotoUrl = employee.photo_url;
    } else {
        const placeholderText = `No Photo\\nID: ${employee.employee_id}`;
        finalPhotoUrl = `https://placehold.co/400x400/EFEFEF/AAAAAA?text=${encodeURIComponent(placeholderText)}`;
    }

    let finalQrCodeUrl;
    if (employee.permanent_token) {
        const qrCodeData = `https://ssth-ecoupon.netlify.app/scanner?token=${employee.permanent_token}`;
        finalQrCodeUrl = await QRCode.toDataURL(qrCodeData, { errorCorrectionLevel: 'H', width: 256, margin: 1 });
    } else {
        finalQrCodeUrl = `https://placehold.co/256x256/EFEFEF/AAAAAA?text=No+QR+Code`;
    }

    // --- HTML and CSS Generation ---
    const canvas = CANVAS_DIMENSIONS[template.orientation] || CANVAS_DIMENSIONS.landscape;
    console.log(`Using canvas dimensions for percentage calculation: ${canvas.width}x${canvas.height}`);
    
    let elementsHtml = '';
    if (backgroundUrl) {
        elementsHtml += `<img src="${backgroundUrl}" style="position:absolute; top:0; left:0; width:100%; height:100%; object-fit:cover; z-index: -1;">`;
    }

    for (const key in layoutConfig) {
        const style = layoutConfig[key];
        const elementType = key.split('-')[0];
        
        // LOGGING: Log each element's style calculation
        const leftPercent = (style.x / canvas.width * 100).toFixed(4);
        const topPercent = (style.y / canvas.height * 100).toFixed(4);
        const widthPercent = (style.width / canvas.width * 100).toFixed(4);
        const heightPercent = (style.height / canvas.height * 100).toFixed(4);
        
        const inlineStyle = `
            position: absolute;
            left: ${leftPercent}%;
            top: ${topPercent}%;
            width: ${widthPercent}%;
            height: ${heightPercent}%;
            font-size: ${style.fontSize || 16}px;
            font-family: ${style.fontFamily || 'sans-serif'};
            color: ${style.fill || '#000'};
            box-sizing: border-box;
            display: flex;
            align-items: center;
            justify-content: center;
            text-align: center;
            overflow: hidden;
        `;
        console.log(`Element: ${key}, Style: left=${leftPercent}%, top=${topPercent}%`);

        let content = '';
        switch (elementType) {
            case 'photo':
                content = `<img src="${finalPhotoUrl}" style="width:100%; height:100%; object-fit:cover; display:block;" />`;
                break;
            case 'logo':
                content = `<img src="${template.logo_url || ''}" style="width:100%; height:100%; object-fit:contain; display:block;" />`;
                break;
            case 'employee_name':
                content = `<span>${employee.name}</span>`;
                break;
            case 'employee_id':
                content = `<span>${employee.employee_id}</span>`;
                break;
            case 'department_name':
                content = `<span>${employee.department_name || ''}</span>`;
                break;
            case 'qr_code':
                content = `<img src="${finalQrCodeUrl}" style="width:100%; height:100%; object-fit:contain; display:block;" />`;
                break;
            case 'text':
                if (style.text) content = `<span>${style.text}</span>`;
                break;
        }
        if (content) {
            elementsHtml += `<div style="${inlineStyle}">${content}</div>`;
        }
    }

    return `
        <html>
            <head><style>body,html{margin:0;padding:0;font-family:sans-serif; width:${canvas.width}px; height:${canvas.height}px; position:relative;}</style></head>
            <body>${elementsHtml}</body>
        </html>
    `;
};


async function generatePdfForJob(job) {
    // This function remains the same as the previous version
    const { template, employees } = job.payload;
    const doc = await PDFDocument.create();
    let browser = null;
    try {
        console.log('Starting PDF generation process for job:', job.id);
        console.log('Template received:', template.template_name);
        console.log('Processing employees:', employees.map(e => e.employee_id));

        browser = await puppeteer.launch({
            args: chromium.args,
            defaultViewport: chromium.defaultViewport,
            executablePath: await chromium.executablePath(),
            headless: chromium.headless,
        });
        
        const page = await browser.newPage();

        const isPortrait = template.orientation === 'portrait';
        const CARD_WIDTH = isPortrait ? 53.98 : 85.6;
        const CARD_HEIGHT = isPortrait ? 85.6 : 53.98;
        const PAGE_WIDTH = 210;
        const PAGE_HEIGHT = 297;
        const MARGIN = 10;
        const SPACING = 0; // Set to 0 for edge-to-edge printing with crop marks in mind
        const CARDS_PER_ROW = Math.floor((PAGE_WIDTH - 2 * MARGIN) / (CARD_WIDTH * 2));
        const PAIRS_PER_PAGE = Math.floor((PAGE_HEIGHT - 2 * MARGIN) / CARD_HEIGHT) * CARDS_PER_ROW;

        const canvas = CANVAS_DIMENSIONS[template.orientation] || CANVAS_DIMENSIONS.landscape;
        await page.setViewport({ width: canvas.width, height: canvas.height });

        let cardCount = 0;
        let currentPage = null;

        for (const employee of employees) {
            if (cardCount % PAIRS_PER_PAGE === 0) {
                currentPage = doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
            }

            const frontHtml = await generateCardHtml(employee, template, 'front');
            await page.setContent(frontHtml, { waitUntil: 'networkidle0' });
            const frontImageBuffer = await page.screenshot({ type: 'jpeg', quality: 95 });

            const backHtml = await generateCardHtml(employee, template, 'back');
            await page.setContent(backHtml, { waitUntil: 'networkidle0' });
            const backImageBuffer = await page.screenshot({ type: 'jpeg', quality: 95 });

            const indexOnPage = cardCount % PAIRS_PER_PAGE;
            const row = Math.floor(indexOnPage / CARDS_PER_ROW);
            const col = indexOnPage % CARDS_PER_ROW;
            
            const x_front = MARGIN + col * (CARD_WIDTH * 2 + SPACING);
            const y_pos = PAGE_HEIGHT - MARGIN - CARD_HEIGHT - row * (CARD_HEIGHT + SPACING);
            
            const frontImage = await doc.embedJpg(frontImageBuffer);
            currentPage.drawImage(frontImage, { x: x_front, y: y_pos, width: CARD_WIDTH, height: CARD_HEIGHT });
            
            const backImage = await doc.embedJpg(backImageBuffer);
            currentPage.drawImage(backImage, { x: x_front + CARD_WIDTH, y: y_pos, width: CARD_WIDTH, height: CARD_HEIGHT });

            cardCount++;
        }
        
        const pdfBytes = await doc.save();
        return { pdfBytes };
    } finally {
        if (browser) await browser.close();
    }
}


// =========================================================================
// --- WORKER QUEUE LOGIC (No changes) ---
// =========================================================================
async function processQueue() {
    console.log(`[${new Date().toISOString()}] Checking for new jobs...`);
    const { data: job, error: findError } = await supabase.from('pdf_generation_jobs').select('*').eq('status', 'pending').limit(1).single();
    if (!job) {
        if (findError && findError.code !== 'PGRST116') console.error('Error finding job:', findError);
        return;
    }
    console.log(`Found job ${job.id}. Starting to process...`);
    await supabase.from('pdf_generation_jobs').update({ status: 'processing' }).eq('id', job.id);
    try {
        const { pdfBytes } = await generatePdfForJob(job);
        const filePath = `public/pdfs/${job.id}.pdf`;
        const { error: uploadError } = await supabase.storage.from('documents').upload(filePath, pdfBytes, { contentType: 'application/pdf', upsert: true });
        if (uploadError) throw uploadError;
        const { data: urlData } = supabase.storage.from('documents').getPublicUrl(filePath);
        await supabase.from('pdf_generation_jobs').update({ status: 'completed', result_url: urlData.publicUrl }).eq('id', job.id);
        console.log(`Job ${job.id} completed successfully.`);
    } catch (error) {
        console.error(`Failed to process job ${job.id}:`, error);
        await supabase.from('pdf_generation_jobs').update({ status: 'failed', error_message: error.message }).eq('id', job.id);
    }
}

// --- Start the server and the polling interval ---
app.listen(PORT, () => {
    console.log(`Web service listening on port ${PORT}`);
    console.log('Starting PDF Worker polling...');
    setInterval(processQueue, 15000);
});