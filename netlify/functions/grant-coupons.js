import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabaseAdmin = createClient(supabaseUrl, serviceKey);

function getBangkokDate() {
    const now = new Date();
    // Adjusted to ensure consistent timezone for date calculations if not handled by Supabase default
    // For Netlify, process.env.TZ might be 'Etc/UTC', so explicit conversion is safer.
    const bangkokTime = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Bangkok' }));
    return bangkokTime.toISOString().split('T')[0];
}

export const handler = async (event, context) => {
    if (event.httpMethod !== 'POST') {
        return { statusCode: 405, body: 'Method Not Allowed' };
    }

    try {
        // 1. ตรวจสอบ Token และยืนยันตัวตนผู้ใช้
        const token = event.headers.authorization?.split('Bearer ')[1];
        if (!token) {
            return { statusCode: 401, body: JSON.stringify({ message: 'Authentication required' }) };
        }
        const { data: { user }, error: userError } = await supabaseAdmin.auth.getUser(token);
        if (userError || !user) {
            return { statusCode: 401, body: JSON.stringify({ message: 'Invalid token' }) };
        }
        
        // 2. ตรวจสอบสิทธิ์ - อนุญาตเฉพาะ 'superuser' หรือ 'department_admin'
        const { data: profile, error: profileError } = await supabaseAdmin
            .from('profiles') // ถูกต้องแล้ว
            .select('role')
            .eq('id', user.id)
            .single();

        if (profileError || !profile || !['superuser', 'department_admin'].includes(profile.role)) {
            return { statusCode: 403, body: JSON.stringify({ message: 'Permission denied' }) };
        }

        // 3. ดำเนินการให้สิทธิ์คูปอง
        const { employeeIds, couponType } = JSON.parse(event.body);
        if (!employeeIds || !couponType || employeeIds.length === 0) {
            return { statusCode: 400, body: JSON.stringify({ message: 'Missing employee IDs or coupon type' }) };
        }

        const { data: employees, error: employeesError } = await supabaseAdmin
            .from('employees') // <<< แก้ไขตรงนี้: 'Employees' -> 'employees'
            .select('id, employee_id')
            .in('employee_id', employeeIds);

        if (employeesError) throw employeesError;

        const foundEmployeeMap = new Map(employees.map(e => [e.employee_id, e.id]));
        const notFoundIds = employeeIds.filter(id => !foundEmployeeMap.has(id));

        if (employees.length === 0) {
            return { statusCode: 404, body: JSON.stringify({ message: 'No valid employees found.', notFound: notFoundIds }) };
        }
        
        const today = getBangkokDate();
        const employeeUuids = employees.map(e => e.id);

        const { data: existingCoupons, error: checkError } = await supabaseAdmin
            .from('daily_coupons') // <<< แก้ไขตรงนี้: 'Daily_Coupons' -> 'daily_coupons'
            .select('employee_id')
            .in('employee_id', employeeUuids)
            .eq('coupon_date', today)
            .eq('coupon_type', couponType);

        if (checkError) throw checkError;

        const existingUuids = new Set(existingCoupons.map(c => c.employee_id));
        const employeeIdToUuidMap = new Map(employees.map(e => [e.id, e.employee_id]));
        const alreadyExistsIds = Array.from(existingUuids).map(uuid => employeeIdToUuidMap.get(uuid));
        const employeesToInsert = employees.filter(emp => !existingUuids.has(emp.id));

        if (employeesToInsert.length > 0) {
            const couponsToInsert = employeesToInsert.map(emp => ({
                employee_id: emp.id,
                coupon_date: today,
                coupon_type: couponType,
                status: 'READY'
            }));

            const { error: insertError } = await supabaseAdmin.from('daily_coupons').insert(couponsToInsert); // <<< แก้ไขตรงนี้: 'Daily_Coupons' -> 'daily_coupons'
            if (insertError) throw insertError;
        }

        return {
            statusCode: 200,
            body: JSON.stringify({
                message: `Successfully granted coupons for ${employeesToInsert.length} employees.`,
                notFound: notFoundIds,
                alreadyExists: alreadyExistsIds
            }),
        };

    } catch (error) {
        console.error('Grant Coupon Error:', error);
        return {
            statusCode: 500,
            body: JSON.stringify({ message: 'An internal server error occurred.', error: error.message }),
        };
    }
};