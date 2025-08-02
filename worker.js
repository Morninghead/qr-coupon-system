// worker.js

// --- Imports ---
const express = require('express');
const { createClient } = require('@supabase/supabase-js');
const { PDFDocument } = require('pdf-lib');
const QRCode = require('qrcode');
const chromium = require('@sparticuz/chromium');
const puppeteer = require('puppeteer-core');
require('dotenv').config(); // For local development

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
// --- PDF GENERATION LOGIC (MATCHES YOUR SCHEMA) ---
// =========================================================================

/**
 * Generates the HTML for a single employee card based on the template layout.
 */
const generateCardHtml = async (employee, template) => {
    // Fallback for Photo URL
    let finalPhotoUrl;
    if (employee.photo_url) {
        finalPhotoUrl = employee.photo_url;
    } else {
        const placeholderText = `No Photo\\nID: ${employee.employee_id}`;
        finalPhotoUrl = `https://placehold.co/400x400/EFEFEF/AAAAAA?text=${encodeURIComponent(placeholderText)}`;
    }

    // Fallback for QR Code
    let finalQrCodeUrl;
    if (employee.permanent_token) {
        const qrCodeData = `https://ssth-ecoupon.netlify.app/scanner?token=${employee.permanent_token}`;
        finalQrCodeUrl = await QRCode.toDataURL(qrCodeData, { errorCorrectionLevel: 'H', width: 256, margin: 1 });
    } else {
        finalQrCodeUrl = `https://placehold.co/256x256/EFEFEF/AAAAAA?text=No+QR+Code`;
    }

    const layout = template.layout_config_front || {};
    let elementsHtml = '';

    if (template.background_front_url) {
        elementsHtml += `<img src="${template.background_front_url}" style="position:absolute; top:0; left:0; width:100%; height:100%; object-fit:cover; z-index:0;">`;
    }

    let contentWrapper = '<div style="position:relative; width:100%; height:100%; z-index:1; overflow:hidden;">';
    for (const key in layout) {
        const style = layout[key];
        let content = '';
        // Convert pixel-based layout from editor to percentage for robust rendering
        const inlineStyle = `
            position: absolute;
            left: ${(style.x / template.canvas_width_px * 100).toFixed(4)}%;
            top: ${(style.y / template.canvas_height_px * 100).toFixed(4)}%;
            width: ${(style.width / template.canvas_width_px * 100).toFixed(4)}%;
            height: ${(style.height / template.canvas_height_px * 100).toFixed(4)}%;
            font-size: ${style.fontSize || 16}px;
            font-family: ${style.fontFamily || 'sans-serif'};
            color: ${style.fill || '#000'};
            box-sizing: border-box;
            display: flex;
            align-items: center;
            justify-content: center;
            text-align: center;
        `;

        const elementType = key.split('-')[0];

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
            contentWrapper += `<div style="${inlineStyle}">${content}</div>`;
        }
    }
    contentWrapper += '</div>';
    
    const canvasWidth = template.canvas_width_px || (template.orientation === 'portrait' ? 255 : 405);
    const canvasHeight = template.canvas_height_px || (template.orientation === 'portrait' ? 405 : 255);

    return `
        <html>
            <head>
                <style>
                    body,html{margin:0;padding:0;font-family:sans-serif; width:${canvasWidth}px; height:${canvasHeight}px;}
                    span{width:100%;padding:2px;}
                </style>
            </head>
            <body>${elementsHtml}${contentWrapper}</body>
        </html>
    `;
};


async function generatePdfForJob(job) {
    const { template, employees } = job.payload;
    const doc = await PDFDocument.create();
    let browser = null;

    try {
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
        const SPACING = 4;

        const CARDS_PER_ROW = Math.floor((PAGE_WIDTH - 2 * MARGIN + SPACING) / (CARD_WIDTH + SPACING));
        const CARDS_PER_COL = Math.floor((PAGE_HEIGHT - 2 * MARGIN + SPACING) / (CARD_HEIGHT + SPACING));
        const CARDS_PER_PAGE = CARDS_PER_ROW * CARDS_PER_COL;
        
        const canvasWidth = template.canvas_width_px || (isPortrait ? 255 : 405);
        const canvasHeight = template.canvas_height_px || (isPortrait ? 405 : 255);
        await page.setViewport({ width: canvasWidth, height: canvasHeight });

        let cardCount = 0;
        let currentPage = null;

        for (const employee of employees) {
            if (cardCount % CARDS_PER_PAGE === 0) {
                currentPage = doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
            }

            const cardHtml = await generateCardHtml(employee, template);
            await page.setContent(cardHtml, { waitUntil: 'networkidle0' });
            const screenshotBuffer = await page.screenshot({ type: 'jpeg', quality: 95 });

            const indexOnPage = cardCount % CARDS_PER_PAGE;
            const col = indexOnPage % CARDS_PER_ROW;
            const row = Math.floor(indexOnPage / CARDS_PER_ROW);
            const x = MARGIN + col * (CARD_WIDTH + SPACING);
            const y = PAGE_HEIGHT - MARGIN - CARD_HEIGHT - row * (CARD_HEIGHT + SPACING);

            const jpgImage = await doc.embedJpg(screenshotBuffer);
            currentPage.drawImage(jpgImage, { x, y, width: CARD_WIDTH, height: CARD_HEIGHT });
            
            cardCount++;
        }
        
        const pdfBytes = await doc.save();
        return { pdfBytes };

    } finally {
        if (browser) {
            await browser.close();
        }
    }
}


// =========================================================================
// --- WORKER QUEUE LOGIC (No changes needed) ---
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