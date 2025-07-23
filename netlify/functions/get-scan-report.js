import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY; // ใช้ ANON_KEY สำหรับ client-side calls
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY; // ใช้ SERVICE_ROLE_KEY สำหรับ server-side ops
const supabaseAdmin = createClient(supabaseUrl, serviceKey); // Client ที่มีสิทธิ์แอดมิน

export const handler = async (event) => {
    const page = parseInt(event.queryStringParameters.page) || 1;
    const limit = 50;
    const offset = (page - 1) * limit;

    const today = new Date().toISOString().split('T')[0];

    try {
        // --- 1. ดึงข้อมูลการใช้คูปองจาก daily_coupons (พนักงานประจำ) ---
        const { data: dailyCouponsData, error: dailyError } = await supabaseAdmin // ใช้ supabaseAdmin เพื่อดึงข้อมูลทั้งหมด
            .from('daily_coupons')
            .select(`
                id,
                used_at,
                coupon_type,
                employees ( name, employee_id )
            `)
            .eq('status', 'USED')
            .eq('coupon_date', today);

        if (dailyError) {
            console.error('Error fetching daily coupons for report:', dailyError);
            throw dailyError;
        }

        // --- 2. ดึงข้อมูลการใช้คูปองชั่วคราวจาก temporary_coupon_requests (บุคคลใหม่/ไม่รู้จัก) ---
        const { data: tempRequestsData, error: tempError } = await supabaseAdmin // ใช้ supabaseAdmin
            .from('temporary_coupon_requests')
            .select(`
                id,
                used_at,
                coupon_type,
                temp_employee_name,
                temp_employee_identifier,
                employee_id // เพื่อกรอง IS NULL
            `)
            .eq('status', 'USED')
            .eq('request_date', today)
            .is('employee_id', null); // <<< สำคัญ: กรองเฉพาะบุคคลใหม่/ไม่รู้จัก

        if (tempError) {
            console.error('Error fetching temporary requests for report:', tempError);
            throw tempError;
        }

        // --- 3. รวมและจัดรูปแบบข้อมูล ---
        let combinedReportData = [];

        // เพิ่มข้อมูลจาก daily_coupons
        dailyCouponsData.forEach(item => {
            combinedReportData.push({
                used_at: item.used_at,
                coupon_type: item.coupon_type,
                employee_id: item.employees ? item.employees.employee_id : 'N/A',
                name: item.employees ? item.employees.name : 'ไม่ระบุชื่อ',
                source: 'daily_coupon' // ระบุแหล่งที่มา
            });
        });

        // เพิ่มข้อมูลจาก temporary_coupon_requests (เฉพาะบุคคลใหม่)
        tempRequestsData.forEach(item => {
            combinedReportData.push({
                used_at: item.used_at,
                coupon_type: item.coupon_type,
                employee_id: item.temp_employee_identifier || 'N/A', // ใช้รหัสชั่วคราว
                name: item.temp_employee_name || 'บุคคลชั่วคราว',
                source: 'temporary_coupon' // ระบุแหล่งที่มา
            });
        });

        // เรียงลำดับข้อมูลทั้งหมดตามเวลาที่ใช้ล่าสุด (Descending)
        combinedReportData.sort((a, b) => new Date(b.used_at) - new Date(a.used_at));

        // --- 4. จัดการ Pagination (ใช้ข้อมูลรวม) ---
        const totalCount = combinedReportData.length;
        const paginatedData = combinedReportData.slice(offset, offset + limit);

        return {
            statusCode: 200,
            body: JSON.stringify({
                data: paginatedData,
                totalCount: totalCount,
                currentPage: page,
                totalPages: Math.ceil(totalCount / limit),
            }),
        };

    } catch (error) {
        console.error('Error fetching scan report:', error);
        return {
            statusCode: 500,
            body: JSON.stringify({ success: false, message: 'เกิดข้อผิดพลาดในการดึงข้อมูลรายงาน', error: error.message }),
        };
    }
};