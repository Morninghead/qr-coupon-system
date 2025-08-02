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
// --- PDF GENERATION LOGIC ---
// =========================================================================

const CANVAS_DIMENSIONS = {
    portrait: { width: 255, height: 405 },
    landscape: { width: 405, height: 255 }
};

const generateCardHtml = async (employee, template, side) => {
    // This function generates the HTML for a single card side.
    const layoutConfig = side === 'front' ? template.layout_config_front : template.layout_config_back;
    const backgroundUrl = side === 'front' ? template.background_front_url : template.background_back_url;
    if (!layoutConfig || Object.keys(layoutConfig).length === 0) return `<html><body><div class="card-wrapper"></div></body></html>`;

    let finalPhotoUrl = employee.photo_url || `https://placehold.co/400x400/EFEFEF/AAAAAA?text=${encodeURIComponent(`No Photo\\nID: ${employee.employee_id}`)}`;
    let finalQrCodeUrl = employee.permanent_token 
        ? await QRCode.toDataURL(`https://ssth-ecoupon.netlify.app/scanner?token=${employee.permanent_token}`, { errorCorrectionLevel: 'H', width: 256, margin: 1 })
        : `https://placehold.co/256x256/EFEFEF/AAAAAA?text=No+QR+Code`;

    const canvas = CANVAS_DIMENSIONS[template.orientation] || CANVAS_DIMENSIONS.landscape;
    let elementsHtml = backgroundUrl ? `<img src="${backgroundUrl}" style="position:absolute; top:0; left:0; width:100%; height:100%; object-fit:cover; z-index: 0;">` : '';

    for (const key in layoutConfig) {
        const style = layoutConfig[key];
        const elementType = key.split('-')[0];
        const inlineStyle = `
            position: absolute; z-index: 1;
            left: ${(style.x / canvas.width * 100).toFixed(4)}%; top: ${(style.y / canvas.height * 100).toFixed(4)}%;
            width: ${(style.width / canvas.width * 100).toFixed(4)}%; height: ${(style.height / canvas.height * 100).toFixed(4)}%;
            font-size: ${style.fontSize || 16}px; font-family: ${style.fontFamily || 'sans-serif'};
            color: ${style.fill || '#000'}; box-sizing: border-box; display: flex;
            align-items: center; justify-content: center; text-align: center; overflow: hidden;
        `;
        
        let content = '';
        switch (elementType) {
            case 'photo': content = `<img src="${finalPhotoUrl}" style="width:100%; height:100%; object-fit:cover; display:block;" />`; break;
            case 'logo': content = `<img src="${template.logo_url || ''}" style="width:100%; height:100%; object-fit:contain; display:block;" />`; break;
            case 'employee_name': content = `<span>${employee.name}</span>`; break;
            case 'employee_id': content = `<span>${employee.employee_id}</span>`; break;
            case 'department_name': content = `<span>${employee.department_name || ''}</span>`; break;
            case 'qr_code': content = `<img src="${finalQrCodeUrl}" style="width:100%; height:100%; object-fit:contain; display:block;" />`; break;
            case 'text': if (style.text) content = `<span>${style.text}</span>`; break;
        }
        if (content) elementsHtml += `<div style="${inlineStyle}">${content}</div>`;
    }
    
    // NEW: Reliable border implementation on an inner wrapper div.
    return `
        <html>
            <head>
                <style>
                    body, html { margin:0; padding:0; font-family:sans-serif; width:${canvas.width}px; height:${canvas.height}px; }
                    .card-wrapper {
                        width: 100%; height: 100%; position: relative; overflow: hidden;
                        border: 1px solid #B0B0B0; box-sizing: border-box;
                    }
                    span { width:100%; padding:2px; }
                </style>
            </head>
            <body><div class="card-wrapper">${elementsHtml}</div></body>
        </html>
    `;
};

/**
 * Main job function - Corrected layout for 6 employees per page.
 */
async function generatePdfForJob(job) {
    const { template, employees } = job.payload;
    const doc = await PDFDocument.create();
    let browser = null;

    try {
        browser = await puppeteer.launch({
            args: chromium.args, executablePath: await chromium.executablePath(), headless: chromium.headless,
        });
        const page = await browser.newPage();

        // --- Layout Constants (in mm) ---
        const isPortrait = template.orientation === 'portrait';
        // Preserve standard aspect ratio
        const CARD_ASPECT_RATIO = isPortrait ? (53.98 / 85.6) : (85.6 / 53.98);
        
        const PAGE_WIDTH = 210; const PAGE_HEIGHT = 297; // A4
        const MARGIN = 10;
        
        // Calculate scaled dimensions to fit a 2x3 grid of pairs
        const USABLE_WIDTH = PAGE_WIDTH - (MARGIN * 2);
        const PAIR_WIDTH = USABLE_WIDTH / 2; // 2 pairs fit horizontally
        const CARD_WIDTH = PAIR_WIDTH / 2; // Each pair has a front and back
        const CARD_HEIGHT = CARD_WIDTH / CARD_ASPECT_RATIO;
        
        const PAIRS_PER_PAGE = 6;
        const CARDS_PER_ROW = 2;

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
            const row = Math.floor(indexOnPage / CARDS_PER_ROW); // 0, 0, 1, 1, 2, 2
            const col = indexOnPage % CARDS_PER_ROW;           // 0, 1, 0, 1, 0, 1
            
            const x_front = MARGIN + col * PAIR_WIDTH;
            const y_pos = PAGE_HEIGHT - MARGIN - CARD_HEIGHT - (row * CARD_HEIGHT);

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
    await supabase.from('pdf_generation_jobs').update({ status: 'processing', progress: 0, progress_message: 'Worker picked up job...' }).eq('id', job.id);
    try {
        const { pdfBytes } = await generatePdfForJob(job);
        const filePath = `public/pdfs/${job.id}.pdf`;
        const { error: uploadError } = await supabase.storage.from('documents').upload(filePath, pdfBytes, { contentType: 'application/pdf', upsert: true });
        if (uploadError) throw uploadError;
        const { data: urlData } = supabase.storage.from('documents').getPublicUrl(filePath);
        await supabase.from('pdf_generation_jobs').update({ status: 'completed', result_url: urlData.publicUrl, progress: 100, progress_message: 'Completed!' }).eq('id', job.id);
        console.log(`Job ${job.id} completed successfully.`);
    } catch (error) {
        console.error(`Failed to process job ${job.id}:`, error);
        await supabase.from('pdf_generation_jobs').update({ status: 'failed', error_message: error.message }).eq('id', job.id);
    }
}

// --- Start the server ---
app.listen(PORT, () => {
    console.log(`Web service listening on port ${PORT}`);
    console.log('Starting PDF Worker polling...');
    setInterval(processQueue, 15000);
});