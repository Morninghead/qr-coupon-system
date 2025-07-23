import { createClient } from '@supabase/supabase-js';

// ใช้ Admin client เพื่อตรวจสอบสิทธิ์และดึงข้อมูลพนักงาน
const supabaseUrl = process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY; [cite_start]// [cite: 1]
const supabaseAdmin = createClient(supabaseUrl, serviceKey); [cite_start]// [cite: 1]

// URL ฐานของ Supabase Storage สำหรับ QR code และรูปภาพพนักงาน
const SUPABASE_STORAGE_BASE_URL = `${supabaseUrl}/storage/v1/object/public/employee-qrcodes/`; [cite_start]// [cite: 1]
const EMPLOYEE_PHOTOS_BUCKET_URL = `${supabaseUrl}/storage/v1/object/public/employee-photos/`; [cite_start]// [cite: 1]

export const handler = async (event, context) => {
    // ต้องเป็น GET request
    if (event.httpMethod !== 'GET') {
        return { statusCode: 405, body: 'Method Not Allowed' };
    }

    try {
        [cite_start]// 1. ตรวจสอบ Token และยืนยันตัวตนผู้ใช้ (ต้องเป็น Superuser) [cite: 1]
        const token = event.headers.authorization?.split('Bearer ')[1]; [cite_start]// [cite: 1]
        if (!token) {
            return { statusCode: 401, body: JSON.stringify({ message: 'Authentication required' }) }; [cite_start]// [cite: 1]
        }
        const { data: { user }, error: userError } = await supabaseAdmin.auth.getUser(token); [cite_start]// [cite: 1]
        if (userError || !user) {
            return { statusCode: 401, body: JSON.stringify({ message: 'Invalid token' }) }; [cite_start]// [cite: 1]
        }

        const { data: profile } = await supabaseAdmin.from('profiles').select('role').eq('id', user.id).single(); [cite_start]// [cite: 1]
        if (profile?.role !== 'superuser') {
            return { statusCode: 403, body: JSON.stringify({ message: 'Permission denied. Superuser role required.' }) }; [cite_start]// [cite: 1]
        }

        [cite_start]// 2. ดึงข้อมูลพนักงาน รวมถึง photo_url [cite: 1]
        const { data: employees, error: employeesError } = await supabaseAdmin
            [cite_start].from('employees') // ตรวจสอบว่าใช้ 'employees' ตัวพิมพ์เล็ก [cite: 1]
            [cite_start].select('id, employee_id, name, qr_code_url, photo_url') // ดึง photo_url มาด้วย [cite: 1]
            .order('employee_id', { ascending: true }); [cite_start]// เรียงตามรหัสพนักงาน [cite: 1]

        if (employeesError) {
            console.error('Error fetching employees:', employeesError); [cite_start]// [cite: 1]
            throw employeesError; [cite_start]// [cite: 1]
        }

        if (!employees || employees.length === 0) {
            return {
                statusCode: 200,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ html: '<p style="text-align: center;">ไม่พบข้อมูลพนักงานที่จะสร้างบัตร</p>' })
            };
        }

        [cite_start]// 3. สร้าง HTML String สำหรับบัตรพนักงานแต่ละคน [cite: 1]
        let cardsHtml = '';
        employees.forEach(emp => {
            [cite_start]const qrCodeUrl = emp.qr_code_url || `${SUPABASE_STORAGE_BASE_URL}${emp.employee_id}.png`; // [cite: 1]
            [cite_start]// ใช้ photo_url ที่ดึงมา ถ้าไม่มี ให้ใช้ Placeholder [cite: 1]
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

        [cite_start]// 4. ส่ง HTML String กลับไปให้ Frontend [cite: 1]
        return {
            statusCode: 200,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ html: cardsHtml }),
        };

    } catch (error) {
        console.error('Generate Employee Cards Error:', error); [cite_start]// [cite: 1]
        return {
            statusCode: 500,
            [cite_start]body: JSON.stringify({ message: 'เกิดข้อผิดพลาดในการสร้างบัตรพนักงาน', error: error.message }), // [cite: 1]
        };
    }
};