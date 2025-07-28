import { createClient } from '@supabase/supabase-js';
import { jsPDF } from 'jspdf';
import QRCode from 'qrcode';
import chromium from '@sparticuz/chromium';
import puppeteer from 'puppeteer-core';
import fetch from 'node-fetch'; // We need to explicitly use a fetch library

// Supabase Admin client
const supabaseUrl = process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabaseAdmin = createClient(supabaseUrl, serviceKey);

// Constants
const CARD_STANDARD_WIDTH_MM = 85.6;
const CARD_STANDARD_HEIGHT_MM = 53.98;
const BASE_SCANNER_URL = 'https://ssth-ecoupon.netlify.app/scanner';
const EMPLOYEE_PHOTOS_BUCKET = 'employee-photos';

// --- Helper function to fetch an image and convert it to a Data URI ---
async function imageToDataUri(url) {
    if (!url) return null;
    try {
        const response = await fetch(url);
        if (!response.ok) {
            console.warn(`Failed to fetch image: ${url}, status: ${response.status}`);
            return null; // Return null if image not found or error
        }
        const buffer = await response.buffer();
        const contentType = response.headers.get('content-type');
        return `data:${contentType};base64,${buffer.toString('base64')}`;
    } catch (error) {
        console.error(`Error converting image to Data URI for url: ${url}`, error);
        return null;
    }
}

export const handler = async (event, context) => {
    if (event.httpMethod !== 'POST') {
        return { statusCode: 405, body: 'Method Not Allowed' };
    }

    let browser = null;
    try {
        const token = event.headers.authorization?.split('Bearer ')[1];
        if (!token) return { statusCode: 401, body: JSON.stringify({ message: 'Authentication required' }) };
        const { data: { user }, error: userError } = await supabaseAdmin.auth.getUser(token);
        if (userError || !user) return { statusCode: 401, body: JSON.stringify({ message: 'Invalid token' }) };

        const { template_id, employee_ids } = JSON.parse(event.body);
        if (!template_id || !employee_ids || !employee_ids.length) {
            return { statusCode: 400, body: JSON.stringify({ message: 'Missing template or employee data.' }) };
        }

        const { data: template, error: templateError } = await supabaseAdmin.from('card_templates').select('*').eq('id', template_id).single();
        if (templateError) throw new Error(`Template not found: ${templateError.message}`);

        const { data: employees, error: employeesError } = await supabaseAdmin.from('employees').select('id, employee_id, name, permanent_token, photo_url').in('id', employee_ids);
        if (employeesError) throw new Error(`Failed to fetch employees: ${employeesError.message}`);

        browser = await puppeteer.launch({
            args: chromium.args,
            defaultViewport: chromium.defaultViewport,
            executablePath: await chromium.executablePath(),
            headless: chromium.headless,
            ignoreHTTPSErrors: true,
        });

        const doc = new jsPDF({
            orientation: template.orientation === 'portrait' ? 'portrait' : 'landscape',
            unit: 'mm',
            format: 'a4'
        });

        await addCardsToPdf(doc, employees, template, browser);

        const pdfBase64 = doc.output('datauristring');
        
        return {
            statusCode: 200,
            body: JSON.stringify({
                success: true,
                message: `PDF generated for ${employees.length} cards.`,
                cards_generated: employees.length,
                pdfData: pdfBase64 
            }),
        };

    } catch (error) {
        console.error('Generate Bulk Cards Error:', error);
        return {
            statusCode: 500,
            body: JSON.stringify({ message: 'Failed to generate PDF', error: error.message }),
        };
    } finally {
        if (browser !== null) {
            await browser.close();
        }
    }
};

async function addCardsToPdf(doc, employees, template, browser) {
    const isLandscape = template.orientation === 'landscape';
    const cardWidth = isLandscape ? CARD_STANDARD_WIDTH_MM : CARD_STANDARD_HEIGHT_MM;
    const cardHeight = isLandscape ? CARD_STANDARD_HEIGHT_MM : CARD_STANDARD_WIDTH_MM;
    
    const pageMargin = 10;
    const cardSpacing = 5;
    const pageWidth = doc.internal.pageSize.getWidth();
    const cols = Math.floor((pageWidth - pageMargin * 2 + cardSpacing) / (cardWidth + cardSpacing));
    const rows = 4;
    const cardsPerPage = cols * rows;
    
    let cardCount = 0;
    for (const employee of employees) {
        if (cardCount > 0 && cardCount % cardsPerPage === 0) {
            doc.addPage();
        }
        const indexOnPage = cardCount % cardsPerPage;
        const col = indexOnPage % cols;
        const row = Math.floor(indexOnPage / cols);
        const x = pageMargin + col * (cardWidth + cardSpacing);
        const y = pageMargin + row * (cardHeight + cardSpacing);

        const imgData = await renderCardToImage(employee, template, cardWidth, cardHeight, browser);
        doc.addImage(imgData, 'JPEG', x, y, cardWidth, cardHeight);
        cardCount++;
    }
}

