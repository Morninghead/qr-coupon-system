// get-scan-report.js
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY; 
const supabaseAdmin = createClient(supabaseUrl, serviceKey);

export const handler = async (event) => {
    const page = parseInt(event.queryStringParameters.page) || 1;
    const limit = 50; 
    const offset = (page - 1) * limit;

    const today = new Date().toISOString().split('T')[0]; 

    try {
        // Query the combined view for today's scan report
        const { data: combinedReportData, error: reportError, count: totalCount } = await supabaseAdmin
            .from('daily_scan_report_view') // <<< ดึงจาก View แทน
            .select('*', { count: 'exact' }) // Select all columns from the view
            .gte('used_at', today + 'T00:00:00Z') // Filter by used_at for today
            .lte('used_at', today + 'T23:59:59Z')
            .order('used_at', { ascending: false })
            .range(offset, offset + limit - 1); // Apply pagination here

        if (reportError) {
            console.error('Error fetching combined scan report:', reportError);
            throw reportError;
        }
        
        const paginatedData = combinedReportData.map(item => ({
            used_at: item.used_at,
            coupon_type: item.coupon_type,
            employee_id: item.employee_id,
            name: item.name,
            employee_type: item.employee_type,
            source: item.source_table,
            scan_source: item.scan_source // <<< NEW: Include scan_source
        }));

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