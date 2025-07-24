// add-employees.js
import { createClient } from '@supabase/supabase-js';
import { randomUUID } from 'crypto';
import qrcode from 'qrcode';

// ใช้ Admin client เพื่อตรวจสอบสิทธิ์และเพิ่มข้อมูล
const supabaseUrl = process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabaseAdmin = createClient(supabaseUrl, serviceKey);

// กำหนดชื่อ QR Code Storage Bucket
const QR_CODE_BUCKET = 'employee-qrcodes'; 
const BASE_SCANNER_URL = 'https://ssth-ecoupon.netlify.app/scanner'; 

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

        // 3. ดำเนินการเพิ่มพนักงาน
        const { employees } = JSON.parse(event.body); // department_id is no longer a single value from frontend
        if (!employees || employees.length === 0) {
            return { statusCode: 400, body: JSON.stringify({ message: 'Employee data is required.' }) };
        }

        // Fetch all departments to map names to IDs
        const { data: departments, error: deptError } = await supabaseAdmin
            .from('departments')
            .select('id, name');
        
        if (deptError) {
            console.error('Error fetching departments:', deptError);
            throw new Error('Failed to fetch department data.');
        }

        const departmentMap = new Map(departments.map(dept => [dept.name.toLowerCase(), dept.id]));

        const incomingIds = employees.map(emp => emp.employee_id);
        const { data: existingEmployees, error: checkError } = await supabaseAdmin
            .from('employees')
            .select('employee_id')
            .in('employee_id', incomingIds);

        if (checkError) throw checkError;

        const existingIds = new Set(existingEmployees.map(e => e.employee_id));
        const duplicateIds = incomingIds.filter(id => existingIds.has(id));

        let newEmployeesToInsert = [];
        let invalidDepartments = [];

        for (const emp of employees) {
            if (!existingIds.has(emp.employee_id)) {
                let department_id_to_use = null;
                if (emp.department_name) {
                    department_id_to_use = departmentMap.get(emp.department_name.toLowerCase());
                    if (!department_id_to_use) {
                        invalidDepartments.push(emp.employee_id); // Track employees with invalid department names
                    }
                }

                newEmployeesToInsert.push({
                    employee_id: emp.employee_id.trim(),
                    name: emp.name.trim(),
                    department_id: department_id_to_use, // Use looked-up ID, or null
                    permanent_token: randomUUID(), 
                    is_active: true
                });
            }
        }

        let insertedCount = 0;
        let qrCodeErrors = [];
        let qrCodeUrls = {}; 

        for (const newEmp of newEmployeesToInsert) {
            try {
                const { error: insertError } = await supabaseAdmin.from('employees').insert(newEmp); 
                if (insertError) {
                    console.error(`Error inserting employee ${newEmp.employee_id}:`, insertError);
                    qrCodeErrors.push(`Failed to insert employee ${newEmp.employee_id}: ${insertError.message}`);
                    continue; 
                }
                insertedCount++;

                const qrCodeData = `${BASE_SCANNER_URL}?token=${newEmp.permanent_token}`;
                const qrCodeFileName = `${newEmp.employee_id}.png`; 

                const qrCodeBuffer = await qrcode.toBuffer(qrCodeData, { type: 'png', errorCorrectionLevel: 'H' });

                const { data: uploadData, error: uploadError } = await supabaseAdmin.storage
                    .from(QR_CODE_BUCKET)
                    .upload(qrCodeFileName, qrCodeBuffer, {
                        contentType: 'image/png',
                        upsert: true 
                    });

                if (uploadError) {
                    console.error(`Error uploading QR for ${newEmp.employee_id}:`, uploadError);
                    qrCodeErrors.push(`Failed to upload QR for ${newEmp.employee_id}: ${uploadError.message}`);
                } else {
                    const publicUrl = `${supabaseUrl}/storage/v1/object/public/${QR_CODE_BUCKET}/${qrCodeFileName}`;
                    qrCodeUrls[newEmp.employee_id] = publicUrl;

                    const { error: updateQrUrlError } = await supabaseAdmin
                        .from('employees') 
                        .update({ qr_code_url: publicUrl })
                        .eq('employee_id', newEmp.employee_id);
                    if (updateQrUrlError) {
                        console.error(`Error updating QR URL for ${newEmp.employee_id}:`, updateQrUrlError);
                    }
                }

            } catch (qrGenError) {
                console.error(`Unexpected error during QR code generation for ${newEmp.employee_id}:`, qrGenError);
                qrCodeErrors.push(`Unexpected error for ${newEmp.employee_id}: ${qrGenError.message}`);
            }
        }

        let finalMessage = `เพิ่มพนักงานใหม่สำเร็จ ${insertedCount} รายการ`;
        if (duplicateIds.length > 0) {
            finalMessage += `\nรหัสซ้ำ (ไม่ถูกเพิ่ม): ${duplicateIds.join(', ')}`;
        }
        if (invalidDepartments.length > 0) { // New: Add message for invalid departments
            finalMessage += `\nแผนกไม่ถูกต้อง (ไม่ถูกผูกกับแผนก): ${invalidDepartments.join(', ')}`;
        }
        if (qrCodeErrors.length > 0) {
            finalMessage += `\nข้อผิดพลาดในการสร้าง/อัปโหลด QR Code: ${qrCodeErrors.join('; ')}`;
        }

        return {
            statusCode: 200,
            body: JSON.stringify({
                message: finalMessage,
                duplicates: duplicateIds,
                invalidDepartments: invalidDepartments, // New: Return invalid departments
                qrCodeUrls: qrCodeUrls 
            }),
        };

    } catch (error) {
        console.error('Add Employees Error:', error);
        return {
            statusCode: 500,
            body: JSON.stringify({ message: 'เกิดข้อผิดพลาดภายในระบบ', error: error.message }),
        };
    }
};