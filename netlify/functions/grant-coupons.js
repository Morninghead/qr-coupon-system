import { createClient } from '@supabase/supabase-js';

// This function requires the Admin client to bypass RLS for role checking
const supabaseUrl = process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY; // Use the SERVICE_ROLE_KEY for admin actions
const supabaseAdmin = createClient(supabaseUrl, serviceKey);

// Helper function to get the current date in Bangkok (YYYY-MM-DD format)
function getBangkokDate() {
    const now = new Date();
    const bangkokOffset = 7 * 60; // +7 hours in minutes
    const localOffset = -now.getTimezoneOffset();
    const totalOffset = bangkokOffset - localOffset;
    
    const bangkokTime = new Date(now.getTime() + totalOffset * 60 * 1000);
    
    const year = bangkokTime.getFullYear();
    const month = String(bangkokTime.getMonth() + 1).padStart(2, '0');
    const day = String(bangkokTime.getDate()).padStart(2, '0');
    
    return `${year}-${month}-${day}`;
}


export const handler = async (event, context) => {
    // 1. Check if it's a POST request
    if (event.httpMethod !== 'POST') {
        return { statusCode: 405, body: 'Method Not Allowed' };
    }

    try {
        // 2. Authenticate and authorize user
        const { user } = context.clientContext;
        if (!user) {
            return { statusCode: 401, body: JSON.stringify({ message: 'Authentication required' }) };
        }

        const { data: profile, error: profileError } = await supabaseAdmin
            .from('profiles')
            .select('role')
            .eq('id', user.sub)
            .single();

        if (profileError || !profile || !['superuser', 'department_admin'].includes(profile.role)) {
            return { statusCode: 403, body: JSON.stringify({ message: 'Permission denied' }) };
        }

        // 3. Parse the incoming data
        const { employeeIds, couponType } = JSON.parse(event.body);
        if (!employeeIds || !couponType || employeeIds.length === 0) {
            return { statusCode: 400, body: JSON.stringify({ message: 'Missing employee IDs or coupon type' }) };
        }

        // 4. Find employee UUIDs from the provided employee_id numbers
        const { data: employees, error: employeesError } = await supabaseAdmin
            .from('Employees')
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

        // 5. Check for existing coupons for these employees on this day and type
        const { data: existingCoupons, error: checkError } = await supabaseAdmin
            .from('Daily_Coupons')
            .select('employee_id')
            .in('employee_id', employeeUuids)
            .eq('coupon_date', today)
            .eq('coupon_type', couponType);

        if (checkError) throw checkError;

        const existingUuids = new Set(existingCoupons.map(c => c.employee_id));
        const employeeIdToUuidMap = new Map(employees.map(e => [e.id, e.employee_id]));
        
        const alreadyExistsIds = Array.from(existingUuids).map(uuid => employeeIdToUuidMap.get(uuid));

        // 6. Filter out employees who already have a coupon
        const employeesToInsert = employees.filter(emp => !existingUuids.has(emp.id));

        if (employeesToInsert.length > 0) {
            const couponsToInsert = employeesToInsert.map(emp => ({
                employee_id: emp.id,
                coupon_date: today,
                coupon_type: couponType,
                status: 'READY'
            }));

            // 7. Insert only the new coupons
            const { error: insertError } = await supabaseAdmin
                .from('Daily_Coupons')
                .insert(couponsToInsert);

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
