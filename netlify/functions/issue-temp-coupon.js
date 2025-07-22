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
        // ตรวจสอบว่ามี Bearer token ใน header หรือไม่
        const token = event.headers.authorization?.split('Bearer ')[1];
        if (!token) {
            return { statusCode: 401, body: JSON.stringify({ message: 'Authentication required' }) };
        }
        
        // ใช้ admin client เพื่อตรวจสอบ session ของผู้ใช้
        const { data: { user }, error: userError } = await supabaseAdmin.auth.getUser(token);
        if (userError || !user) {
            return { statusCode: 401, body: JSON.stringify({ message: 'Invalid token' }) };
        }

        // ตรวจสอบบทบาท (role) ของผู้ใช้จากตาราง profiles ว่าเป็น 'superuser' หรือไม่
        const { data: profile } = await supabaseAdmin.from('profiles').select('role').eq('id', user.id).single();
        if (profile?.role !== 'superuser') {
            return { statusCode: 403, body: JSON.stringify({ message: 'Permission denied. Superuser role required.' }) };
        }

        // --- 2. วิเคราะห์ข้อมูลที่ส่งมาจาก Frontend ---
        const { employee_identifier, reason } = JSON.parse(event.body);
        if (!employee_identifier || !reason) {
            return { statusCode: 400, body: JSON.stringify({ success: false, message: 'รหัสพนักงาน/token และเหตุผลจำเป็นต้องระบุ' }) };
        }

        // --- 3. ค้นหาข้อมูลพนักงานในตาราง Employees ---
        // ตรวจสอบว่า employee_identifier เป็น UUID (permanent_token) หรือ employee_id (รหัสพนักงาน)
        const isUuid = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(employee_identifier);
        
        let employeeQuery = supabaseAdmin.from('Employees').select('id, employee_id, name, is_active');
        if (isUuid) {
            // ถ้าเป็น UUID ให้ค้นหาด้วย permanent_token
            employeeQuery = employeeQuery.eq('permanent_token', employee_identifier);
        } else {
            // ถ้าไม่ใช่ UUID ให้ค้นหาด้วย employee_id
            employeeQuery = employeeQuery.eq('employee_id', employee_identifier);
        }

        const { data: employee, error: employeeFetchError } = await employeeQuery.single();

        if (employeeFetchError || !employee) {
            return {
                statusCode: 404,
                body: JSON.stringify({ success: false, message: 'ไม่พบข้อมูลพนักงานที่ระบุ' })
            };
        }
        // ตรวจสอบสถานะการใช้งานของพนักงาน
        if (!employee.is_active) {
            return {
                statusCode: 403,
                body: JSON.stringify({ success: false, message: 'พนักงานคนนี้ไม่มีสถานะใช้งาน' })
            };
        }

        // --- 4. สร้าง Temporary Token และกำหนดวันหมดอายุ ---
        const temporaryToken = randomUUID(); // สร้าง UUID ใหม่สำหรับ QR Code ชั่วคราวนี้
        // กำหนดเวลาหมดอายุให้เป็นสิ้นสุดของวันปัจจุบัน (เวลาท้องถิ่น)
        const now = new Date();
        const expiresAt = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999); // 23:59:59.999 ของวันเดียวกัน

        // --- 5. บันทึกข้อมูลคำขอชั่วคราวลงในตาราง temporary_coupon_requests ---
        const { data: requestData, error: insertRequestError } = await supabaseAdmin
            .from('temporary_coupon_requests')
            .insert({
                employee_id: employee.id,     // ใช้ ID (UUID) จริงของพนักงานจากตาราง Employees
                reason: reason,
                status: 'ISSUED',             // ตั้งสถานะเริ่มต้นเป็น 'ISSUED' (ออกแล้ว)
                issued_by: user.id,           // ID ของ Superuser ที่เป็นคนออก
                issued_token: temporaryToken, // Token ชั่วคราวที่ใช้สร้าง QR Code
                expires_at: expiresAt.toISOString() // บันทึกเวลาหมดอายุในรูปแบบ ISO
            })
            .select() // เลือกข้อมูลที่เพิ่ง insert เข้าไป
            .single(); // คาดหวังว่าจะมีแค่ record เดียว

        if (insertRequestError) {
            console.error('Error inserting temporary request:', insertRequestError);
            return { statusCode: 500, body: JSON.stringify({ success: false, message: `ไม่สามารถบันทึกคำขอคูปองชั่วคราวได้: ${insertRequestError.message}` }) };
        }

        // --- 6. สร้างและอัปโหลด QR Code ชั่วคราว ---
        const qrCodeData = `${BASE_SCANNER_URL}?token=${temporaryToken}`; // ข้อมูลที่ QR Code จะชี้ไป
        // ตั้งชื่อไฟล์ให้ไม่ซ้ำกัน เช่น temp-รหัสพนักงาน-temporaryToken.png
        const qrCodeFileName = `temp-${employee.employee_id}-${temporaryToken}.png`; 

        // สร้าง QR Code เป็น Buffer (รูปภาพ PNG)
        const qrCodeBuffer = await qrcode.toBuffer(qrCodeData, { type: 'png', errorCorrectionLevel: 'H' });

        // อัปโหลดรูป QR Code ขึ้น Supabase Storage ใน bucket 'temporary-qrcodes'
        const { data: uploadData, error: uploadError } = await supabaseAdmin.storage
            .from(TEMP_QR_CODE_BUCKET)
            .upload(qrCodeFileName, qrCodeBuffer, {
                contentType: 'image/png', // ระบุประเภทไฟล์
                upsert: true              // หากมีไฟล์ชื่อนี้อยู่แล้ว ให้อัปเดตทับ (กรณีนี้ไม่น่าเกิดขึ้นบ่อยเพราะชื่อไฟล์มี UUID)
            });

        if (uploadError) {
            console.error(`Error uploading temporary QR for ${employee.employee_id}:`, uploadError);
            // แม้ว่าอัปโหลด QR จะล้มเหลว แต่คำขอถูกบันทึกแล้ว อาจจะแจ้งให้ผู้ใช้ทราบ
            return { statusCode: 500, body: JSON.stringify({ success: false, message: `QR Code ถูกสร้างแต่ไม่สามารถอัปโหลดได้: ${uploadError.message}` }) };
        }

        // --- 7. ส่งผลลัพธ์สำเร็จกลับไปยัง Frontend ---
        return {
            statusCode: 200,
            body: JSON.stringify({
                success: true,
                message: `ออก QR Code ชั่วคราวสำหรับ ${employee.name} สำเร็จ`,
                temporaryToken: temporaryToken, // ส่ง token กลับไปด้วยเผื่อ Frontend อยากแสดง
                expiresAt: expiresAt.toISOString(), // ส่งเวลาหมดอายุกลับไปด้วย
                qrCodeUrl: `${supabaseUrl}/storage/v1/object/public/${TEMP_QR_CODE_BUCKET}/${qrCodeFileName}` // URL ของรูป QR Code
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