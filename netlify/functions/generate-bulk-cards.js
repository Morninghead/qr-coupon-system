// generate-bulk-cards.js
import { createClient } from '@supabase/supabase-js';
import { JSDOM } from 'jsdom';
import html2canvas from 'html2canvas';
import { jsPDF } from 'jspdf';
import QRCode from 'qrcode';

// --- Supabase Admin client ---
const supabaseUrl = process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabaseAdmin = createClient(supabaseUrl, serviceKey);

// --- Constants ---
const CARD_STANDARD_WIDTH_MM = 85.6;
const CARD_STANDARD_HEIGHT_MM = 53.98;
const BASE_SCANNER_URL = 'https://ssth-ecoupon.netlify.app/scanner';
const EMPLOYEE_PHOTOS_BUCKET = 'employee-photos';

// --- Main Handler ---
export const handler = async (event, context) => {
    if (event.httpMethod !== 'POST') {
        return { statusCode: 405, body: JSON.stringify({ message: 'Method Not Allowed' }) };
    }
    try {
        const token = event.headers.authorization?.split('Bearer ')[1];
        if (!token) return { statusCode: 401, body: JSON.stringify({ message: 'Authentication required' }) };
        const { data: { user }, error: userError } = await supabaseAdmin.auth.getUser(token);
        if (userError || !user) return { statusCode: 401, body: JSON.stringify({ message: 'Invalid token' }) };
        const { data: profile } = await supabaseAdmin.from('profiles').select('role').eq('id', user.id).single();
        if (profile?.role !== 'superuser' && profile?.role !== 'department_admin') {
            return { statusCode: 403, body: JSON.stringify({ message: 'Permission denied.' }) };
        }
        const { template_id, employee_ids, print_settings } = JSON.parse(event.body);
        if (!template_id || !employee_ids || !employee_ids.length) {
            return { statusCode: 400, body: JSON.stringify({ message: 'Missing template or employee data.' }) };
        }
        const { data: template, error: templateError } = await supabaseAdmin.from('card_templates').select('*').eq('id', template_id).single();
        if (templateError) throw new Error(`Template not found: ${templateError.message}`);
        const { data: employees, error: employeesError } = await supabaseAdmin.from('employees').select('id, employee_id, name, permanent_token, photo_url').in('id', employee_ids);
        if (employeesError) throw new Error(`Failed to fetch employees: ${employeesError.message}`);
        const doc = new jsPDF({
            orientation: template.orientation === 'portrait' ? 'portrait' : 'landscape',
            unit: 'mm',
            format: 'a4'
        });
        await addCardsToPdf(doc, employees, template);
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
    }
};

async function addCardsToPdf(doc, employees, template) {
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
        const cardCanvas = await renderCardToCanvas(employee, template, cardWidth, cardHeight);
        const imgData = cardCanvas.toDataURL('image/jpeg', 0.9);
        doc.addImage(imgData, 'JPEG', x, y, cardWidth, cardHeight);
        cardCount++;
    }
}

async function renderCardToCanvas(employee, template, cardWidthMm, cardHeightMm) {
    const dom = new JSDOM(`<!DOCTYPE html><body><div id="card-container"></div></body>`);
    
    global.window = dom.window;
    global.document = dom.window.document;
    global.Node = dom.window.Node;
    global.HTMLCanvasElement = dom.window.HTMLCanvasElement;
    global.HTMLImageElement = dom.window.HTMLImageElement;

    const mockGetComputedStyle = () => ({
        getPropertyValue: (prop) => (prop === 'background-color' ? 'transparent' : '')
    });
    global.getComputedStyle = mockGetComputedStyle;
    dom.window.getComputedStyle = mockGetComputedStyle;
    dom.window.scrollTo = () => {};

    const document = dom.window.document;
    const cardContainer = document.getElementById('card-container');

    const dpi = 150;
    const scale = dpi / 25.4;
    cardContainer.style.width = `${cardWidthMm * scale}px`;
    cardContainer.style.height = `${cardHeightMm * scale}px`;

    cardContainer.innerHTML = await generateCardHtml(employee, template);

    return await html2canvas(cardContainer, { 
        scale: 1,
        logging: false,
        // FIX: Changed 'null' to the string 'transparent'
        backgroundColor: 'transparent',
        width: cardWidthMm * scale,
        height: cardHeightMm * scale,
        windowWidth: cardWidthMm * scale,
        windowHeight: cardHeightMm * scale,
    });
}

async function generateCardHtml(employee, template) {
    const photoUrl = employee.photo_url || `${supabaseUrl}/storage/v1/object/public/${EMPLOYEE_PHOTOS_BUCKET}/${employee.employee_id}.jpg`;
    const qrCodeData = `${BASE_SCANNER_URL}?token=${employee.permanent_token}`;
    const qrDataUrl = await QRCode.toDataURL(qrCodeData, { errorCorrectionLevel: 'H', width: 200 });
    let elementsHtml = '';
    
    let layout;
    if (template.layout_config && template.layout_config.frontLayout) {
      layout = template.layout_config.frontLayout;
    } else {
      layout = template.layout_config;
    }
    layout = layout || {};

    for (const key in layout) {
        const style = layout[key];
        let content = '';
        let inlineStyle = `position:absolute; left:${style.left}; top:${style.top}; width:${style.width}; height:${style.height}; box-sizing:border-box;`;
        if (style.transform) inlineStyle += `transform:${style.transform};`;
        if (style.color) inlineStyle += `color:${style.color};`;
        if (style.fontSize) inlineStyle += `font-size:${style.fontSize};`;
        if (style.fontWeight) inlineStyle += `font-weight:${style.fontWeight};`;
        if (style.textAlign) inlineStyle += `text-align:${style.textAlign};`;
        switch (key) {
            case 'photo':
                inlineStyle += `border-radius:${style.borderRadius || '0'}; object-fit:cover;`;
                content = `<img src="${photoUrl}" style="width:100%; height:100%; ${inlineStyle}" />`;
                break;
            case 'logo':
                inlineStyle += `object-fit:contain;`;
                content = `<img src="${template.logo_url || ''}" style="width:100%; height:100%; ${inlineStyle}" />`;
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
                content = `<img src="${qrDataUrl}" style="width:100%; height:100%; ${inlineStyle}" />`;
                break;
        }
        elementsHtml += content;
    }

    const backgroundStyle = template.background_front_url 
        ? `background-image: url(${template.background_front_url}); background-size: cover; background-position: center;`
        : 'background-color: #fff;';

    return `<div style="width:100%; height:100%; position:relative; overflow:hidden; font-family: sans-serif; ${backgroundStyle}">${elementsHtml}</div>`;
}