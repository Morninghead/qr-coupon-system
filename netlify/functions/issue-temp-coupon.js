// issue-temp-coupon.js
import { createClient } from '@supabase/supabase-js';
import { randomUUID } from 'crypto';
import qrcode from 'qrcode';

// Supabase Admin client
const supabaseUrl = process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabaseAdmin = createClient(supabaseUrl, serviceKey);

const TEMP_QR_CODE_BUCKET = 'temporary-qrcodes';
const BASE_SCANNER_URL = 'https://ssth-ecoupon.netlify.app/scanner';

export const handler = async (event, context) => {
    if (event.httpMethod !== 'POST') {
        return { statusCode: 405, body: 'Method Not Allowed' };
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

        const { data: profile } = await supabaseAdmin.from('profiles').select('role').eq('id', user.id).single();
        if (profile?.role !== 'superuser') {
            return { statusCode: 403, body: JSON.stringify({ message: 'Permission denied. Superuser role required.' }) };
        }

        const {
            selected_employee_type,
            employee_identifier,
            temp_employee_name,
            temp_employee_identifier,
            reason,
            coupon_type // Using underscore consistently
        } = JSON.parse(event.body);

        if (!reason || !coupon_type) {
            return { statusCode: 400, body: JSON.stringify({ success: false, message: 'เหตุผลและประเภทคูปองจำเป็นต้องระบุ' }) };
        }

        let targetEmployeeId = null;
        let displayEmployeeName = '';
        let isNewTempEmployee = false;
        let issuedTokenToUse = null;
        let qrCodePublicUrl = null;
        const now = new Date();
        const expiresAt = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);

        if (selected_employee_type === 'existing') {
            if (!employee_identifier) {
                return { statusCode: 400, body: JSON.stringify({ success: false, message: 'กรุณากรอกรหัสพนักงานหรือ Permanent Token สำหรับพนักงานที่มีอยู่แล้ว' }) };
            }
            const isUuid = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(employee_identifier);
            
            let employeeQuery = supabaseAdmin.from('employees').select('id, employee_id, name, is_active, permanent_token');
            if (isUuid) {
                employeeQuery = employeeQuery.eq('permanent_token', employee_identifier);
            } else {
                employeeQuery = employeeQuery.eq('employee_id', employee_identifier);
            }

            const { data: employee, error: employeeFetchError } = await employeeQuery.single();

            if (employeeFetchError || !employee) {
                return { statusCode: 404, body: JSON.stringify({ success: false, message: 'ไม่พบข้อมูลพนักงานที่มีอยู่ตามที่ระบุ' }) };
            }
            if (!employee.is_active) {
                return { statusCode: 403, body: JSON.stringify({ success: false, message: 'พนักงานคนนี้ไม่มีสถานะใช้งาน' }) };
            }
            targetEmployeeId = employee.id;
            displayEmployeeName = employee.name;
            issuedTokenToUse = employee.permanent_token;

            qrCodePublicUrl = `${BASE_SCANNER_URL}?token=${issuedTokenToUse}`;

            const { data: existingTempRequest, error: checkTempReqError } = await supabaseAdmin
                .from('temporary_coupon_requests')
                .select('id, status, expires_at')
                .eq('employee_id', targetEmployeeId)
                .eq('issued_token', issuedTokenToUse)
                .single();

            if (checkTempReqError && checkTempReqError.code !== 'PGRST116') {
                console.error('Error checking existing temporary request:', checkTempReqError);
                throw checkTempReqError;
            }

            const updateData = {
                status: 'ISSUED',
                reason: reason,
                coupon_type: coupon_type, // FIX: Use coupon_type
                expires_at: expiresAt.toISOString(),
                issued_by: user.id,
                updated_at: new Date().toISOString()
            };

            if (existingTempRequest) {
                const { error } = await supabaseAdmin
                    .from('temporary_coupon_requests')
                    .update(updateData)
                    .eq('id', existingTempRequest.id);
                if (error) {
                    console.error('Error updating existing temporary request:', error);
                    throw error;
                }
            } else {
                const insertData = {
                    employee_id: targetEmployeeId,
                    reason: reason,
                    status: 'ISSUED',
                    issued_by: user.id,
                    issued_token: issuedTokenToUse,
                    expires_at: expiresAt.toISOString(),
                    coupon_type: coupon_type, // FIX: Use coupon_type
                };
                const { error } = await supabaseAdmin
                    .from('temporary_coupon_requests')
                    .insert(insertData);
                if (error) {
                    console.error('Error inserting new temporary request for existing employee:', error);
                    throw error;
                }
            }
            
            return {
                statusCode: 200,
                body: JSON.stringify({
                    success: true,
                    message: `ออก QR Code ชั่วคราวสำหรับ ${displayEmployeeName} สำเร็จ`,
                    temporaryToken: issuedTokenToUse,
                    expiresAt: expiresAt.toISOString(),
                    qrCodeUrl: qrCodePublicUrl
                }),
            };

        } else if (selected_employee_type === 'new-temp') {
            isNewTempEmployee = true;
            if (!temp_employee_name) {
                return { statusCode: 400, body: JSON.stringify({ success: false, message: 'กรุณากรอกชื่อ-สกุลของบุคคลชั่วคราว' }) };
            }
            targetEmployeeId = null;
            displayEmployeeName = temp_employee_name;
            issuedTokenToUse = randomUUID();

            const qrCodeData = `${BASE_SCANNER_URL}?token=${issuedTokenToUse}`;
            const qrCodeFileName = `temp-${randomUUID()}.png`;
            
            const qrCodeBuffer = await qrcode.toBuffer(qrCodeData, { type: 'png', errorCorrectionLevel: 'H' });

            const { error: uploadError } = await supabaseAdmin.storage
                .from(TEMP_QR_CODE_BUCKET)
                .upload(qrCodeFileName, qrCodeBuffer, {
                    contentType: 'image/png',
                    upsert: true
                });

            if (uploadError) {
                console.error(`Error uploading temporary QR for ${displayEmployeeName}:`, uploadError);
                return { statusCode: 500, body: JSON.stringify({ success: false, message: `QR Code ถูกสร้างแต่ไม่สามารถอัปโหลดได้: ${uploadError.message}` }) };
            }
            qrCodePublicUrl = `${supabaseUrl}/storage/v1/object/public/${TEMP_QR_CODE_BUCKET}/${qrCodeFileName}`;

            const { error: insertRequestError } = await supabaseAdmin
                .from('temporary_coupon_requests')
                .insert({
                    employee_id: targetEmployeeId,
                    temp_employee_name: temp_employee_name,
                    temp_employee_identifier: temp_employee_identifier || null,
                    reason: reason,
                    status: 'ISSUED',
                    issued_by: user.id,
                    issued_token: issuedTokenToUse,
                    expires_at: expiresAt.toISOString(),
                    coupon_type: coupon_type, // FIX: Use coupon_type
                });

            if (insertRequestError) {
                console.error('Error inserting temporary request for new-temp:', insertRequestError);
                return { statusCode: 500, body: JSON.stringify({ success: false, message: `ไม่สามารถบันทึกคำขอคูปองชั่วคราวได้: ${insertRequestError.message}` }) };
            }

            return {
                statusCode: 200,
                body: JSON.stringify({
                    success: true,
                    message: `ออก QR Code ชั่วคราวสำหรับ ${displayEmployeeName} สำเร็จ`,
                    temporaryToken: issuedTokenToUse,
                    expiresAt: expiresAt.toISOString(),
                    qrCodeUrl: qrCodePublicUrl
                }),
            };
        } else {
            return { statusCode: 400, body: JSON.stringify({ success: false, message: 'ประเภทพนักงานที่เลือกไม่ถูกต้อง' }) };
        }
    } catch (error) {
        console.error('Issue Temporary Coupon Error:', error);
        return {
            statusCode: 500,
            body: JSON.stringify({ success: false, message: 'เกิดข้อผิดพลาดภายในระบบ', error: error.message }),
        };
    }
};