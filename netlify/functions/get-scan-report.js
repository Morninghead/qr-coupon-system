// get-scan-report.js
// Import Supabase client library
import { createClient } from '@supabase/supabase-js';

// Initialize Supabase client
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

/**
 * This function fetches a paginated list of today's used coupons.
 * It joins with the employees table to get employee details.
 */
export const handler = async (event) => {
    // Default to page 1, limit 50 records
    const page = parseInt(event.queryStringParameters.page) || 1;
    const limit = 50; // Fixed to 50 records per page
    const offset = (page - 1) * limit;

    const today = new Date().toISOString().split('T')[0]; // Format: YYYY-MM-DD

    try {
        // Query to get the paginated list of used coupons
        const { data: reportData, error: reportError } = await supabase
            .from('daily_coupons') // <<< แก้ไขตรงนี้
            .select(`
                used_at,
                coupon_type,
                employees ( name, employee_id ) // <<< แก้ไขตรงนี้ (ใน string literal)
            `)
            .eq('status', 'USED')
            .eq('coupon_date', today)
            .order('used_at', { ascending: false })
            .range(offset, offset + limit - 1);

        if (reportError) {
            throw reportError;
        }

        // Query to get the total count of used coupons for today for pagination
        const { count, error: countError } = await supabase
            .from('daily_coupons') // <<< แก้ไขตรงนี้
            .select('*', { count: 'exact', head: true })
            .eq('status', 'USED')
            .eq('coupon_date', today);

        if (countError) {
            throw countError;
        }

        return {
            statusCode: 200,
            body: JSON.stringify({
                data: reportData,
                totalCount: count,
                currentPage: page,
                totalPages: Math.ceil(count / limit),
            }),
        };

    } catch (error) {
        console.error('Error fetching scan report:', error);
        return {
            statusCode: 500,
            body: JSON.stringify({ success: false, message: 'เกิดข้อผิดพลาดในการดึงข้อมูลรายงาน' }),
        };
    }
};