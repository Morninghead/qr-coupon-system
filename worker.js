// worker.js

// --- Imports ---
const express = require('express');
const { createClient } = require('@supabase/supabase-js');
const { PDFDocument } = require('pdf-lib');
const fontkit = require('@pdf-lib/fontkit');
const QRCode = require('qrcode');
const chromium = require('@sparticuz/chromium');
const puppeteer = require('puppeteer-core');
require('dotenv').config(); // For local development only

// --- Express App Setup ---
const app = express();
const PORT = process.env.PORT || 3000;

// Dummy endpoint to keep the service alive and for health checks.
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

/**
 * Generates the HTML for a single employee card.
 * Includes fallbacks for missing photo and QR code data.
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
        finalQrCodeUrl = await QRCode.toDataURL(qrCodeData, { errorCorrectionLevel: 'H', width: 256 });
    } else {
        finalQrCodeUrl = `https://placehold.co/256x256/EFEFEF/AAAAAA?text=No+QR+Code`;
    }

    const layout = template.layout_config_front || {};
    let elementsHtml = '';

    if (template.background_front_url) {
        elementsHtml += `<img src="${template.background_front_url}" style="position:absolute; top:0; left:0; width:100%; height:100%; object-fit:cover; z-index:0;">`;
    }

    let contentWrapper = '<div style="position:relative; width:100%; height:100%; z-index:1;">';
    for (const key in layout) {
        const style = layout[key];
        let content = '';
        let inlineStyle = `position:absolute; left:${style.left}; top:${style.top}; width:${style.width}; height:${style.height}; box-sizing:border-box;`;
        
        Object.keys(style).forEach(prop => {
            if (!['left', 'top', 'width', 'height', 'text'].includes(prop)) {
                const kebabCaseProp = prop.replace(/([A-Z])/g, "-$1").toLowerCase();
                inlineStyle += `${kebabCaseProp}:${style[prop]};`;
            }
        });

        switch (key) {
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
                content = `<span>ID: ${employee.employee_id}</span>`;
                break;
            case 'qr_code':
                content = `<img src="${finalQrCodeUrl}" style="width:100%; height:100%; object-fit:contain; display:block;" />`;
                break;
            default:
                 if (style.text) content = `<span>${style.text}</span>`;
                break;
        }
        if (content) {
            contentWrapper += `<div style="${inlineStyle}">${content}</div>`;
        }
    }
    contentWrapper += '</div>';

    return `
        <html>
            <head>
                <style>
                    body, html { margin: 0; padding: 0; font-family: sans-serif; }
                    span { display: flex; align-items: center; width: 100%; height: 100%; }
                </style>
            </head>
            <body>${elementsHtml}${contentWrapper}</body>
        </html>
    `;
};


/**
 * The main job function that creates the PDF document.
 */
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

        const dpi = 300;
        const scale = dpi / 25.4; // pixels per mm
        const cardWidthMm = 85.6;
        const cardHeightMm = 53.98;
        const cardWidthPx = Math.round(cardWidthMm * scale);
        const cardHeightPx = Math.round(cardHeightMm * scale);

        const page = await browser.newPage();
        await page.setViewport({ width: cardWidthPx, height: cardHeightPx });

        for (const employee of employees) {
            const cardHtml = await generateCardHtml(employee, template);
            await page.setContent(cardHtml, { waitUntil: 'networkidle0' });

            const screenshotBuffer = await page.screenshot({ type: 'jpeg', quality: 95 });
            
            const pdfPage = doc.addPage([cardWidthMm, cardHeightMm]);
            const jpgImage = await doc.embedJpg(screenshotBuffer);
            pdfPage.drawImage(jpgImage, {
                x: 0,
                y: 0,
                width: cardWidthMm,
                height: cardHeightMm,
            });
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
// --- WORKER QUEUE LOGIC ---
// =========================================================================

async function processQueue() {
    console.log(`[${new Date().toISOString()}] Checking for new jobs...`);

    const { data: job, error: findError } = await supabase
        .from('pdf_generation_jobs')
        .select('*')
        .eq('status', 'pending')
        .limit(1)
        .single();

    if (!job) {
        if (findError && findError.code !== 'PGRST116') {
            console.error('Error finding job:', findError);
        }
        return;
    }

    console.log(`Found job ${job.id}. Starting to process...`);
    await supabase.from('pdf_generation_jobs').update({ status: 'processing' }).eq('id', job.id);

    try {
        const { pdfBytes } = await generatePdfForJob(job);
        
        const filePath = `public/pdfs/${job.id}.pdf`;
        const { error: uploadError } = await supabase.storage
            .from('documents')
            .upload(filePath, pdfBytes, { contentType: 'application/pdf', upsert: true });

        if (uploadError) throw uploadError;

        const { data: urlData } = supabase.storage.from('documents').getPublicUrl(filePath);

        await supabase
            .from('pdf_generation_jobs')
            .update({ status: 'completed', result_url: urlData.publicUrl })
            .eq('id', job.id);

        console.log(`Job ${job.id} completed successfully.`);

    } catch (error) {
        console.error(`Failed to process job ${job.id}:`, error);
        await supabase
            .from('pdf_generation_jobs')
            .update({ status: 'failed', error_message: error.message })
            .eq('id', job.id);
    }
}

// --- Start the server and the polling interval ---
app.listen(PORT, () => {
    console.log(`Web service listening on port ${PORT}`);
    console.log('Starting PDF Worker polling...');
    setInterval(processQueue, 15000); // Check for jobs every 15 seconds
});