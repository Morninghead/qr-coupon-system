import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabaseAdmin = createClient(supabaseUrl, serviceKey);

export const handler = async (event, context) => {
    const token = event.headers.authorization?.split('Bearer ')[1];
    if (!token) {
        return { statusCode: 401, body: JSON.stringify({ message: 'Authentication required' }) };
    }
    try {
        const { data: { user }, error: userError } = await supabaseAdmin.auth.getUser(token);
        if (userError || !user) {
            return { statusCode: 401, body: JSON.stringify({ message: 'Invalid token' }) };
        }
    
        const { startDate, endDate, departmentId } = event.queryStringParameters;
        if (!startDate || !endDate) {
            return { statusCode: 400, body: JSON.stringify({ message: 'Start date and end date are required.' }) };
        }

        // --- 1. ดึงข้อมูลคูปองจาก daily_coupons (สำหรับพนักงานประจำ) ---
        // เพิ่ม coupon_value ใน select ด้วย
        let dailyCouponsQuery = supabaseAdmin
            .from('daily_coupons')
            .select('coupon_type, status, coupon_value, employees!inner(department_id)', { count: 'exact' })
            .gte('coupon_date', startDate)
            .lte('coupon_date', endDate);

        if (departmentId && departmentId !== 'all') {
            dailyCouponsQuery = dailyCouponsQuery.eq('employees.department_id', departmentId);
        }

        const { data: dailyCoupons, error: dailyCouponsError } = await dailyCouponsQuery;
        if (dailyCouponsError) {
            console.error('Error fetching daily coupons for report:', dailyCouponsError);
            throw dailyCouponsError;
        }

        // --- 2. ดึงข้อมูลคูปองชั่วคราวจาก temporary_coupon_requests (สำหรับบุคคลใหม่/ไม่รู้จัก) ---
        // (เราจะรวมเฉพาะที่ employee_id เป็น NULL เพื่อหลีกเลี่ยงการนับซ้ำกับ Daily_Coupons)
        // เพิ่ม coupon_value ใน select ด้วย
        let tempRequestsQuery = supabaseAdmin
            .from('temporary_coupon_requests')
            .select('coupon_type, status, coupon_value', { count: 'exact' })
            .gte('request_date', startDate)
            .lte('request_date', endDate)
            .is('employee_id', null); // <<< สำคัญ: กรองเฉพาะบุคคลใหม่/ไม่รู้จัก

        const { data: tempRequests, error: tempRequestsError } = await tempRequestsQuery;
        if (tempRequestsError) {
            console.error('Error fetching temporary requests for report:', tempRequestsError);
            throw tempRequestsError;
        }

        // --- 3. รวมและคำนวณรายงาน ---
        const report = {
            normalData: { totalGranted: 0, totalUsed: 0, totalUsedAmount: 0 },
            otData: { totalGranted: 0, totalUsed: 0, totalUsedAmount: 0 }
        };

        // คำนวณจาก daily_coupons
        for (const coupon of dailyCoupons) {
            if (coupon.coupon_type === 'NORMAL') {
                report.normalData.totalGranted++;
                if (coupon.status === 'USED') {
                    report.normalData.totalUsed++;
                    report.normalData.totalUsedAmount += (coupon.coupon_value || 0);
                }
            } else if (coupon.coupon_type === 'OT') {
                report.otData.totalGranted++;
                if (coupon.status === 'USED') {
                    report.otData.totalUsed++;
                    report.otData.totalUsedAmount += (coupon.coupon_value || 0);
                }
            }
        }

        // เพิ่มการคำนวณจาก temporary_coupon_requests (เฉพาะ totalUsed และ totalUsedAmount)
        for (const tempReq of tempRequests) {
            if (tempReq.status === 'USED') {
                if (tempReq.coupon_type === 'NORMAL') {
                    report.normalData.totalUsed++;
                    report.normalData.totalUsedAmount += (tempReq.coupon_value || 0);
                } else if (tempReq.coupon_type === 'OT') {
                    report.otData.totalUsed++;
                    report.otData.totalUsedAmount += (tempReq.coupon_value || 0);
                }
            }
        }

        return {
            statusCode: 200,
            body: JSON.stringify(report),
        };

    } catch (error) {
        console.error('Get Report Data Error:', error);
        return {
            statusCode: 500,
            body: JSON.stringify({ message: 'Failed to fetch report data', error: error.message }),
        };
    }
};