async function renderCardToImage(employee, template, cardWidthMm, cardHeightMm, browser) {
    const dpi = 300;
    const scale = dpi / 25.4;
    const cardWidthPx = Math.round(cardWidthMm * scale);
    const cardHeightPx = Math.round(cardHeightMm * scale);

    const page = await browser.newPage();
    await page.setViewport({ width: cardWidthPx, height: cardHeightPx });
    
    const finalHtml = await generateCardHtml(employee, template, cardWidthPx, cardHeightPx);
    
    await page.setContent(finalHtml, { waitUntil: 'load', timeout: 60000 });

    const screenshotBuffer = await page.screenshot({
        type: 'jpeg',
        quality: 90,
        encoding: 'base64'
    });
    
    await page.close();
    return `data:image/jpeg;base64,${screenshotBuffer}`;
}

async function generateCardHtml(employee, template, cardWidthPx, cardHeightPx) {
    // FIX: Pre-fetch all images and convert them to Data URIs
    const photoUrl = employee.photo_url || `${supabaseUrl}/storage/v1/object/public/${EMPLOYEE_PHOTOS_BUCKET}/${employee.employee_id}.jpg`;
    const [photoDataUri, logoDataUri, backgroundDataUri] = await Promise.all([
        imageToDataUri(photoUrl),
        imageToDataUri(template.logo_url),
        imageToDataUri(template.background_front_url)
    ]);
    const qrCodeData = `${BASE_SCANNER_URL}?token=${employee.permanent_token}`;
    const qrDataUrl = await QRCode.toDataURL(qrCodeData, { errorCorrectionLevel: 'H', width: 256 });
    
    let layout;
    if (template.layout_config && template.layout_config.frontLayout) {
      layout = template.layout_config.frontLayout;
    } else {
      layout = template.layout_config;
    }
    layout = layout || {};

    let elementsHtml = '';
    for (const key in layout) {
        const style = layout[key];
        let content = '';
        // FIX: Reverted to a safer, more explicit way of building the style string
        let inlineStyle = `position:absolute; left:${style.left}; top:${style.top}; width:${style.width}; height:${style.height}; box-sizing:border-box;`;
        if (style.transform) inlineStyle += `transform:${style.transform};`;
        if (style.color) inlineStyle += `color:${style.color};`;
        if (style.fontSize) inlineStyle += `font-size:${style.fontSize};`;
        if (style.fontWeight) inlineStyle += `font-weight:${style.fontWeight};`;
        if (style.textAlign) inlineStyle += `text-align:${style.textAlign};`;
        
        switch (key) {
            case 'photo':
                if (photoDataUri) {
                    inlineStyle += `border-radius:${style.borderRadius || '0'}; object-fit:cover;`;
                    content = `<img src="${photoDataUri}" style="${inlineStyle}" />`;
                }
                break;
            case 'logo':
                if (logoDataUri) {
                    inlineStyle += `object-fit:contain;`;
                    content = `<img src="${logoDataUri}" style="${inlineStyle}" />`;
                }
                break;
            case 'employee_name':
                content = `<div style="${inlineStyle}">${employee.name}</div>`;
                break;
            case 'employee_id':
                content = `<div style="${inlineStyle}">ID: ${employee.employee_id}</div>`;
                break;
            case 'company_name':
                content = `<div style="${inlineStyle}">${template.company_name}</div>`;
                break;
            case 'qr_code':
                inlineStyle += `object-fit:contain;`;
                content = `<img src="${qrDataUrl}" style="${inlineStyle}" />`;
                break;
        }
        elementsHtml += content;
    }

    const backgroundStyle = backgroundDataUri 
        ? `background-image: url(${backgroundDataUri}); background-size: cover; background-position: center;`
        : 'background-color: #fff;';

    return `
        <html>
            <head>
                <style>
                    body, html { margin: 0; padding: 0; }
                    .card-body {
                        width: ${cardWidthPx}px;
                        height: ${cardHeightPx}px;
                        position: relative;
                        overflow: hidden;
                        font-family: sans-serif;
                        ${backgroundStyle}
                    }
                    .card-body img, .card-body div {
                        -webkit-font-smoothing: antialiased;
                        text-rendering: optimizeLegibility;
                    }
                </style>
            </head>
            <body>
                <div class="card-body">
                    ${elementsHtml}
                </div>
            </body>
        </html>
    `;
}