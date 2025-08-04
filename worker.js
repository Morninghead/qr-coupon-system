// worker.js

// --- Imports ---
const express = require('express');
const { createClient } = require('@supabase/supabase-js');
const { PDFDocument, rgb } = require('pdf-lib');
const QRCode = require('qrcode');
const chromium = require('@sparticuz/chromium');
const puppeteer = require('puppeteer-core');
const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx'); // For reading Excel files
const fetch = require('node-fetch'); // For downloading files
require('dotenv').config();

// --- Express App Setup ---
const app = express();
const PORT = process.env.PORT || 3000;
app.get('/', (req, res) => {
    res.status(200).send('Worker is alive and polling for jobs.');
});

// --- Supabase Admin Client Setup ---
const supabaseUrl = process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = createClient(supabaseUrl, serviceKey);

// =========================================================================
// --- PDF GENERATION LOGIC (No changes here) ---
// =========================================================================
const CANVAS_DIMENSIONS = {
    portrait: { width: 255, height: 405 },
    landscape: { width: 405, height: 255 }
};

const getFontDataUrl = () => {
    try {
        const fontPath = path.resolve(process.cwd(), 'fonts', 'Sarabun-Regular.ttf');
        const fontBuffer = fs.readFileSync(fontPath);
        return `data:application/font-ttf;base64,${fontBuffer.toString('base64')}`;
    } catch (error) {
        console.error('Could not read font file. Please ensure "Sarabun-Regular.ttf" is in the "/fonts" directory.', error);
        return '';
    }
};
const fontDataUrl = getFontDataUrl();

function drawCropMarks(page, x, y, width, height) {
    const markLength = 4;
    const markOffset = 1;
    const color = rgb(0.5, 0.5, 0.5);
    const thickness = 0.25;
    page.drawLine({ start: { x: x - markOffset, y: y + height }, end: { x: x - markOffset - markLength, y: y + height }, color, thickness });
    page.drawLine({ start: { x: x, y: y + height + markOffset }, end: { x: x, y: y + height + markOffset + markLength }, color, thickness });
    page.drawLine({ start: { x: x + width + markOffset, y: y + height }, end: { x: x + width + markOffset + markLength, y: y + height }, color, thickness });
    page.drawLine({ start: { x: x + width, y: y + height + markOffset }, end: { x: x + width, y: y + height + markOffset + markLength }, color, thickness });
    page.drawLine({ start: { x: x - markOffset, y: y }, end: { x: x - markOffset - markLength, y: y }, color, thickness });
    page.drawLine({ start: { x: x, y: y - markOffset }, end: { x: x, y: y - markOffset - markLength }, color, thickness });
    page.drawLine({ start: { x: x + width + markOffset, y: y }, end: { x: x + width + markOffset + markLength, y: y }, color, thickness });
    page.drawLine({ start: { x: x + width, y: y - markOffset }, end: { x: x + width, y: y - markOffset - markLength }, color, thickness });
}

const generateCardHtml = async (employee, template, side) => {
    const layoutConfig = side === 'front' ? template.layout_config_front : template.layout_config_back;
    const backgroundUrl = side === 'front' ? template.background_front_url : template.background_back_url;
    if (!layoutConfig || Object.keys(layoutConfig).length === 0) return `<html><body><div class="card-wrapper"></div></body></html>`;

    let finalPhotoUrl = employee.photo_url || `https://placehold.co/400x400/EFEFEF/AAAAAA?text=${encodeURIComponent(`No Photo\\nID: ${employee.employee_id}`)}`;
    let finalQrCodeUrl = employee.permanent_token 
        ? await QRCode.toDataURL(`https://ssth-ecoupon.netlify.app/check-status?token=${employee.permanent_token}`, { errorCorrectionLevel: 'H', width: 256, margin: 1 })
        : `https://placehold.co/256x256/EFEFEF/AAAAAA?text=No+QR+Code`;

    const canvas = CANVAS_DIMENSIONS[template.orientation] || CANVAS_DIMENSIONS.landscape;
    let elementsHtml = '';

    for (const key in layoutConfig) {
        const style = layoutConfig[key];
        const elementType = key.split('-')[0];
        const inlineStyle = `
            position: absolute; z-index: 1;
            left: ${(style.x / canvas.width * 100).toFixed(4)}%; top: ${(style.y / canvas.height * 100).toFixed(4)}%;
            width: ${(style.width / canvas.width * 100).toFixed(4)}%; height: ${(style.height / canvas.height * 100).toFixed(4)}%;
            font-size: ${style.fontSize || 16}px; font-family: '${style.fontFamily || 'Sarabun'}', sans-serif;
            color: ${style.fill || '#000'}; box-sizing: border-box; display: flex;
            align-items: center; justify-content: center; text-align: center; overflow: hidden;
        `;
        
        let content = '';
        switch (elementType) {
            case 'photo':
                const shapeStyle = style.shape === 'circle' ? 'border-radius: 50%;' : '';
                content = `<img src="${finalPhotoUrl}" style="width:100%; height:100%; object-fit:cover; display:block; ${shapeStyle}" />`;
                break;
            case 'logo': content = `<img src="${template.logo_url || ''}" style="width:100%; height:100%; object-fit:contain; display:block;" />`; break;
            case 'employee_name': content = `<span>${employee.name}</span>`; break;
            case 'employee_id': content = `<span>${employee.employee_id}</span>`; break;
            case 'department_name': content = `<span>${employee.department_name || ''}</span>`; break;
            case 'qr_code': content = `<img src="${finalQrCodeUrl}" style="width:100%; height:100%; object-fit:contain; display:block;" />`; break;
            case 'text': if (style.text) content = `<span>${style.text}</span>`; break;
        }
        if (content) elementsHtml += `<div style="${inlineStyle}">${content}</div>`;
    }
    
    return `
        <html>
            <head>
                <meta charset="UTF-8">
                <style>
                    @font-face {
                        font-family: 'Sarabun';
                        src: url(${fontDataUrl}) format('truetype');
                    }
                    body, html { margin:0; padding:0; font-family: 'Sarabun', sans-serif; width:${canvas.width}px; height:${canvas.height}px; }
                    .card-wrapper {
                        width: 100%; height: 100%; position: relative; overflow: hidden;
                        border: 1px solid #B0B0B0; box-sizing: border-box;
                        background-image: url(${backgroundUrl || ''});
                        background-size: cover;
                        background-position: center;
                    }
                    span { width:100%; padding:2px; }
                </style>
            </head>
            <body><div class="card-wrapper">${elementsHtml}</div></body>
        </html>
    `;
};

