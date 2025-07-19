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
            .select('id, name, is_active')
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

        // 3. ค้นหาคูปองที่พร้อมใช้งานสำหรับวันนี้
        const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD

        const { data: availableCoupon, error: couponError } = await supabase
            .from('Daily_Coupons')
            .select('id, coupon_type')
            .eq('employee_id', employee.id)
            .eq('coupon_date', today)
            .eq('status', 'READY')
            .limit(1) // เอาใบแรกที่เจอ
            .single();

        if (couponError || !availableCoupon) {
            return {
                statusCode: 404,
                body: JSON.stringify({
                    success: false,
                    message: 'ไม่พบสิทธิ์ที่พร้อมใช้งานสำหรับวันนี้',
                    name: employee.name,
                }),
            };
        }

        // 4. อัปเดตสถานะคูปองเป็น USED
        const { error: updateError } = await supabase
            .from('Daily_Coupons')
            .update({
                status: 'USED',
                used_at: new Date().toISOString(),
            })
            .eq('id', availableCoupon.id);

        if (updateError) {
            throw updateError;
        }

        // 5. ส่งผลลัพธ์ว่า "อนุมัติ"
        return {
            statusCode: 200,
            body: JSON.stringify({
                success: true,
                message: `อนุมัติ (ประเภท: ${availableCoupon.coupon_type})`,
                name: employee.name,
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