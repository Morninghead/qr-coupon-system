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

        // --- Step A: Call PostgreSQL RPC Function for combined aggregation ---
        let rpcArgs = { start_date: startDate, end_date: endDate };
        if (departmentId && departmentId !== 'all') {
            rpcArgs.dept_id = departmentId;
        }

        const { data: dbReport, error: rpcError } = await supabaseAdmin.rpc('get_report_summary', rpcArgs);

        if (rpcError) {
            console.error('Error calling get_report_summary RPC:', rpcError);
            throw rpcError;
        }

        // Map results from DB function to report object
        for (const row of dbReport) {
            if (row.coupon_type === 'NORMAL') {
                report.normalData.totalGranted = row.total_granted;
                report.normalData.totalUsed = row.total_used;
            } else if (row.coupon_type === 'OT') {
                report.otData.totalGranted = row.total_granted;
                report.otData.totalUsed = row.total_used;
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