const { createClient } = require('@supabase/supabase-js');
const { chromium } = require('playwright-aws-lambda');

exports.handler = async (event, context) => {
  // Set timeout for long-running function
  context.callbackWaitsForEmptyEventLoop = false;
  
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Cache-Control': 'no-cache'
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  const startTime = Date.now();

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

    console.log('PDF Generation Request:', {
      employeeCount: employeeIds?.length,
      templateId,
      timestamp: new Date().toISOString()
    });

    // Validation
    if (!employeeIds || !Array.isArray(employeeIds) || employeeIds.length === 0) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Employee IDs are required and must be an array' })
      };
    }

    if (!templateId) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Template ID is required' })
      };
    }

    if (employeeIds.length > 100) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Maximum 100 employees allowed per request' })
      };
    }

    // ดึงข้อมูล template พร้อม validation
    const { data: template, error: templateError } = await supabase
      .from('card_templates')
      .select('*')
      .eq('id', templateId)
      .single();

    if (templateError || !template) {
      console.error('Template not found:', templateError);
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
        photo_url, qr_code_path, is_temp_employee, created_at
      `)
      .in('id', employeeIds);

    if (employeesError) {
      console.error('Failed to fetch employees:', employeesError);
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

    console.log(`Generating PDF for ${employees.length} employees with template ${template.name}`);

    // สร้าง HTML content สำหรับ PDF generation
    const htmlContent = await generateCardsHTML(employees, template, supabaseUrl);
    
    // สร้าง PDF ด้วย Playwright
    let browser;
    try {
      console.log('Launching Playwright browser...');
      
      // Launch browser with Playwright AWS Lambda
      browser = await chromium.launch({
        args: chromium.args,
        defaultViewport: chromium.defaultViewport,
        executablePath: await chromium.executablePath(),
        headless: chromium.headless,
        ignoreHTTPSErrors: true,
      });

      const context = await browser.newContext({
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36'
      });

      const page = await context.newPage();
      
      console.log('Setting up page configuration...');
      
      // ตั้งค่าขนาดหน้า A4 พร้อม high DPI
      await page.setViewportSize({ 
        width: 794, 
        height: 1123 
      });

      // Set media type to screen for better color rendering
      await page.emulateMedia({ media: 'screen' });

      console.log('Loading HTML content...');
      
      // โหลด HTML content พร้อม wait strategies
      await page.setContent(htmlContent, {
        waitUntil: 'networkidle',
        timeout: 30000
      });

      console.log('Waiting for assets to load...');

      // รอให้ fonts โหลดเสร็จ (Playwright มี auto-wait ที่ดีกว่า)
      await page.waitForLoadState('networkidle');
      
      // รอ fonts โหลดเสร็จ
      await page.evaluate(() => {
        return document.fonts ? document.fonts.ready : Promise.resolve();
      });

      // รอ images โหลดเสร็จพร้อม error handling
      try {
        await page.waitForFunction(() => {
          const images = Array.from(document.querySelectorAll('img'));
          if (images.length === 0) return true;
          
          return images.every(img => {
            return img.complete && (img.naturalWidth > 0 || img.getAttribute('src').includes('placeholder'));
          });
        }, { timeout: 15000 });
      } catch (imageError) {
        console.warn('Some images may not have loaded completely:', imageError.message);
      }

      // รอเพิ่มเติมเพื่อให้แน่ใจว่าทุกอย่างพร้อม
      await page.waitForTimeout(3000);

      console.log('Generating PDF with Playwright...');

      // สร้าง PDF พร้อม options ที่ปรับแต่ง
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
        displayHeaderFooter: false,
        scale: 1.0
      });

      const base64PDF = pdfBuffer.toString('base64');
      const generationTime = Date.now() - startTime;

      console.log(`PDF generated successfully with Playwright in ${generationTime}ms, size: ${base64PDF.length} characters`);

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
          cardCount: employees.length,
          generationTime: generationTime,
          engine: 'Playwright',
          templateName: template.name
        })
      };

    } finally {
      if (browser) {
        console.log('Closing Playwright browser...');
        await browser.close();
      }
    }

  } catch (error) {
    const generationTime = Date.now() - startTime;
    console.error('Error generating PDF with Playwright:', {
      error: error.message,
      stack: error.stack,
      duration: generationTime
    });
    
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ 
        error: 'Failed to generate PDF',
        details: error.message,
        engine: 'Playwright',
        duration: generationTime
      })
    };
  }
};

async function generateCardsHTML(employees, template, supabaseUrl) {
  const templateData = template.template_data;
  
  console.log(`Generating HTML for ${employees.length} cards`);
  console.log(`Template "${template.name}" has ${templateData.elements?.length || 0} elements`);
  
  // สร้าง CSS สำหรับ template
  const templateCSS = generateTemplateCSS(templateData);
  
  // สร้าง HTML สำหรับแต่ละบัตร
  const cardsHTML = employees.map((employee, index) => {
    console.log(`Processing employee ${index + 1}: ${employee.first_name} ${employee.last_name} (${employee.employee_id})`);
    return generateCardHTML(employee, templateData, supabaseUrl);
  }).join('');

  const html = `
    <!DOCTYPE html>
    <html lang="th">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Employee Cards - ${template.name}</title>
      <link rel="preconnect" href="https://fonts.googleapis.com">
      <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
      <link href="https://fonts.googleapis.com/css2?family=Sarabun:wght@300;400;500;600;700&family=Noto+Sans+Thai:wght@300;400;500;600;700&family=Roboto:wght@300;400;500;600;700&display=swap" rel="stylesheet">
      <style>
        * {
          margin: 0;
          padding: 0;
          box-sizing: border-box;
        }
        
        html, body {
          width: 100%;
          height: 100%;
          margin: 0;
          padding: 0;
        }
        
        body {
          font-family: 'Sarabun', 'Noto Sans Thai', 'Roboto', sans-serif;
          font-size: 12px;
          line-height: 1.4;
          background: white;
          color: #000;
          -webkit-print-color-adjust: exact !important;
          color-adjust: exact !important;
          print-color-adjust: exact !important;
        }
        
        .cards-container {
          display: flex;
          flex-wrap: wrap;
          justify-content: flex-start;
          align-content: flex-start;
          gap: 8mm;
          padding: 15mm;
          width: 210mm; /* A4 width */
          min-height: 297mm; /* A4 height */
          box-sizing: border-box;
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
          box-shadow: 0 1px 3px rgba(0,0,0,0.1);
          flex-shrink: 0;
        }
        
        .card img {
          max-width: 100%;
          height: auto;
          display: block;
          object-fit: cover;
          border-radius: 2px;
        }
        
        .card-element {
          position: absolute;
          overflow: hidden;
          line-height: 1.2;
          word-wrap: break-word;
        }
        
        /* Text elements styling */
        .card-element.text {
          display: flex;
          align-items: center;
          justify-content: flex-start;
          white-space: nowrap;
          text-overflow: ellipsis;
        }
        
        .card-element.text.multiline {
          white-space: normal;
          word-wrap: break-word;
          overflow-wrap: break-word;
        }
        
        /* Image elements styling */
        .card-element.image {
          border-radius: 4px;
          overflow: hidden;
        }
        
        .card-element.image img {
          width: 100%;
          height: 100%;
          object-fit: cover;
          object-position: center;
        }
        
        /* Rectangle elements styling */
        .card-element.rect {
          border-radius: 4px;
        }
        
        /* Placeholder styling */
        .placeholder {
          background: #f5f5f5;
          border: 1px dashed #ccc;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 8px;
          color: #666;
          text-align: center;
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
        console.log('Employee Cards HTML loaded successfully with Playwright');
        console.log('Template:', '${template.name}');
        console.log('Total cards:', document.querySelectorAll('.card').length);
        console.log('Total images:', document.querySelectorAll('img').length);
        console.log('Generation timestamp:', new Date().toISOString());
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
    if (element.rotation) {
      css += `  transform: rotate(${element.rotation}deg);\n`;
      css += `  transform-origin: center;\n`;
    }
    
    if (element.scaleX !== undefined && element.scaleY !== undefined && 
        (element.scaleX !== 1 || element.scaleY !== 1)) {
      const existingTransform = element.rotation ? `rotate(${element.rotation}deg) ` : '';
      css += `  transform: ${existingTransform}scale(${element.scaleX}, ${element.scaleY});\n`;
    }
    
    // Opacity
    if (element.opacity !== undefined && element.opacity !== 1) {
      css += `  opacity: ${element.opacity};\n`;
    }
    
    // Visibility
    if (element.visible === false) {
      css += `  display: none;\n`;
    }
    
    // Type-specific styles
    switch (element.type) {
      case 'Text':
        // Text styling
        if (element.fontSize) css += `  font-size: ${element.fontSize}px;\n`;
        if (element.fontFamily) {
          css += `  font-family: '${element.fontFamily}', 'Sarabun', 'Noto Sans Thai', sans-serif;\n`;
        }
        if (element.fill) css += `  color: ${element.fill};\n`;
        
        // Font weight and style
        if (element.fontStyle) {
          if (element.fontStyle.includes('bold')) css += `  font-weight: bold;\n`;
          if (element.fontStyle.includes('italic')) css += `  font-style: italic;\n`;
        }
        
        // Text alignment
        if (element.textAlign) {
          css += `  text-align: ${element.textAlign};\n`;
          switch (element.textAlign) {
            case 'center':
              css += `  justify-content: center;\n`;
              break;
            case 'right':
              css += `  justify-content: flex-end;\n`;
              break;
            default:
              css += `  justify-content: flex-start;\n`;
          }
        }
        
        // Vertical alignment
        if (element.verticalAlign) {
          switch (element.verticalAlign) {
            case 'middle':
              css += `  align-items: center;\n`;
              break;
            case 'bottom':
              css += `  align-items: flex-end;\n`;
              break;
            default:
              css += `  align-items: flex-start;\n`;
          }
        }
        
        css += `  display: flex;\n`;
        
        // Check if text should wrap
        if (element.width && element.text && element.text.length > 20) {
          css += `  white-space: normal;\n`;
          css += `  word-wrap: break-word;\n`;
          css += `  overflow-wrap: break-word;\n`;
        } else {
          css += `  white-space: nowrap;\n`;
          css += `  text-overflow: ellipsis;\n`;
        }
        break;
        
      case 'Rect':
        // Rectangle styling
        if (element.fill) css += `  background-color: ${element.fill};\n`;
        if (element.stroke) {
          css += `  border-color: ${element.stroke};\n`;
          css += `  border-style: solid;\n`;
        }
        if (element.strokeWidth) css += `  border-width: ${element.strokeWidth}px;\n`;
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
    return `<div class="card"><div class="placeholder">Invalid template data</div></div>`;
  }

  const elementsHTML = templateData.elements.map((element, index) => {
    let content = '';
    let className = `card-element element-${index}`;
    
    switch (element.type) {
      case 'Text':
        content = processTextContent(element.text || '', employee);
        className += ' text';
        if (element.width && content.length > 20) {
          className += ' multiline';
        }
        return `<div class="${className}">${content}</div>`;
        
      case 'Image':
        className += ' image';
        if (element.src === 'employee_photo' || element.isEmployeePhoto) {
          if (employee.photo_url) {
            const imageUrl = employee.photo_url.startsWith('http') 
              ? employee.photo_url 
              : `${supabaseUrl}/storage/v1/object/public/employee-photos/${employee.photo_url}`;
            return `<div class="${className}"><img src="${imageUrl}" alt="Employee Photo" loading="eager" crossorigin="anonymous" /></div>`;
          } else {
            return `<div class="${className} placeholder">ไม่มีรูปภาพ</div>`;
          }
        } else if (element.src === 'qr_code' || element.isQRCode) {
          if (employee.qr_code_path) {
            const qrUrl = employee.qr_code_path.startsWith('http')
              ? employee.qr_code_path
              : `${supabaseUrl}/storage/v1/object/public/qr-codes/${employee.qr_code_path}`;
            return `<div class="${className}"><img src="${qrUrl}" alt="QR Code" loading="eager" crossorigin="anonymous" /></div>`;
          } else {
            return `<div class="${className} placeholder">ไม่มี QR Code</div>`;
          }
        } else if (element.src && element.src.startsWith('http')) {
          return `<div class="${className}"><img src="${element.src}" alt="Image" loading="eager" crossorigin="anonymous" /></div>`;
        }
        return `<div class="${className} placeholder">ไม่มีรูปภาพ</div>`;
        
      case 'Rect':
        className += ' rect';
        return `<div class="${className}"></div>`;
        
      default:
        console.warn('Unknown element type:', element.type);
        return `<div class="${className} placeholder">Unknown Element</div>`;
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
    // เพิ่ม placeholders วันที่
    .replace(/\{current_date\}/g, new Date().toLocaleDateString('th-TH'))
    .replace(/\{current_year\}/g, new Date().getFullYear().toString())
    .replace(/\{current_month\}/g, new Date().toLocaleDateString('th-TH', { month: 'long' }))
    // เพิ่ม placeholders สำหรับวันที่สร้างพนักงาน
    .replace(/\{created_date\}/g, employee.created_at ? new Date(employee.created_at).toLocaleDateString('th-TH') : '')
    .replace(/\{created_year\}/g, employee.created_at ? new Date(employee.created_at).getFullYear().toString() : '');
}
