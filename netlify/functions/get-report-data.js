import { createClient } from '@supabase/supabase-js';

// Use the Admin client to perform complex queries
const supabaseUrl = process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabaseAdmin = createClient(supabaseUrl, serviceKey);

export const handler = async (event, context) => {
    // Ensure the user is authenticated
    const { user } = context.clientContext;
    if (!user) {
        return { statusCode: 401, body: JSON.stringify({ message: 'Authentication required' }) };
    }

    try {
        const { startDate, endDate, departmentId } = event.queryStringParameters;

        if (!startDate || !endDate) {
            return { statusCode: 400, body: JSON.stringify({ message: 'Start date and end date are required.' }) };
        }

        // Base query for coupons within the date range
        let query = supabaseAdmin
            .from('Daily_Coupons')
            .select('coupon_type, status, Employees!inner(department_id)', { count: 'exact' })
            .gte('coupon_date', startDate)
            .lte('coupon_date', endDate);

        // Apply department filter if specified
        if (departmentId && departmentId !== 'all') {
            query = query.eq('Employees.department_id', departmentId);
        }

        const { data: coupons, error } = await query;

        if (error) throw error;

        // Process the data to get the report summary
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
