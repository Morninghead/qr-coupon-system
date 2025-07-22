import { createClient } from '@supabase/supabase-js';
import { randomUUID } from 'crypto';
import qrcode from 'qrcode'; // <--- เพิ่ม import qrcode

// ใช้ Admin client เพื่อตรวจสอบสิทธิ์และเพิ่มข้อมูล
const supabaseUrl = process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabaseAdmin = createClient(supabaseUrl, serviceKey);

// กำหนดชื่อ QR Code Storage Bucket
const QR_CODE_BUCKET = 'employee-qrcodes'; // <--- ชื่อ bucket ที่สร้างไว้ใน Supabase Storage
const BASE_SCANNER_URL = 'https://ssth-ecoupon.netlify.app/scanner'; // <--- อัปเดต URL จริง

export const handler = async (event, context) => {
    if (event.httpMethod !== 'POST') {
        return { statusCode: 405, body: 'Method Not Allowed' };
    }

    try {
        // 1. ตรวจสอบ Token และยืนยันตัวตนผู้ใช้
        const token = event.headers.authorization?.split('Bearer ')[1];
        if (!token) {
            return { statusCode: 401, body: JSON.stringify({ message: 'Authentication required' }) };
        }
        const { data: { user }, error: userError } = await supabaseAdmin.auth.getUser(token);
        if (userError || !user) {
            return { statusCode: 401, body: JSON.stringify({ message: 'Invalid token' }) };
        }

        // 2. ตรวจสอบบทบาท (role) จากตาราง profiles
        const { data: profile } = await supabaseAdmin.from('profiles').select('role').eq('id', user.id).single();
        if (profile?.role !== 'superuser') {
            return { statusCode: 403, body: JSON.stringify({ message: 'Permission denied. Superuser role required.' }) };
        }

        // 3. ดำเนินการเพิ่มพนักงาน (โค้ดเดิม)
        const { employees, department_id } = JSON.parse(event.body);
        if (!employees || !department_id || employees.length === 0) {
            return { statusCode: 400, body: JSON.stringify({ message: 'Employee data and department ID are required.' }) };
        }

        const incomingIds = employees.map(emp => emp.employee_id);
        const { data: existingEmployees, error: checkError } = await supabaseAdmin
            .from('Employees')
            .select('employee_id')
            .in('employee_id', incomingIds);

        if (checkError) throw checkError;

        const existingIds = new Set(existingEmployees.map(e => e.employee_id));
        const duplicateIds = incomingIds.filter(id => existingIds.has(id));

        const newEmployeesToInsert = employees
            .filter(emp => !existingIds.has(emp.employee_id))
            .map(emp => ({
                employee_id: emp.employee_id.trim(),
                name: emp.name.trim(),
                department_id: department_id,
                permanent_token: randomUUID(), // สร้าง token ที่นี่
                is_active: true
            }));

        let insertedCount = 0;
        let qrCodeErrors = [];
        let qrCodeUrls = {}; // Optional: to store URLs if you add a column

        // Process new employees one by one to generate QR codes
        for (const newEmp of newEmployeesToInsert) {
            try {
                // Insert employee into database first to get the id (UUID)
                // If you refer to `id` from Employees table as Foreign Key in Daily_Coupons
                // This step is crucial. However, if you use `permanent_token` as the main identifier
                // for the QR Code and the foreign key, then permanent_token is already generated.
                // Assuming permanent_token is what you want in the QR code.

                const { error: insertError } = await supabaseAdmin.from('Employees').insert(newEmp);
                if (insertError) {
                    console.error(`Error inserting employee ${newEmp.employee_id}:`, insertError);
                    // If insert fails for one employee, skip QR code for them
                    qrCodeErrors.push(`Failed to insert employee ${newEmp.employee_id}: ${insertError.message}`);
                    continue; // Skip QR generation for this failed employee
                }
                insertedCount++;

                // --- Start QR Code Generation ---
                const qrCodeData = `${BASE_SCANNER_URL}?token=${newEmp.permanent_token}`;
                const qrCodeFileName = `${newEmp.employee_id}.png`; // ใช้ employee_id เป็นชื่อไฟล์

                // Generate QR Code as Buffer (PNG)
                const qrCodeBuffer = await qrcode.toBuffer(qrCodeData, { type: 'png', errorCorrectionLevel: 'H' });

                // Upload QR Code to Supabase Storage
                const { data: uploadData, error: uploadError } = await supabaseAdmin.storage
                    .from(QR_CODE_BUCKET)
                    .upload(qrCodeFileName, qrCodeBuffer, {
                        contentType: 'image/png',
                        upsert: true // หากมีไฟล์ชื่อนี้อยู่แล้ว ให้อัปเดตทับ
                    });

                if (uploadError) {
                    console.error(`Error uploading QR for ${newEmp.employee_id}:`, uploadError);
                    qrCodeErrors.push(`Failed to upload QR for ${newEmp.employee_id}: ${uploadError.message}`);
                } else {
                    // Get public URL (only if bucket is public, or generate signed URL for private)
                    const publicUrl = `${supabaseUrl}/storage/v1/object/public/${QR_CODE_BUCKET}/${qrCodeFileName}`;
                    qrCodeUrls[newEmp.employee_id] = publicUrl;

                    // Optional: Update employee record with QR code URL if you have a column for it
                     const { error: updateQrUrlError } = await supabaseAdmin
                         .from('Employees')
                         .update({ qr_code_url: publicUrl })
                         .eq('employee_id', newEmp.employee_id);
                    if (updateQrUrlError) {
                     console.error(`Error updating QR URL for ${newEmp.employee_id}:`, updateQrUrlError);
                    }
                }
                // --- End QR Code Generation ---

            } catch (qrGenError) {
                console.error(`Unexpected error during QR code generation for ${newEmp.employee_id}:`, qrGenError);
                qrCodeErrors.push(`Unexpected error for ${newEmp.employee_id}: ${qrGenError.message}`);
            }
        }

        let finalMessage = `Successfully added ${insertedCount} new employees.`;
        if (duplicateIds.length > 0) {
            finalMessage += `\nรหัสซ้ำ (ไม่ถูกเพิ่ม): ${duplicateIds.join(', ')}`;
        }
        if (qrCodeErrors.length > 0) {
            finalMessage += `\nข้อผิดพลาดในการสร้าง/อัปโหลด QR Code: ${qrCodeErrors.join('; ')}`;
        }

        return {
            statusCode: 200,
            body: JSON.stringify({
                message: finalMessage,
                duplicates: duplicateIds,
                qrCodeUrls: qrCodeUrls // Optional: return the URLs
            }),
        };

    } catch (error) {
        console.error('Add Employees Error:', error);
        return {
            statusCode: 500,
            body: JSON.stringify({ message: 'An internal server error occurred.', error: error.message }),
        };
    }
};