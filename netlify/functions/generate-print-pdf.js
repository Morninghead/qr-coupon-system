const { createClient } = require('@supabase/supabase-js');
const puppeteer = require('puppeteer-core');
const chromium = require('@sparticuz/chromium');

exports.handler = async (event, context) => {
  // เปิดใช้งาน CORS
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS'
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  try {
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    
    if (!supabaseUrl || !supabaseServiceKey) {
      throw new Error('Missing Supabase configuration');
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    
    // ตรวจสอบ authorization
    const authHeader = event.headers.authorization;
    if (!authHeader) {
      return {
        statusCode: 401,
        headers,
        body: JSON.stringify({ error: 'No authorization header' })
      };
    }

    const token = authHeader.replace('Bearer ', '');
    const { data: user, error: authError } = await supabase.auth.getUser(token);
    
    if (authError || !user) {
      return {
        statusCode: 401,
        headers,
        body: JSON.stringify({ error: 'Invalid token' })
      };
    }

    const requestBody = JSON.parse(event.body || '{}');
    const { employeeIds, templateId } = requestBody;

    if (!employeeIds || !Array.isArray(employeeIds) || employeeIds.length === 0) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Employee IDs are required' })
      };
    }

    if (!templateId) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Template ID is required' })
      };
    }

    // ดึงข้อมูล template พร้อม validation
    const { data: template, error: templateError } = await supabase
      .from('card_templates')
      .select('*')
      .eq('id', templateId)
      .single();

    if (templateError || !template) {
      return {
        statusCode: 404,
        headers,
        body: JSON.stringify({ error: 'Template not found' })
      };
    }

    // Validate template data structure
    if (!template.template_data || typeof template.template_data !== 'object') {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Invalid template data structure' })
      };
    }

    if (!template.template_data.elements || !Array.isArray(template.template_data.elements)) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Template must contain elements array' })
      };
    }

    // ดึงข้อมูลพนักงาน
    const { data: employees, error: employeesError } = await supabase
      .from('employees')
      .select(`
        id, employee_id, first_name, last_name, department, position, 
        photo_url, qr_code_path, is_temp_employee
      `)
      .in('id', employeeIds);

    if (employeesError) {
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({ error: 'Failed to fetch employees' })
      };
    }

    if (!employees || employees.length === 0) {
      return {
        statusCode: 404,
        headers,
        body: JSON.stringify({ error: 'No employees found' })
      };
    }

    console.log(`Generating PDF for ${employees.length} employees with template ${templateId}`);

    // สร้าง HTML content สำหรับ PDF generation
    const htmlContent = await generateCardsHTML(employees, template, supabaseUrl);
    
    // สร้าง PDF โดยใช้ @sparticuz/chromium
    let browser;
    try {
      // ตั้งค่า chromium สำหรับ Netlify
      const isDev = process.env.NETLIFY_DEV === 'true' || process.env.NODE_ENV === 'development';
      
      console.log('Launching browser...');
      
      browser = await puppeteer.launch({
        args: isDev ? [] : [
          ...chromium.args,
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-accelerated-2d-canvas',
          '--no-first-run',
          '--no-zygote',
          '--single-process',
          '--disable-gpu'
        ],
        defaultViewport: chromium.defaultViewport,
        executablePath: isDev ? puppeteer.executablePath() : await chromium.executablePath(),
        headless: chromium.headless,
        ignoreHTTPSErrors: true
      });

      const page = await browser.newPage();
      
      console.log('Setting up page...');
      
      // ตั้งค่าขนาดหน้า A4
      await page.setViewport({ 
        width: 794, 
        height: 1123, 
        deviceScaleFactor: 2 
      });

      // ตั้งค่า user agent
      await page.setUserAgent('Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36');
      
      console.log('Loading HTML content...');
      
      // โหลด HTML content
      await page.setContent(htmlContent, {
        waitUntil: ['networkidle0', 'domcontentloaded'],
        timeout: 30000
      });

      console.log('Waiting for assets to load...');

      // รอให้ fonts และ images โหลดเสร็จ
      await page.evaluate(() => {
        return new Promise((resolve) => {
          // รอให้ fonts โหลดเสร็จ
          if (document.fonts) {
            document.fonts.ready.then(() => {
              // รอให้ images โหลดเสร็จ
              const images = document.querySelectorAll('img');
              let loadedImages = 0;
              
              console.log(`Found ${images.length} images to load`);
              
              if (images.length === 0) {
                resolve();
                return;
              }

              const checkComplete = () => {
                if (loadedImages === images.length) {
                  console.log('All images loaded');
                  resolve();
                }
              };

              images.forEach((img, index) => {
                if (img.complete && img.naturalWidth > 0) {
                  loadedImages++;
                  console.log(`Image ${index + 1} already loaded`);
                } else {
                  img.onload = () => {
                    loadedImages++;
                    console.log(`Image ${index + 1} loaded successfully`);
                    checkComplete();
                  };
                  img.onerror = () => {
                    loadedImages++;
                    console.log(`Image ${index + 1} failed to load`);
                    checkComplete();
                  };
                }
              });

              checkComplete();
            });
          } else {
            resolve();
          }
        });
      });

      // รอเพิ่มเติมเพื่อให้แน่ใจว่าทุกอย่างพร้อม
      await page.waitForTimeout(3000);

      console.log('Generating PDF...');

      // สร้าง PDF
      const pdfBuffer = await page.pdf({
        format: 'A4',
        printBackground: true,
        margin: {
          top: '10mm',
          right: '10mm',
          bottom: '10mm',
          left: '10mm'
        },
        preferCSSPageSize: true,
        displayHeaderFooter: false
      });

      const base64PDF = pdfBuffer.toString('base64');

      console.log(`PDF generated successfully, size: ${base64PDF.length} characters`);

      return {
        statusCode: 200,
        headers: {
          ...headers,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          success: true,
          pdf: base64PDF,
          filename: `employee-cards-${new Date().toISOString().split('T')[0]}.pdf`,
          cardCount: employees.length
        })
      };

    } finally {
      if (browser) {
        console.log('Closing browser...');
        await browser.close();
      }
    }

  } catch (error) {
    console.error('Error generating PDF:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ 
        error: 'Failed to generate PDF',
        details: error.message,
        stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
      })
    };
  }
};

