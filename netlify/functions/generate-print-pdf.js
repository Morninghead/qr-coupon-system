// generate-print-pdf.js
import { createClient } from '@supabase/supabase-js';
import { JSDOM } from 'jsdom';
import html2canvas from 'html2canvas';
import { jsPDF } from 'jspdf';
import QRCode from 'qrcode'; 

// Supabase Admin client
const supabaseUrl = process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabaseAdmin = createClient(supabaseUrl, serviceKey);

// Define standard ID card dimensions in mm
const CARD_STANDARD_WIDTH_MM = 85.6;
const CARD_STANDARD_HEIGHT_MM = 53.98;

const BASE_SCANNER_URL = 'https://ssth-ecoupon.netlify.app/scanner'; 
const EMPLOYEE_PHOTOS_BUCKET = 'employee-photos'; // Make sure this matches your bucket name

export const handler = async (event, context) => {
    if (event.httpMethod !== 'POST') {
        return { statusCode: 405, body: 'Method Not Allowed' };
    }

    try {
        // 1. Authentication and Authorization Check (Superuser or Department Admin)
        const token = event.headers.authorization?.split('Bearer ')[1];
        if (!token) {
            return { statusCode: 401, body: JSON.stringify({ message: 'Authentication required' }) };
        }
        const { data: { user }, error: userError } = await supabaseAdmin.auth.getUser(token);
        if (userError || !user) {
            return { statusCode: 401, body: JSON.stringify({ message: 'Invalid token' }) };
        }

        const { data: profile } = await supabaseAdmin.from('profiles').select('role').eq('id', user.id).single();
        if (profile?.role !== 'superuser' && profile?.role !== 'department_admin') {
            return { statusCode: 403, body: JSON.stringify({ message: 'Permission denied. Superuser or Department Admin role required.' }) };
        }

        // 2. Parse Request Body (receiving full employee data and template)
        const { employees, template } = JSON.parse(event.body);

        if (!employees || employees.length === 0 || !template || !template.id) {
            return { statusCode: 400, body: JSON.stringify({ message: 'Missing employee data or template.' }) };
        }

        // --- JSDOM setup for server-side HTML rendering ---
        // Define common styles to be injected into JSDOM for html2canvas
        const commonCardStyles = `
            body { margin: 0; padding: 0; } /* Reset body margin within JSDOM */
            .employee-card {
                border: 1px solid #ccc; /* Hairline border for cutting */
                border-radius: 8px;
                overflow: hidden;
                position: relative;
                background-color: #fff;
                box-shadow: none; /* Remove shadow for printing */
                box-sizing: border-box; /* Crucial for consistent sizing */
            }
            .employee-card .background {
                position: absolute;
                top: 0; left: 0;
                width: 100%; height: 100%;
                object-fit: cover;
                z-index: 0;
            }
            .employee-card .card-content {
                position: relative;
                z-index: 1;
                width: 100%;
                height: 100%;
            }
            .employee-card .card-element {
                position: absolute;
                box-sizing: border-box; /* Important */
                background-color: rgba(255,255,255,0.7); /* Semi-transparent background for text clarity */
                padding: 2px 5px;
                border-radius: 3px;
                white-space: nowrap;
                overflow: hidden;
                text-overflow: ellipsis;
                color: #000;
                font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; /* Ensure font is consistent */
            }
            .employee-card .card-element.text {
                font-weight: 500;
            }
            .employee-card .card-element.img {
                background-color: transparent;
                border: none;
                padding: 0;
            }
            .employee-card .card-element.qr {
                background-color: transparent;
                border: none;
                padding: 0;
                display: flex;
                justify-content: center;
                align-items: center;
            }
        `;
        
        // Initialize JSDOM with basic HTML and the common styles
        const dom = new JSDOM(`
            <!DOCTYPE html>
            <html>
            <head>
                <style>${commonCardStyles}</style>
            </head>
            <body>
                <div id="render-area" style="position: relative; width: 0; height: 0; overflow: hidden;"></div>
            </body>
            </html>
        `, { resources: 'usable' }); // 'usable' for loading external resources like images
        const document = dom.window.document;
        const renderArea = document.getElementById('render-area'); // Area to attach elements for rendering


        // Helper function to generate card HTML (server-side with inline styles for html2canvas)
        const generateCardHtml = async (employee, template) => {
            let photoUrl = employee.photo_url || `${supabaseUrl}/storage/v1/object/public/${EMPLOYEE_PHOTOS_BUCKET}/${employee.employee_id}.jpg`;
            const finalPhotoUrl = photoUrl || 'https://via.placeholder.com/80?text=No+Photo';

            let cardHtml = '';
            if (template.background_front_url) {
                cardHtml += `<img src="${template.background_front_url}" class="background">`;
            }
            cardHtml += `<div class="card-content">`;

            const layout = template.layout_config || {};
            for (const key in layout) {
                if (Object.hasOwnProperty.call(layout, key)) {
                    const style = layout[key];
                    let content = '';
                    let className = 'card-element';

                    // Apply inline styles from JSON
                    let inlineStyleStr = '';
                    for (const prop in style) {
                        if (Object.hasOwnProperty.call(style, prop) && prop !== 'text') { 
                            inlineStyleStr += `${prop}: ${style[prop]};`;
                        }
                    }

                    if (key === "photo") { 
                        className += ' img';
                        content = `<img src="${finalPhotoUrl}" style="width:100%;height:100%;object-fit:contain;${style.borderRadius ? `border-radius:${style.borderRadius};` : ''}${style.border ? `border:${style.border};` : ''}" onerror="this.onerror=null;this.src='https://via.placeholder.com/80?text=Photo+Error'">`;
                    } else if (key === "logo") { 
                        className += ' img';
                        content = `<img src="${template.logo_url || 'https://via.placeholder.com/50?text=Logo'}" style="width:100%;height:100%;object-fit:contain;" onerror="this.onerror=null;this.src='https://via.placeholder.com/50?text=Logo+Error'">`;
                    }
                    else if (key === "company_name") {
                        className += ' text';
                        content = template.company_name || '';
                    } else if (key === "employee_name") {
                        className += ' text';
                        content = employee.name;
                    } else if (key === "employee_id") {
                        className += ' text';
                        content = `ID: ${employee.employee_id}`;
                    } else if (key === "qr_code") {
                        className += ' qr';
                        // Generate QR code as Data URL server-side
                        const qrCodeData = `${BASE_SCANNER_URL}?token=${employee.permanent_token}`;
                        const qrDataUrl = await QRCode.toDataURL(qrCodeData, {
                            errorCorrectionLevel: 'H',
                            width: 100 // A base resolution, html2canvas will scale based on CSS
                        });
                        content = `<img src="${qrDataUrl}" style="width:100%;height:100%;object-fit:contain;">`;
                    } else {
                        className += ' text';
                        content = style.text || ''; 
                    }
                    
                    cardHtml += `<div class="${className}" style="${inlineStyleStr}">${content}</div>`;
                }
            }
            cardHtml += `</div>`; 
            return cardHtml;
        };

        // Initialize jsPDF outside the loop
        const pdfOrientation = template.orientation === 'landscape' ? 'landscape' : 'portrait';
        const doc = new jsPDF({
            orientation: pdfOrientation, 
            unit: 'mm',
            format: 'a4'
        });

        // Calculate card dimensions for PDF based on standard ratio
        let finalCardWidthMm, finalCardHeightMm;
        if (template.orientation === 'landscape') {
            finalCardWidthMm = CARD_STANDARD_WIDTH_MM; 
            finalCardHeightMm = CARD_STANDARD_HEIGHT_MM; 
        } else { // portrait
            finalCardWidthMm = CARD_STANDARD_HEIGHT_MM; 
            finalCardHeightMm = CARD_STANDARD_WIDTH_MM; 
        }

        const renderScale = 3; // Scale factor for html2canvas to render at higher resolution
        const margin = 10; // mm margin for PDF page
        let currentX = margin;
        let currentY = margin;

        for (const employee of employees) {
            // Create a temporary div for html2canvas rendering in JSDOM
            const tempCardElement = document.createElement('div');
            // Apply a class to mimic frontend styles for the main card container
            tempCardElement.classList.add('employee-card'); 
            
            // Set dimensions in pixels for html2canvas rendering (e.g., 96 dpi conversion from mm)
            // It's crucial for html2canvas to render something with known pixel dimensions.
            const mmToPx = (mm) => mm * (96 / 25.4); // Standard 96 DPI
            
            tempCardElement.style.width = `${mmToPx(finalCardWidthMm)}px`;
            tempCardElement.style.height = `${mmToPx(finalCardHeightMm)}px`;
            
            // Append the generated HTML content
            tempCardElement.innerHTML = await generateCardHtml(employee, template);
            renderArea.appendChild(tempCardElement); // Append to the hidden render area in JSDOM

            // Render HTML element to canvas using html2canvas
            const canvas = await html2canvas(tempCardElement, { 
                scale: renderScale, 
                logging: false,
                backgroundColor: null // Transparent background to use PDF's background
            });
            const imgData = canvas.toDataURL('image/jpeg', 0.9); // Get image data from canvas

            // Remove the temporary card element from JSDOM
            tempCardElement.remove();

            // Add image to PDF
            const page_width = doc.internal.pageSize.getWidth();
            const page_height = doc.internal.pageSize.getHeight();
            
            if (currentX + finalCardWidthMm > page_width - margin) {
                currentX = margin;
                currentY += finalCardHeightMm + margin;
            }
            if (currentY + finalCardHeightMm > page_height - margin) {
                doc.addPage();
                currentY = margin;
            }

            doc.addImage(imgData, 'JPEG', currentX, currentY, finalCardWidthMm, finalCardHeightMm);
            currentX += finalCardWidthMm + margin;
        }

        // Return PDF as Base64 Data URI
        const pdfBase64 = doc.output('datauristring');
        
        return {
            statusCode: 200,
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                success: true,
                message: `PDF generated successfully for ${employees.length} cards.`,
                pdfData: pdfBase64 
            }),
        };

    } catch (error) {
        console.error('Generate Print PDF Error:', error);
        return {
            statusCode: 500,
            body: JSON.stringify({ message: 'Failed to generate PDF', error: error.message }),
        };
    }
};