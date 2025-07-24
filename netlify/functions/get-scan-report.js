import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL;
// **สำคัญ:** ใช้ Service Role Key เพื่อให้ Function มีสิทธิ์ดึงข้อมูลที่อาจติด RLS
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY; 
const supabaseAdmin = createClient(supabaseUrl, serviceKey); // ใช้ supabaseAdmin

export const handler = async (event) => {
    const page = parseInt(event.queryStringParameters.page) || 1;
    const limit = 50;
    const offset = (page - 1) * limit;

    const today = new Date().toISOString().split('T')[0];

    // รับค่าตัวกรองจาก Frontend (เพิ่มใหม่)
    const startDate = event.queryStringParameters.startDate;
    const endDate = event.queryStringParameters.endDate;
    const departmentId = event.queryStringParameters.departmentId;

    try {
        // --- 1. ดึงข้อมูลการใช้คูปองจาก daily_coupons (พนักงานประจำ) ---
        let dailyCouponsQuery = supabaseAdmin 
            .from('daily_coupons')
            .select(`
                id,
                used_at,
                coupon_type,
                employees ( name, employee_id, department_id ) // ดึง department_id ของพนักงาน
            `)
            .eq('status', 'USED')
            .gte('coupon_date', startDate || today) // ใช้ startDate/endDate หรือวันนี้
            .lte('coupon_date', endDate || today);

        // เพิ่มการกรองตามแผนกสำหรับ daily_coupons
        if (departmentId && departmentId !== 'all') {
            dailyCouponsQuery = dailyCouponsQuery.eq('employees.department_id', departmentId);
        }

        const { data: dailyCouponsData, error: dailyError } = await dailyCouponsQuery;

        if (dailyError) {
            console.error('Error fetching daily coupons for report:', dailyError);
            throw dailyError;
        }

        // --- 2. ดึงข้อมูลการใช้คูปองชั่วคราวจาก temporary_coupon_requests (บุคคลใหม่/ไม่รู้จัก) ---
        let tempRequestsQuery = supabaseAdmin 
            .from('temporary_coupon_requests')
            .select(`
                id,
                used_at,
                coupon_type,
                temp_employee_name,
                temp_employee_identifier,
                employee_id // ใช้เพื่อกรอง IS NULL
            `)
            .eq('status', 'USED')
            .gte('request_date', startDate || today) // ใช้ startDate/endDate หรือวันนี้
            .lte('request_date', endDate || today)
            .is('employee_id', null); // กรองเฉพาะบุคคลใหม่/ไม่รู้จัก

        // หมายเหตุ: สำหรับ temporary_coupon_requests ที่ employee_id เป็น NULL เราจะไม่มี department_id ให้กรอง
        // ดังนั้น ถ้ามีการเลือก departmentId เฉพาะเจาะจง temp requests ที่ไม่มี employee_id จะไม่ถูกกรองออก

        const { data: tempRequestsData, error: tempError } = await tempRequestsQuery;

        if (tempError) {
            console.error('Error fetching temporary requests for report:', tempError);
            throw tempError;
        }

        // --- 3. รวมและจัดรูปแบบข้อมูล ---
        let combinedReportData = [];

        dailyCouponsData.forEach(item => {
            combinedReportData.push({
                used_at: item.used_at,
                coupon_type: item.coupon_type,
                employee_id: item.employees ? item.employees.employee_id : 'N/A',
                name: item.employees ? item.employees.name : 'ไม่ระบุชื่อ',
                source: 'daily_coupon' 
            });
        });

        tempRequestsData.forEach(item => {
            combinedReportData.push({
                used_at: item.used_at,
                coupon_type: item.coupon_type,
                employee_id: item.temp_employee_identifier || 'N/A',
                name: item.temp_employee_name || 'บุคคลชั่วคราว',
                source: 'temporary_coupon'
            });
        });

        combinedReportData.sort((a, b) => new Date(b.used_at) - new Date(a.used_at));

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