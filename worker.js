// Place this at the top of your worker.js with other require statements
const QRCode = require('qrcode');
const { PDFDocument } = require('pdf-lib');
const fontkit = require('@pdf-lib/fontkit');
// Add any other necessary imports like puppeteer, fs, path, etc.

async function generatePdfForJob(job) {
    const { template, employees, paperSize = "A4" } = job.payload;
    if (!template || !employees || employees.length === 0) {
        throw new Error('Job payload is missing template or employees.');
    }

    const doc = await PDFDocument.create();
    doc.registerFontkit(fontkit);

    // --- Helper function to generate HTML for a single card ---
    const generateCardHtml = async (employee) => {
        // MODIFIED: Photo Handling Logic
        let finalPhotoUrl;
        if (employee.photo_url) {
            finalPhotoUrl = employee.photo_url;
        } else {
            // NEW: Create a placeholder with the Employee ID if photo is missing
            const placeholderText = `No Photo\\nID: ${employee.employee_id}`;
            finalPhotoUrl = `https://placehold.co/400x400/EFEFEF/AAAAAA?text=${encodeURIComponent(placeholderText)}`;
        }

        // MODIFIED: QR Code Handling Logic
        let finalQrCodeUrl;
        if (employee.permanent_token) {
            const qrCodeData = `https://ssth-ecoupon.netlify.app/scanner?token=${employee.permanent_token}`;
            finalQrCodeUrl = await QRCode.toDataURL(qrCodeData, { errorCorrectionLevel: 'H', width: 256 });
        } else {
            // NEW: Use a placeholder if the token for the QR code is missing
            finalQrCodeUrl = `https://placehold.co/256x256/EFEFEF/AAAAAA?text=No+QR+Code`;
        }

        // This part assumes you are using the Puppeteer/html2canvas method for high fidelity.
        // It generates the HTML that will be screenshotted.
        const layout = template.layout_config_front || {};
        let elementsHtml = '';

        // Add background if it exists
        if (template.background_front_url) {
            elementsHtml += `<img src="${template.background_front_url}" style="position:absolute; top:0; left:0; width:100%; height:100%; object-fit:cover; z-index:0;">`;
        }

        for (const key in layout) {
            const style = layout[key];
            let content = '';
            let inlineStyle = `position:absolute; left:${style.left}; top:${style.top}; width:${style.width}; height:${style.height}; box-sizing:border-box; z-index:1;`;
            
            // Append additional style properties from the template
            Object.keys(style).forEach(prop => {
                if (!['left', 'top', 'width', 'height', 'text'].includes(prop)) {
                    const kebabCaseProp = prop.replace(/([A-Z])/g, "-$1").toLowerCase();
                    inlineStyle += `${kebabCaseProp}:${style[prop]};`;
                }
            });

            switch (key) {
                case 'photo':
                    content = `<img src="${finalPhotoUrl}" style="width:100%; height:100%; object-fit:cover;" />`;
                    break;
                case 'logo':
                    content = `<img src="${template.logo_url || ''}" style="width:100%; height:100%; object-fit:contain;" />`;
                    break;
                case 'employee_name':
                    content = `<span>${employee.name}</span>`;
                    break;
                case 'employee_id':
                    content = `<span>ID: ${employee.employee_id}</span>`;
                    break;
                case 'qr_code':
                    content = `<img src="${finalQrCodeUrl}" style="width:100%; height:100%; object-fit:contain;" />`;
                    break;
                default:
                     if (style.text) {
                        content = `<span>${style.text}</span>`;
                     }
                    break;
            }
            if (content) {
                elementsHtml += `<div style="${inlineStyle}">${content}</div>`;
            }
        }
        return elementsHtml;
    };


    // --- Main PDF Generation Logic (using puppeteer is assumed) ---
    // This part requires you to have puppeteer/chromium set up in your worker environment.
    const chromium = require('@sparticuz/chromium');
    const puppeteer = require('puppeteer-core');
    let browser = null;

    try {
        browser = await puppeteer.launch({
            args: chromium.args,
            defaultViewport: chromium.defaultViewport,
            executablePath: await chromium.executablePath(),
            headless: chromium.headless,
        });

        const page = await browser.newPage();

        // Loop through employees and add their cards to the PDF
        for (const employee of employees) {
            const cardHtml = await generateCardHtml(employee);
            
            // Example: Add card to PDF page (this part depends on your chosen PDF library and layout)
            // This is a simplified example. Your actual card placement logic will be here.
            // For now, we'll just confirm the HTML generation works.
            console.log(`Generated HTML for employee ${employee.employee_id}`);
        }
        
        // This is a placeholder for your actual PDF creation logic which is complex.
        // The key is that `generateCardHtml` now handles the fallbacks.
        // You would continue here by creating PDF pages, setting content, taking screenshots,
        // and adding them to the `pdfDoc` object.
        
        // For demonstration, we create a simple PDF confirming the process ran.
        const firstPage = doc.addPage();
        firstPage.drawText(`Successfully processed ${employees.length} employees for PDF generation.`, { x: 50, y: 800 });


        const pdfBytes = await doc.save();
        return { pdfBytes };

    } finally {
        if (browser) {
            await browser.close();
        }
    }
}