async function generatePdfForJob(job) {
    const { template, employees } = job.payload;
    const doc = await PDFDocument.create();
    let browser = null;

    try {
        browser = await puppeteer.launch({
            args: chromium.args, executablePath: await chromium.executablePath(), headless: chromium.headless,
        });
        const page = await browser.newPage();

        const isPortrait = template.orientation === 'portrait';
        const CARD_WIDTH = isPortrait ? 53.98 : 85.6;
        const CARD_HEIGHT = isPortrait ? 85.6 : 53.98;
        const PAIR_WIDTH = CARD_WIDTH * 2;
        
        const PAGE_WIDTH = 210; const PAGE_HEIGHT = 297;
        const CARDS_PER_ROW = 2; const CARDS_PER_COL = 3;
        const PAIRS_PER_PAGE = 6;

        const MARGIN_X = (PAGE_WIDTH - (PAIR_WIDTH * CARDS_PER_ROW)) / 2;
        const MARGIN_Y = (PAGE_HEIGHT - (CARD_HEIGHT * CARDS_PER_COL)) / 2;

        const canvas = CANVAS_DIMENSIONS[template.orientation] || CANVAS_DIMENSIONS.landscape;
        await page.setViewport({ width: canvas.width, height: canvas.height });

        let cardCount = 0;
        let currentPage = null;
        const totalEmployees = employees.length;

        for (const employee of employees) {
            const progress = Math.round(((cardCount + 1) / totalEmployees) * 100);
            const progressMessage = `Processing Card ${cardCount + 1} of ${totalEmployees} for ${employee.name}...`;
            
            await supabase.from('pdf_generation_jobs').update({
                progress: progress,
                progress_message: progressMessage
            }).eq('id', job.id);
            
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
            
            const x_front = MARGIN_X + col * PAIR_WIDTH;
            const y_pos = PAGE_HEIGHT - MARGIN_Y - CARD_HEIGHT - (row * CARD_HEIGHT);

            const frontImage = await doc.embedJpg(frontImageBuffer);
            currentPage.drawImage(frontImage, { x: x_front, y: y_pos, width: CARD_WIDTH, height: CARD_HEIGHT });
            
            const backImage = await doc.embedJpg(backImageBuffer);
            currentPage.drawImage(backImage, { x: x_front + CARD_WIDTH, y: y_pos, width: CARD_WIDTH, height: CARD_HEIGHT });
            
            drawCropMarks(currentPage, x_front, y_pos, PAIR_WIDTH, CARD_HEIGHT);

            cardCount++;
        }
        
        const pdfBytes = await doc.save();
        return { pdfBytes };

    } finally {
        if (browser) await browser.close();
    }
}


