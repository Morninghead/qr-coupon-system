const { createClient } = require('@supabase/supabase-js');

exports.handler = async (event, context) => {
    // CORS headers
    const headers = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Content-Type': 'application/json'
    };

    if (event.httpMethod === 'OPTIONS') {
        return { statusCode: 200, headers, body: '' };
    }

    if (event.httpMethod !== 'POST') {
        return { 
            statusCode: 405, 
            headers, 
            body: JSON.stringify({ error: 'Method Not Allowed' })
        };
    }

    try {
        const supabase = createClient(
            process.env.SUPABASE_URL,
            process.env.SUPABASE_SERVICE_ROLE_KEY
        );

        // ตรวจสอบ Authorization
        const authHeader = event.headers.authorization;
        if (!authHeader) {
            return { 
                statusCode: 401, 
                headers, 
                body: JSON.stringify({ error: 'Missing authorization header' }) 
            };
        }

        const token = authHeader.replace('Bearer ', '');
        const { data: { user }, error: userError } = await supabase.auth.getUser(token);
        
        if (userError || !user) {
            return { 
                statusCode: 401, 
                headers, 
                body: JSON.stringify({ error: 'Invalid token' }) 
            };
        }

        const { template_id, employee_ids, print_settings } = JSON.parse(event.body);

        if (!template_id || !employee_ids || employee_ids.length === 0) {
            return { 
                statusCode: 400, 
                headers, 
                body: JSON.stringify({ error: 'Template ID and employee IDs are required' }) 
            };
        }

        // ดึงข้อมูล template
        const { data: template, error: templateError } = await supabase
            .from('card_templates')
            .select('*')
            .eq('id', template_id)
            .single();

        if (templateError || !template) {
            return { 
                statusCode: 404, 
                headers, 
                body: JSON.stringify({ error: 'Template not found' }) 
            };
        }

        // ดึงข้อมูลพนักงาน
        const { data: employees, error: employeesError } = await supabase
            .from('employees')
            .select('*')
            .in('id', employee_ids);

        if (employeesError) {
            return { 
                statusCode: 500, 
                headers, 
                body: JSON.stringify({ error: 'Failed to fetch employees' }) 
            };
        }

        // สร้าง Mock PDF URL (สำหรับ demo)
        // ในการใช้งานจริงจะต้องใช้ puppeteer หรือ library อื่นสร้าง PDF
        const mockPdfUrl = generateMockPDF(template, employees, print_settings);

        return {
            statusCode: 200,
            headers,
            body: JSON.stringify({
                success: true,
                pdf_url: mockPdfUrl,
                cards_generated: employees.length,
                file_name: `bulk-cards-${Date.now()}.pdf`,
                message: 'Cards generated successfully (Demo Mode)'
            })
        };

    } catch (error) {
        console.error('Error in generate-bulk-cards:', error);
        return { 
            statusCode: 500, 
            headers, 
            body: JSON.stringify({ 
                error: 'Internal server error',
                details: error.message 
            }) 
        };
    }
};

function generateMockPDF(template, employees, printSettings) {
    // Mock PDF generation - ในการใช้งานจริงจะต้องสร้าง PDF จริงๆ
    const timestamp = Date.now();
    const layout = printSettings.layout === 'A3-16cards' ? 'A3' : 'A4';
    
    // สร้าง Base64 PDF เปล่าสำหรับ demo
    const mockPdfBase64 = generateMockPdfBase64(employees.length, layout);
    
    return `data:application/pdf;base64,${mockPdfBase64}`;
}

function generateMockPdfBase64(cardCount, layout) {
    // สร้าง PDF ง่ายๆ สำหรับ demo (ใช้ jsPDF library ใน production)
    const header = '%PDF-1.4\n';
    const content = `1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] >>\nendobj\nxref\n0 4\n0000000000 65535 f \n0000000010 00000 n \n0000000079 00000 n \n0000000173 00000 n \ntrailer\n<< /Size 4 /Root 1 0 R >>\nstartxref\n253\n%%EOF`;
    
    return Buffer.from(header + content).toString('base64');
}
