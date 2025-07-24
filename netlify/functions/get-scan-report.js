// get-scan-report.js
// Import Supabase client library
import { createClient } from '@supabase/supabase-js';

// Initialize Supabase client
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY; // Using the regular Supabase key
const supabase = createClient(supabaseUrl, supabaseKey);

/**
 * This function fetches a paginated list of today's used coupons
 * from both daily_coupons (regular employees) and temporary_coupon_requests (new/unknown).
 */
export const handler = async (event) => {
    // Default to page 1, limit 50 records
    const page = parseInt(event.queryStringParameters.page) || 1;
    const limit = 50; // Fixed to 50 records per page
    const offset = (page - 1) * limit;

    const today = new Date().toISOString().split('T')[0]; // Format: YYYY-MM-DD

    try {
        // --- 1. Query daily_coupons (for regular employees) ---
        const { data: dailyCouponsData, error: dailyError } = await supabase
            .from('daily_coupons')
            .select(`
                used_at,
                coupon_type,
                employees ( name, employee_id )
            `)
            .eq('status', 'USED')
            .eq('coupon_date', today)
            .order('used_at', { ascending: false });

        if (dailyError) {
            console.error('Error fetching daily coupons for report:', dailyError);
            throw dailyError;
        }

        // --- 2. Query temporary_coupon_requests (for new/unknown individuals) ---
        const { data: tempRequestsData, error: tempError } = await supabase
            .from('temporary_coupon_requests')
            .select(`
                used_at,
                coupon_type,
                temp_employee_name,
                temp_employee_identifier,
                employee_id // To filter for IS NULL later
            `)
            .eq('status', 'USED')
            .eq('request_date', today) // Assuming temporary requests also have a 'request_date'
            .is('employee_id', null) // Filter for temporary/unknown individuals
            .order('used_at', { ascending: false });

        if (tempError) {
            console.error('Error fetching temporary requests for report:', tempError);
            throw tempError;
        }

        // --- 3. Combine and Format Data ---
        let combinedReportData = [];

        // Add daily_coupons data
        dailyCouponsData.forEach(item => {
            combinedReportData.push({
                used_at: item.used_at,
                coupon_type: item.coupon_type,
                employee_id: item.employees ? item.employees.employee_id : 'N/A',
                name: item.employees ? item.employees.name : 'ไม่ระบุชื่อ',
                source: 'daily_coupon'
            });
        });

        // Add temporary_coupon_requests data
        tempRequestsData.forEach(item => {
            combinedReportData.push({
                used_at: item.used_at,
                coupon_type: item.coupon_type,
                employee_id: item.temp_employee_identifier || 'N/A', // Use identifier for employee_id
                name: item.temp_employee_name || 'บุคคลชั่วคราว', // Use temp name for name
                source: 'temporary_coupon'
            });
        });

        // Sort the combined data by used_at (most recent first)
        combinedReportData.sort((a, b) => new Date(b.used_at) - new Date(a.used_at));

        // --- 4. Paginate the Combined Data ---
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