async function generateCardsHTML(employees, template, supabaseUrl) {
  const templateData = template.template_data;
  
  console.log(`Generating HTML for ${employees.length} cards`);
  console.log(`Template has ${templateData.elements?.length || 0} elements`);
  
  // สร้าง CSS สำหรับ template
  const templateCSS = generateTemplateCSS(templateData);
  
  // สร้าง HTML สำหรับแต่ละบัตร
  const cardsHTML = employees.map((employee, index) => {
    console.log(`Processing employee ${index + 1}: ${employee.first_name} ${employee.last_name}`);
    return generateCardHTML(employee, templateData, supabaseUrl);
  }).join('');

  const html = `
    <!DOCTYPE html>
    <html lang="th">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Employee Cards</title>
      <link rel="preconnect" href="https://fonts.googleapis.com">
      <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
      <link href="https://fonts.googleapis.com/css2?family=Sarabun:wght@300;400;500;600;700&family=Noto+Sans+Thai:wght@300;400;500;600;700&display=swap" rel="stylesheet">
      <style>
        * {
          margin: 0;
          padding: 0;
          box-sizing: border-box;
        }
        
        body {
          font-family: 'Sarabun', 'Noto Sans Thai', sans-serif;
          font-size: 12px;
          line-height: 1.4;
          background: white;
          color: #000;
        }
        
        .cards-container {
          display: flex;
          flex-wrap: wrap;
          justify-content: flex-start;
          gap: 8mm;
          padding: 15mm;
          width: 210mm; /* A4 width */
          min-height: 297mm; /* A4 height */
        }
        
        .card {
          width: 85.6mm;  /* ขนาดบัตร standard ISO/IEC 7810 */
          height: 53.98mm;
          position: relative;
          background: white;
          border: 0.5px solid #e0e0e0;
          border-radius: 8px;
          overflow: hidden;
          page-break-inside: avoid;
          margin-bottom: 2mm;
          box-shadow: 0 2px 4px rgba(0,0,0,0.1);
        }
        
        .card img {
          max-width: 100%;
          height: auto;
          display: block;
          object-fit: cover;
        }
        
        .card-element {
          position: absolute;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
          line-height: 1.2;
        }
        
        /* Text elements styling */
        .card-element.text {
          display: flex;
          align-items: center;
          justify-content: flex-start;
        }
        
        /* Image elements styling */
        .card-element.image img {
          width: 100%;
          height: 100%;
          object-fit: cover;
          border-radius: 4px;
        }
        
        /* Rectangle elements styling */
        .card-element.rect {
          border-radius: 4px;
        }
        
        /* Print optimizations */
        @media print {
          body { 
            -webkit-print-color-adjust: exact !important;
            color-adjust: exact !important;
            print-color-adjust: exact !important;
          }
          
          .cards-container {
            gap: 5mm;
            padding: 10mm;
          }
          
          .card {
            box-shadow: none;
            border: 0.5px solid #ccc;
          }
        }
        
        ${templateCSS}
      </style>
    </head>
    <body>
      <div class="cards-container">
        ${cardsHTML}
      </div>
      <script>
        console.log('Cards HTML loaded successfully');
        console.log('Total cards:', document.querySelectorAll('.card').length);
        console.log('Total images:', document.querySelectorAll('img').length);
      </script>
    </body>
    </html>
  `;

  console.log('HTML generated successfully');
  return html;
}

