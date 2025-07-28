const { createClient } = require('@supabase/supabase-js');
const puppeteer = require('puppeteer');

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

    // สร้าง HTML content สำหรับ PDF generation
    const htmlContent = await generateCardsHTML(employees, template, supabaseUrl);
    
    // สร้าง PDF โดยใช้ Puppeteer
    let browser;
    try {
      browser = await puppeteer.launch({
        headless: true,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-web-security',
          '--disable-features=VizDisplayCompositor'
        ]
      });

      const page = await browser.newPage();
      
      // ตั้งค่าขนาดหน้า A4
      await page.setViewport({ width: 794, height: 1123, deviceScaleFactor: 2 });
      
      // โหลด HTML content
      await page.setContent(htmlContent, {
        waitUntil: ['networkidle0', 'domcontentloaded'],
        timeout: 30000
      });

      // รอให้ fonts และ images โหลดเสร็จ
      await page.evaluate(() => {
        return new Promise((resolve) => {
          // รอให้ fonts โหลดเสร็จ
          if (document.fonts) {
            document.fonts.ready.then(() => {
              // รอให้ images โหลดเสร็จ
              const images = document.querySelectorAll('img');
              let loadedImages = 0;
              
              if (images.length === 0) {
                resolve();
                return;
              }

              images.forEach((img) => {
                if (img.complete) {
                  loadedImages++;
                } else {
                  img.onload = () => {
                    loadedImages++;
                    if (loadedImages === images.length) {
                      resolve();
                    }
                  };
                  img.onerror = () => {
                    loadedImages++;
                    if (loadedImages === images.length) {
                      resolve();
                    }
                  };
                }
              });

              if (loadedImages === images.length) {
                resolve();
              }
            });
          } else {
            resolve();
          }
        });
      });

      // รอเพิ่มเติมเพื่อให้แน่ใจว่าทุกอย่างพร้อม
      await page.waitForTimeout(2000);

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
        preferCSSPageSize: true
      });

      const base64PDF = pdfBuffer.toString('base64');

      return {
        statusCode: 200,
        headers: {
          ...headers,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          success: true,
          pdf: base64PDF,
          filename: `employee-cards-${new Date().toISOString().split('T')[0]}.pdf`
        })
      };

    } finally {
      if (browser) {
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
        details: error.message
      })
    };
  }
};

async function generateCardsHTML(employees, template, supabaseUrl) {
  const templateData = template.template_data;
  
  // สร้าง CSS สำหรับ template
  const templateCSS = generateTemplateCSS(templateData);
  
  // สร้าง HTML สำหรับแต่ละบัตร
  const cardsHTML = employees.map(employee => generateCardHTML(employee, templateData, supabaseUrl)).join('');

  return `
    <!DOCTYPE html>
    <html lang="th">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Employee Cards</title>
      <style>
        @import url('https://fonts.googleapis.com/css2?family=Sarabun:wght@300;400;500;600;700&display=swap');
        
        * {
          margin: 0;
          padding: 0;
          box-sizing: border-box;
        }
        
        body {
          font-family: 'Sarabun', sans-serif;
          font-size: 12px;
          line-height: 1.4;
          background: white;
        }
        
        .cards-container {
          display: flex;
          flex-wrap: wrap;
          justify-content: center;
          gap: 10mm;
          padding: 10mm;
        }
        
        .card {
          width: 85.6mm;  /* ขนาดบัตร standard */
          height: 53.98mm;
          position: relative;
          background: white;
          border: 1px solid #ddd;
          border-radius: 8px;
          overflow: hidden;
          page-break-inside: avoid;
          margin-bottom: 5mm;
        }
        
        .card img {
          max-width: 100%;
          height: auto;
          display: block;
        }
        
        .card-element {
          position: absolute;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        
        ${templateCSS}
      </style>
    </head>
    <body>
      <div class="cards-container">
        ${cardsHTML}
      </div>
    </body>
    </html>
  `;
}

function generateTemplateCSS(templateData) {
  if (!templateData.elements || !Array.isArray(templateData.elements)) {
    return '';
  }

  return templateData.elements.map((element, index) => {
    const className = `.element-${index}`;
    let css = `${className} {\n`;
    
    // Position
    if (element.x !== undefined) css += `  left: ${element.x}px;\n`;
    if (element.y !== undefined) css += `  top: ${element.y}px;\n`;
    if (element.width !== undefined) css += `  width: ${element.width}px;\n`;
    if (element.height !== undefined) css += `  height: ${element.height}px;\n`;
    
    // Text styling
    if (element.fontSize) css += `  font-size: ${element.fontSize}px;\n`;
    if (element.fontFamily) css += `  font-family: '${element.fontFamily}', sans-serif;\n`;
    if (element.fill) css += `  color: ${element.fill};\n`;
    if (element.fontStyle === 'bold') css += `  font-weight: bold;\n`;
    if (element.fontStyle === 'italic') css += `  font-style: italic;\n`;
    if (element.textAlign) css += `  text-align: ${element.textAlign};\n`;
    
    // Background
    if (element.fill && element.type === 'rect') {
      css += `  background-color: ${element.fill};\n`;
    }
    
    css += `}\n`;
    return css;
  }).join('\n');
}

function generateCardHTML(employee, templateData, supabaseUrl) {
  if (!templateData.elements || !Array.isArray(templateData.elements)) {
    return `<div class="card">Invalid template data</div>`;
  }

  const elementsHTML = templateData.elements.map((element, index) => {
    let content = '';
    let className = `card-element element-${index}`;
    
    switch (element.type) {
      case 'text':
        content = processTextContent(element.text || '', employee);
        return `<div class="${className}">${content}</div>`;
        
      case 'image':
        if (element.src === 'employee_photo' && employee.photo_url) {
          const imageUrl = employee.photo_url.startsWith('http') 
            ? employee.photo_url 
            : `${supabaseUrl}/storage/v1/object/public/employee-photos/${employee.photo_url}`;
          return `<img class="${className}" src="${imageUrl}" alt="Employee Photo" />`;
        } else if (element.src === 'qr_code' && employee.qr_code_path) {
          const qrUrl = employee.qr_code_path.startsWith('http')
            ? employee.qr_code_path
            : `${supabaseUrl}/storage/v1/object/public/qr-codes/${employee.qr_code_path}`;
          return `<img class="${className}" src="${qrUrl}" alt="QR Code" />`;
        }
        return `<div class="${className}"></div>`;
        
      case 'rect':
        return `<div class="${className}"></div>`;
        
      default:
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
    .replace(/\{employee_type\}/g, employee.is_temp_employee ? 'ชั่วคราว' : 'ประจำ');
}
