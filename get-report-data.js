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

        // 2. ดำเนินการดึงข้อมูลรายงาน
        const { startDate, endDate, departmentId } = event.queryStringParameters;
        if (!startDate || !endDate) {
            return { statusCode: 400, body: JSON.stringify({ message: 'Start date and end date are required.' }) };
        }

        // Initialize report structure
        const report = {
            normalData: { totalGranted: 0, totalUsed: 0 },
            otData: { totalGranted: 0, totalUsed: 0 }
        };

        // --- Fetch Daily Coupons (for regular employees) ---
        let dailyCouponQuery = supabaseAdmin
            .from('daily_coupons')
            .select(`coupon_type, status, employees(department_id)`, { count: 'exact' })
            .gte('coupon_date', startDate)
            .lte('coupon_date', endDate);

        if (departmentId && departmentId !== 'all') {
            dailyCouponQuery = dailyCouponQuery.eq('employees.department_id', departmentId);
        }

        const { data: dailyCoupons, error: dailyCouponError } = await dailyCouponQuery;
        if (dailyCouponError) {
            console.error('Error fetching daily coupons for report:', dailyCouponError);
            throw dailyCouponError;
        }

        // Aggregate data from daily_coupons
        for (const coupon of dailyCoupons) {
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

        // --- Fetch Temporary Coupon Requests (for NEW temp individuals only, that are USED) ---
        // These are temporary coupons not linked to a regular employee_id.
        // We consider these as 'granted' and 'used' simultaneously for the purpose of this report.
        let tempCouponQuery = supabaseAdmin
            .from('temporary_coupon_requests')
            .select(`coupon_type, status, employee_id, expires_at`, { count: 'exact' })
            .gte('expires_at', startDate + 'T00:00:00Z') // Use expires_at for date range, assuming it's end of day
            .lte('expires_at', endDate + 'T23:59:59Z') // End of day for end date
            .is('employee_id', null) // Only for new/unknown temp individuals
            .eq('status', 'USED'); // Only count if actually used

        // No department filter for new temp individuals as they don't have one
        // If searching by department, this block might be excluded or handled differently

        const { data: tempCoupons, error: tempCouponError } = await tempCouponQuery;
        if (tempCouponError) {
            console.error('Error fetching temporary coupons for report:', tempCouponError);
            throw tempCouponError;
        }

        // Aggregate data from temporary_coupon_requests (new temp only)
        for (const tempCoupon of tempCoupons) {
            if (tempCoupon.coupon_type === 'NORMAL') {
                // For temporary coupons, if status is 'USED', it implies both granted and used for report purposes
                report.normalData.totalGranted++; 
                report.normalData.totalUsed++;
            } else if (tempCoupon.coupon_type === 'OT') {
                report.otData.totalGranted++;
                report.otData.totalUsed++;
            }
        }
        
        // Ensure totalGranted is at least equal to totalUsed for chart calculation
        report.normalData.totalGranted = Math.max(report.normalData.totalGranted, report.normalData.totalUsed);
        report.otData.totalGranted = Math.max(report.otData.totalGranted, report.otData.totalUsed);

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