function generateTemplateCSS(templateData) {
  if (!templateData.elements || !Array.isArray(templateData.elements)) {
    console.warn('No elements found in template data');
    return '';
  }

  return templateData.elements.map((element, index) => {
    const className = `.element-${index}`;
    let css = `${className} {\n`;
    
    // Position and size
    if (element.x !== undefined) css += `  left: ${element.x}px;\n`;
    if (element.y !== undefined) css += `  top: ${element.y}px;\n`;
    if (element.width !== undefined) css += `  width: ${element.width}px;\n`;
    if (element.height !== undefined) css += `  height: ${element.height}px;\n`;
    
    // Transform
    if (element.rotation) css += `  transform: rotate(${element.rotation}deg);\n`;
    if (element.scaleX !== undefined && element.scaleY !== undefined) {
      css += `  transform: scale(${element.scaleX}, ${element.scaleY});\n`;
    }
    
    // Opacity
    if (element.opacity !== undefined && element.opacity !== 1) {
      css += `  opacity: ${element.opacity};\n`;
    }
    
    // Type-specific styles
    switch (element.type) {
      case 'Text':
        // Text styling
        if (element.fontSize) css += `  font-size: ${element.fontSize}px;\n`;
        if (element.fontFamily) css += `  font-family: '${element.fontFamily}', 'Sarabun', sans-serif;\n`;
        if (element.fill) css += `  color: ${element.fill};\n`;
        if (element.fontStyle === 'bold') css += `  font-weight: bold;\n`;
        if (element.fontStyle === 'italic') css += `  font-style: italic;\n`;
        if (element.textAlign) {
          css += `  text-align: ${element.textAlign};\n`;
          css += `  justify-content: ${element.textAlign === 'center' ? 'center' : element.textAlign === 'right' ? 'flex-end' : 'flex-start'};\n`;
        }
        if (element.verticalAlign) {
          css += `  align-items: ${element.verticalAlign === 'middle' ? 'center' : element.verticalAlign === 'bottom' ? 'flex-end' : 'flex-start'};\n`;
        }
        css += `  display: flex;\n`;
        css += `  word-wrap: break-word;\n`;
        css += `  white-space: normal;\n`;
        break;
        
      case 'Rect':
        // Rectangle styling
        if (element.fill) css += `  background-color: ${element.fill};\n`;
        if (element.stroke) css += `  border-color: ${element.stroke};\n`;
        if (element.strokeWidth) css += `  border-width: ${element.strokeWidth}px;\n  border-style: solid;\n`;
        if (element.cornerRadius) css += `  border-radius: ${element.cornerRadius}px;\n`;
        break;
        
      case 'Image':
        // Image styling
        css += `  overflow: hidden;\n`;
        if (element.cornerRadius) css += `  border-radius: ${element.cornerRadius}px;\n`;
        break;
    }
    
    css += `}\n`;
    return css;
  }).join('\n');
}

