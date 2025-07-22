import { createClient } from '@supabase/supabase-js';
import { randomUUID } from 'crypto';
import qrcode from 'qrcode';

// Supabase Admin client (with service_role_key สำหรับสิทธิ์ที่สูงขึ้น)
const supabaseUrl = process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabaseAdmin = createClient(supabaseUrl, serviceKey);

// Storage bucket สำหรับ QR Code ชั่วคราวที่เราสร้างไว้ในส่วนที่แล้ว
const TEMP_QR_CODE_BUCKET = 'temporary-qrcodes'; 
// URL จริงของหน้า Scanner ของคุณ (**สำคัญมาก! ต้องเปลี่ยนเป็น Domain ของคุณจริงๆ**)
const BASE_SCANNER_URL = 'https://ssth-ecoupon.netlify.app/scanner'; 

export const handler = async (event, context) => {
    // ตรวจสอบว่าเป็น HTTP POST request เท่านั้น
    if (event.httpMethod !== 'POST') {
        return { statusCode: 405, body: 'Method Not Allowed' };
    }

    try {
        // --- 1. การตรวจสอบสิทธิ์และยืนยันตัวตนผู้ใช้ (Authentication and Authorization) ---
        const token = event.headers.authorization?.split('Bearer ')[1];
        if (!token) {
            return { statusCode: 401, body: JSON.stringify({ message: 'Authentication required' }) };
        }
        
        const { data: { user }, error: userError } = await supabaseAdmin.auth.getUser(token);
        if (userError || !user) {
            return { statusCode: 401, body: JSON.stringify({ message: 'Invalid token' }) };
        }

        const { data: profile } = await supabaseAdmin.from('profiles').select('role').eq('id', user.id).single();
        if (profile?.role !== 'superuser') {
            return { statusCode: 403, body: JSON.stringify({ message: 'Permission denied. Superuser role required.' }) };
        }

        // --- 2. วิเคราะห์ข้อมูลที่ส่งมาจาก Frontend ---
        // **ปรับปรุง: รับ coupon_type ด้วย**
        const { employee_identifier, reason, coupon_type } = JSON.parse(event.body);
        if (!employee_identifier || !reason || !coupon_type) {
            return { statusCode: 400, body: JSON.stringify({ success: false, message: 'รหัสพนักงาน/token, เหตุผล และประเภทคูปองจำเป็นต้องระบุ' }) };
        }

        // --- 3. ค้นหาข้อมูลพนักงานในตาราง Employees ---
        const isUuid = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(employee_identifier);
        
        let employeeQuery = supabaseAdmin.from('Employees').select('id, employee_id, name, is_active');
        if (isUuid) {
            employeeQuery = employeeQuery.eq('permanent_token', employee_identifier);
        } else {
            employeeQuery = employeeQuery.eq('employee_id', employee_identifier);
        }

        const { data: employee, error: employeeFetchError } = await employeeQuery.single();

        if (employeeFetchError || !employee) {
            return {
                statusCode: 404,
                body: JSON.stringify({ success: false, message: 'ไม่พบข้อมูลพนักงานที่ระบุ' })
            };
        }
        if (!employee.is_active) {
            return {
                statusCode: 403,
                body: JSON.stringify({ success: false, message: 'พนักงานคนนี้ไม่มีสถานะใช้งาน' })
            };
        }

        // --- 4. สร้าง Temporary Token และกำหนดวันหมดอายุ ---
        const temporaryToken = randomUUID(); 
        const now = new Date();
        const expiresAt = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999); 

        // --- 5. บันทึกข้อมูลคำขอชั่วคราวลงในตาราง temporary_coupon_requests ---
        // **ปรับปรุง: เพิ่ม coupon_type เข้าไปในการ insert**
        const { data: requestData, error: insertRequestError } = await supabaseAdmin
            .from('temporary_coupon_requests')
            .insert({
                employee_id: employee.id,     
                reason: reason,
                status: 'ISSUED',             
                issued_by: user.id,           
                issued_token: temporaryToken, 
                expires_at: expiresAt.toISOString(), 
                coupon_type: coupon_type      // **เพิ่มบรรทัดนี้**
            })
            .select() 
            .single(); 

        if (insertRequestError) {
            console.error('Error inserting temporary request:', insertRequestError);
            return { statusCode: 500, body: JSON.stringify({ success: false, message: `ไม่สามารถบันทึกคำขอคูปองชั่วคราวได้: ${insertRequestError.message}` }) };
        }

        // --- 6. สร้างและอัปโหลด QR Code ชั่วคราว ---
        const qrCodeData = `${BASE_SCANNER_URL}?token=${temporaryToken}`;
        const qrCodeFileName = `temp-${employee.employee_id}-${temporaryToken}.png`; 

        const qrCodeBuffer = await qrcode.toBuffer(qrCodeData, { type: 'png', errorCorrectionLevel: 'H' });

        const { data: uploadData, error: uploadError } = await supabaseAdmin.storage
            .from(TEMP_QR_CODE_BUCKET)
            .upload(qrCodeFileName, qrCodeBuffer, {
                contentType: 'image/png',
                upsert: true              
            });

        if (uploadError) {
            console.error(`Error uploading temporary QR for ${employee.employee_id}:`, uploadError);
            return { statusCode: 500, body: JSON.stringify({ success: false, message: `QR Code ถูกสร้างแต่ไม่สามารถอัปโหลดได้: ${uploadError.message}` }) };
        }

        // --- 7. ส่งผลลัพธ์สำเร็จกลับไปยัง Frontend ---
        return {
            statusCode: 200,
            body: JSON.stringify({
                success: true,
                message: `ออก QR Code ชั่วคราวสำหรับ ${employee.name} สำเร็จ`,
                temporaryToken: temporaryToken, 
                expiresAt: expiresAt.toISOString(), 
                qrCodeUrl: `${supabaseUrl}/storage/v1/object/public/${TEMP_QR_CODE_BUCKET}/${qrCodeFileName}`
            }),
        };

    } catch (error) {
        console.error('Issue Temporary Coupon Error:', error);
        return {
            statusCode: 500,
            body: JSON.stringify({ success: false, message: 'เกิดข้อผิดพลาดภายในระบบ', error: error.message }),
        };
    }
};