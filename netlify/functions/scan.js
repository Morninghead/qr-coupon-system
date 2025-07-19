// Import Supabase client library
import { createClient } from '@supabase/supabase-js';

// Initialize Supabase client
// คุณต้องไปที่ Project Settings > API ใน Supabase เพื่อเอาค่าเหล่านี้มาใส่
const supabaseUrl = 'https://mhwpcesxodqunzwotggz.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1od3BjZXN4b2RxdW56d290Z2d6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTI4OTc3MzIsImV4cCI6MjA2ODQ3MzczMn0.jvSjkkxPcQQanpdvnRQKTilw-M-ntKabbuC72S4kiME';
const supabase = createClient(supabaseUrl, supabaseKey);

// Main function handler
export const handler = async (event) => {
    // 1. รับ Token จาก URL
    const token = event.queryStringParameters.token;

    if (!token) {
        return {
            statusCode: 400,
            body: JSON.stringify({ success: false, message: 'ไม่พบ Token ใน QR Code' }),
        };
    }

    try {
        // 2. ค้นหาพนักงานจาก Token
        const { data: employee, error: employeeError } = await supabase
            .from('Employees')
            .select('id, name, is_active, Departments(name)') // ดึงข้อมูลแผนกมาด้วย
            .eq('permanent_token', token)
            .single();

        if (employeeError || !employee) {
            return {
                statusCode: 404,
                body: JSON.stringify({ success: false, message: 'ไม่พบข้อมูลพนักงาน' }),
            };
        }

        if (!employee.is_active) {
            return {
                statusCode: 403,
                body: JSON.stringify({ success: false, message: 'พนักงานคนนี้ไม่มีสถานะใช้งาน' }),
            };
        }

        // 3. ตรวจสอบว่าวันนี้ใช้สิทธิ์ไปแล้วหรือยัง
        const todayStart = new Date();
        todayStart.setHours(0, 0, 0, 0); // เวลาเที่ยงคืนของวันนี้

        const { data: usageLog, error: logError } = await supabase
            .from('Usage_Logs')
            .select('id')
            .eq('employee_id', employee.id)
            .gte('created_at', todayStart.toISOString());

        if (logError) throw logError;

        if (usageLog.length > 0) {
            return {
                statusCode: 409, // 409 Conflict
                body: JSON.stringify({
                    success: false,
                    message: 'ใช้สิทธิ์สำหรับวันนี้ไปแล้ว',
                    name: employee.name,
                    department: employee.Departments.name,
                }),
            };
        }

        // 4. บันทึกการใช้งาน (ถ้ายังไม่เคยใช้)
        const { error: insertError } = await supabase
            .from('Usage_Logs')
            .insert({ employee_id: employee.id });

        if (insertError) throw insertError;

        // 5. ส่งผลลัพธ์ว่า "อนุมัติ"
        return {
            statusCode: 200,
            body: JSON.stringify({
                success: true,
                message: 'อนุมัติ',
                name: employee.name,
                department: employee.Departments.name,
            }),
        };

    } catch (error) {
        console.error('Error:', error);
        return {
            statusCode: 500,
            body: JSON.stringify({ success: false, message: 'เกิดข้อผิดพลาดในระบบ' }),
        };
    }
};