function generateCardHTML(employee, templateData, supabaseUrl) {
  if (!templateData.elements || !Array.isArray(templateData.elements)) {
    console.warn('Invalid template data for employee:', employee.employee_id);
    return `<div class="card">Invalid template data</div>`;
  }

  const elementsHTML = templateData.elements.map((element, index) => {
    let content = '';
    let className = `card-element element-${index}`;
    
    switch (element.type) {
      case 'Text':
        content = processTextContent(element.text || '', employee);
        className += ' text';
        return `<div class="${className}">${content}</div>`;
        
      case 'Image':
        className += ' image';
        if (element.src === 'employee_photo' || element.isEmployeePhoto) {
          if (employee.photo_url) {
            const imageUrl = employee.photo_url.startsWith('http') 
              ? employee.photo_url 
              : `${supabaseUrl}/storage/v1/object/public/employee-photos/${employee.photo_url}`;
            return `<div class="${className}"><img src="${imageUrl}" alt="Employee Photo" crossorigin="anonymous" /></div>`;
          } else {
            // Placeholder for missing photo
            return `<div class="${className}" style="background: #f0f0f0; display: flex; align-items: center; justify-content: center; font-size: 10px; color: #666;">No Photo</div>`;
          }
        } else if (element.src === 'qr_code' || element.isQRCode) {
          if (employee.qr_code_path) {
            const qrUrl = employee.qr_code_path.startsWith('http')
              ? employee.qr_code_path
              : `${supabaseUrl}/storage/v1/object/public/qr-codes/${employee.qr_code_path}`;
            return `<div class="${className}"><img src="${qrUrl}" alt="QR Code" crossorigin="anonymous" /></div>`;
          } else {
            // Placeholder for missing QR code
            return `<div class="${className}" style="background: #f0f0f0; display: flex; align-items: center; justify-content: center; font-size: 10px; color: #666;">No QR</div>`;
          }
        } else if (element.src && element.src.startsWith('http')) {
          return `<div class="${className}"><img src="${element.src}" alt="Image" crossorigin="anonymous" /></div>`;
        }
        return `<div class="${className}"></div>`;
        
      case 'Rect':
        className += ' rect';
        return `<div class="${className}"></div>`;
        
      default:
        console.warn('Unknown element type:', element.type);
        return `<div class="${className}"></div>`;
    }
  }).join('');

  return `<div class="card">${elementsHTML}</div>`;
}

function processTextContent(text, employee) {
  if (!text || typeof text !== 'string') return '';
  
  // Replace placeholders with employee data
  return text
    .replace(/\{employee_id\}/g, employee.employee_id || '')
    .replace(/\{first_name\}/g, employee.first_name || '')
    .replace(/\{last_name\}/g, employee.last_name || '')
    .replace(/\{full_name\}/g, `${employee.first_name || ''} ${employee.last_name || ''}`.trim())
    .replace(/\{department\}/g, employee.department || '')
    .replace(/\{position\}/g, employee.position || '')
    .replace(/\{employee_type\}/g, employee.is_temp_employee ? 'ชั่วคราว' : 'ประจำ')
    // เพิ่ม placeholders อื่นๆ ตามต้องการ
    .replace(/\{current_date\}/g, new Date().toLocaleDateString('th-TH'))
    .replace(/\{current_year\}/g, new Date().getFullYear().toString());
}
