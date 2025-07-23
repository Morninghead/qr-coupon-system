import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabaseAdmin = createClient(supabaseUrl, serviceKey);

const SUPABASE_STORAGE_BASE_URL = `${supabaseUrl}/storage/v1/object/public/employee-qrcodes/`;
const EMPLOYEE_PHOTOS_BUCKET_URL = `${supabaseUrl}/storage/v1/object/public/employee-photos/`;

export const handler = async (event, context) => {
    if (event.httpMethod !== 'GET') {
        return { statusCode: 405, body: JSON.stringify({ message: 'Method Not Allowed' }) };
    }

    try {
        const token = event.headers.authorization?.split('Bearer ')[1];
        if (!token) {
            return { statusCode: 401, body: JSON.stringify({ message: 'Authentication required' }) };
        }
        const { data: { user }, error: userError } = await supabaseAdmin.auth.getUser(token);
        if (userError || !user) {
            return { statusCode: 401, body: JSON.stringify({ message: 'Invalid token' }) };
        }

        const { data: profile, error: profileCheckError } = await supabaseAdmin.from('profiles').select('role').eq('id', user.id).single();
        // ตรวจสอบ Error จากการดึง Profile ด้วย
        if (profileCheckError) {
             console.error('Profile fetch error:', profileCheckError);
             return { statusCode: 500, body: JSON.stringify({ message: 'เกิดข้อผิดพลาดในการตรวจสอบสิทธิ์ผู้ใช้' }) };
        }
        if (profile?.role !== 'superuser') {
            return { statusCode: 403, body: JSON.stringify({ message: 'Permission denied. Superuser role required.' }) };
        }

        const { data: employees, error: employeesError } = await supabaseAdmin
            .from('employees')
            .select('id, employee_id, name, qr_code_url, photo_url')
            .order('employee_id', { ascending: true });

        if (employeesError) {
            console.error('Error fetching employees:', employeesError);
            // ส่งข้อความ Error ที่ชัดเจนจาก Database
            return { statusCode: 500, body: JSON.stringify({ message: `ไม่สามารถดึงข้อมูลพนักงานได้: ${employeesError.message || 'ไม่ทราบสาเหตุ'}` }) };
        }

        if (!employees || employees.length === 0) {
            return {
                statusCode: 200,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ html: '<p style="text-align: center;">ไม่พบข้อมูลพนักงานที่จะสร้างบัตร</p>' })
            };
        }

        let cardsHtml = '';
        employees.forEach(emp => {
            const qrCodeUrl = emp.qr_code_url || `${SUPABASE_STORAGE_BASE_URL}${emp.employee_id}.png`;
            const employeePhotoUrl = emp.photo_url || `https://via.placeholder.com/300x300?text=${encodeURIComponent(emp.name.split(' ')[0])}`; 
            
            cardsHtml += `
            <div class="employee-card-container">
                <div class="employee-card-page-layout">
                    <div class="card-side card-front">
                        <img src="https://via.placeholder.com/60x60?text=LOGO" alt="Company Logo" class="company-logo">
                        <p class="company-name">ชื่อบริษัทของคุณ</p>
                        <img src="${employeePhotoUrl}" alt="Employee Photo" class="employee-photo">
                        <h3 class="employee-name">${emp.name}</h3>
                        <p class="employee-id">รหัสพนักงาน: ${emp.employee_id}</p>
                        <p class="card-tagline">บัตรประจำตัวพนักงาน</p>
                    </div>
                    <div class="card-side card-back">
                        <div class="qr-code-area">
                            <img src="${qrCodeUrl}" alt="QR Code for ${emp.employee_id}" class="qr-code-image">
                        </div>
                        <p class="scan-info">สแกนเพื่อรับสิทธิ์คูปอง</p>
                        <p class="card-note">หมายเหตุ: บัตรนี้ใช้เพื่อจุดประสงค์ภายในเท่านั้น<br>ห้ามใช้เพื่อยืนยันตัวตนภายนอก</p>
                    </div>
                </div>
            </div>
            `;
        });

        return {
            statusCode: 200,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ html: cardsHtml }),
        };

    } catch (error) {
        console.error('Generate Employee Cards Error:', error);
        return {
            statusCode: 500,
            body: JSON.stringify({ message: `เกิดข้อผิดพลาดภายในระบบ: ${error.message || 'ไม่ทราบสาเหตุ'}` }), // ทำให้ message ชัดเจนขึ้น
        };
    }
};