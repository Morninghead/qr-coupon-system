// Import Supabase client library
import { createClient } from '@supabase/supabase-js';

// Initialize Supabase client
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

// Main function handler
export const handler = async (event) => {
    // 1. รับ Token จาก URL
    const token = event.queryStringParameters.token;
    
    // --- DEBUG LOG #1 ---
    console.log('Received token:', token);

    if (!token) {
        return {
            statusCode: 400,
            body: JSON.stringify({ success: false, message: 'ไม่พบ Token ใน QR Code' }),
        };
    }

    try {
        // --- ส่วนที่แก้ไข ---
        // 2. ค้นหาพนักงานจาก Token (แบบ Query ง่ายๆ)
        const { data: employee, error: employeeError } = await supabase
            .from('Employees')
            .select('*') // <--- แก้ไขจุดที่ 1: เลือกทุกอย่าง ไม่ join
            .eq('permanent_token', token)
            .single();

        // --- DEBUG LOG #2 ---
        console.log('Supabase data result:', employee);
        console.log('Supabase error result:', employeeError);
        // ------------------

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
                statusCode: 409,
                body: JSON.stringify({
                    success: false,
                    message: 'ใช้สิทธิ์สำหรับวันนี้ไปแล้ว',
                    name: employee.name,
                    // department: employee.Departments.name, // เอาออกชั่วคราว
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
                // department: employee.Departments.name, // เอาออกชั่วคราว
            }),
        };

    } catch (error) {
        // --- DEBUG LOG #3 ---
        console.error('Function crashed with error:', error);
        return {
            statusCode: 500,
            body: JSON.stringify({ success: false, message: 'เกิดข้อผิดพลาดในระบบ' }),
        };
    }
};