// =========================================================================
// --- NEW: EMPLOYEE IMPORT LOGIC ---
// =========================================================================
async function importEmployeesFromJob(job) {
    const { filePath } = job.payload;
    let totalSuccess = 0, totalDuplicates = [], totalInvalidDepts = [];

    try {
        const { data: fileData, error: downloadError } = await supabase.storage.from('imports').download(filePath);
        if (downloadError) throw downloadError;

        const buffer = await fileData.arrayBuffer();
        const workbook = XLSX.read(buffer, { type: 'buffer' });
        const worksheet = workbook.Sheets[workbook.SheetNames[0]];
        const jsonData = XLSX.utils.sheet_to_json(worksheet);

        const allEmployees = jsonData.filter(emp => emp.Employee_ID && emp.Name);
        const totalEmployees = allEmployees.length;

        const { data: departments } = await supabase.from('departments').select('id, name');
        const departmentMap = new Map(departments.map(d => [d.name.toLowerCase(), d.id]));

        for (let i = 0; i < totalEmployees; i++) {
            const empData = allEmployees[i];
            const progress = Math.round(((i + 1) / totalEmployees) * 100);
            const progressMessage = `Processing ${i + 1} of ${totalEmployees}: ${empData.Name}`;
            
            await supabase.from('employee_import_jobs').update({ progress, progress_message }).eq('id', job.id);
            
            const { data: existing } = await supabase.from('employees').select('id').eq('employee_id', empData.Employee_ID).single();
            if (existing) {
                totalDuplicates.push(empData.Employee_ID);
                continue;
            }

            let department_id = null;
            if (empData.Department) {
                department_id = departmentMap.get(String(empData.Department).toLowerCase());
                if (!department_id) totalInvalidDepts.push(empData.Department);
            }

            const permanent_token = require('crypto').randomUUID();
            const qrCodeData = `https://ssth-ecoupon.netlify.app/check-status?token=${permanent_token}`;
            const qrCodeBuffer = await QRCode.toBuffer(qrCodeData);
            const qrCodePath = `employee-qrcodes/${empData.Employee_ID}.png`;

            await supabase.storage.from('employee-qrcodes').upload(qrCodePath, qrCodeBuffer, { contentType: 'image/png', upsert: true });
            const { data: qrUrlData } = supabase.storage.from('employee-qrcodes').getPublicUrl(qrCodePath);

            const { error: insertError } = await supabase.from('employees').insert({
                employee_id: empData.Employee_ID,
                name: empData.Name,
                department_id: department_id,
                permanent_token: permanent_token,
                qr_code_url: qrUrlData.publicUrl
            });
            
            if (insertError) throw insertError;
            totalSuccess++;
            
            await new Promise(resolve => setTimeout(resolve, 500));
        }
        
        return { totalSuccess, totalDuplicates, totalInvalidDepts };

    } catch (error) {
        console.error("Full error in importEmployeesFromJob:", error);
        throw new Error(error.message);
    }
}


// =========================================================================
// --- WORKER QUEUE LOGIC (UPDATED) ---
// =========================================================================
async function processPdfQueue() {
    console.log(`[${new Date().toISOString()}] Checking for new PDF jobs...`);
    const { data: job, error } = await supabase.from('pdf_generation_jobs').select('*').eq('status', 'pending').limit(1).single();
    if (!job) {
        if (error && error.code !== 'PGRST116') console.error('Error finding PDF job:', error);
        return;
    }
    console.log(`Found PDF job ${job.id}. Starting...`);
    await supabase.from('pdf_generation_jobs').update({ status: 'processing', progress: 0, progress_message: 'Worker picked up job...' }).eq('id', job.id);
    try {
        const { pdfBytes } = await generatePdfForJob(job);
        const filePath = `public/pdfs/${job.id}.pdf`;
        const { error: uploadError } = await supabase.storage.from('documents').upload(filePath, pdfBytes, { contentType: 'application/pdf', upsert: true });
        if (uploadError) throw uploadError;
        const { data: urlData } = supabase.storage.from('documents').getPublicUrl(filePath, { download: true });
        await supabase.from('pdf_generation_jobs').update({ status: 'completed', result_url: urlData.publicUrl, progress: 100, progress_message: 'Completed!' }).eq('id', job.id);
        console.log(`PDF job ${job.id} completed successfully.`);
    } catch (error) {
        console.error(`Failed to process PDF job ${job.id}:`, error);
        await supabase.from('pdf_generation_jobs').update({ status: 'failed', error_message: error.message }).eq('id', job.id);
    }
}

async function processImportQueue() {
    console.log(`[${new Date().toISOString()}] Checking for new IMPORT jobs...`);
    const { data: job, error } = await supabase.from('employee_import_jobs').select('*').eq('status', 'pending').limit(1).single();
    if (!job) {
        if (error && error.code !== 'PGRST116') console.error('Error finding import job:', error);
        return;
    }
    console.log(`Found import job ${job.id}. Starting...`);
    await supabase.from('employee_import_jobs').update({ status: 'processing', progress: 0, progress_message: 'Worker picked up job...' }).eq('id', job.id);
    try {
        const summary = await importEmployeesFromJob(job);
        await supabase.from('employee_import_jobs').update({ status: 'completed', result_summary: summary, progress: 100, progress_message: 'Completed!' }).eq('id', job.id);
        console.log(`Import job ${job.id} completed successfully.`);
    } catch (error) {
        console.error(`Failed to process import job ${job.id}:`, error);
        await supabase.from('employee_import_jobs').update({ status: 'failed', error_message: error.message }).eq('id', job.id);
    }
}


// --- Start the server and the polling interval ---
app.listen(PORT, () => {
    console.log(`Web service listening on port ${PORT}`);
    console.log('Starting Worker polling...');
    setInterval(processPdfQueue, 15000);
    setInterval(processImportQueue, 15000);
});