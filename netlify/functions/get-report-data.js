// get-report-data.js
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabaseAdmin = createClient(supabaseUrl, serviceKey);

export const handler = async (event, context) => {
    // 1. ตรวจสอบ Token และยืนยันตัวตนผู้ใช้
    const token = event.headers.authorization?.split('Bearer ')[1];
    if (!token) {
        return { statusCode: 401, body: JSON.stringify({ message: 'Authentication required' }) };
    }
    try {
        const { data: { user }, error: userError } = await supabaseAdmin.auth.getUser(token);
        if (userError || !user) {
            return { statusCode: 401, body: JSON.stringify({ message: 'Invalid token' }) };
        }

        // 2. ดำเนินการดึงข้อมูลรายงาน (โค้ดเดิม)
        const { startDate, endDate, departmentId } = event.queryStringParameters;
        if (!startDate || !endDate) {
            return { statusCode: 400, body: JSON.stringify({ message: 'Start date and end date are required.' }) };
        }

        let query = supabaseAdmin
            .from('daily_coupons') // แก้ไขตรงนี้: 'Daily_Coupons' -> 'daily_coupons'
            .select(`coupon_type, status, employees!inner(department_id)`, { count: 'exact' }) // แก้ไขตรงนี้: 'Employees' -> 'employees'
            .gte('coupon_date', startDate)
            .lte('coupon_date', endDate);

        if (departmentId && departmentId !== 'all') {
            query = query.eq('employees.department_id', departmentId); // แก้ไขตรงนี้: 'Employees' -> 'employees'
        }

        const { data: coupons, error } = await query;
        if (error) throw error;

        const report = {
            normalData: { totalGranted: 0, totalUsed: 0 },
            otData: { totalGranted: 0, totalUsed: 0 }
        };

        for (const coupon of coupons) {
            if (coupon.coupon_type === 'NORMAL') {
                report.normalData.totalGranted++;
                if (coupon.status === 'USED') {
                    report.normalData.totalUsed++;
                }
            } else if (coupon.coupon_type === 'OT') {
                report.otData.totalGranted++;
                if (coupon.status === 'USED') {
                    report.otData.totalUsed++;
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