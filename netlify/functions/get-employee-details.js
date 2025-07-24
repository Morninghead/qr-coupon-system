import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY; // ใช้ Service Role Key เพื่อให้มีสิทธิ์เข้าถึงข้อมูลที่ต้องการ
const supabaseAdmin = createClient(supabaseUrl, serviceKey);

export const handler = async (event, context) => {
    if (event.httpMethod !== 'GET') {
        return { statusCode: 405, body: 'Method Not Allowed' };
    }

    try {
        // 1. Authentication and Authorization Check
        const token = event.headers.authorization?.split('Bearer ')[1];
        if (!token) {
            return { statusCode: 401, body: JSON.stringify({ message: 'Authentication required' }) };
        }
        const { data: { user }, error: userError } = await supabaseAdmin.auth.getUser(token);
        if (userError || !user) {
            return { statusCode: 401, body: JSON.stringify({ message: 'Invalid token' }) };
        }

        const { data: profile } = await supabaseAdmin.from('profiles').select('role').eq('id', user.id).single();
        if (profile?.role !== 'superuser' && profile?.role !== 'department_admin') {
            return { statusCode: 403, body: JSON.stringify({ message: 'Permission denied. Superuser or Department Admin role required.' }) };
        }

        // 2. Parse Query Parameters
        const { id, type } = event.queryStringParameters;
        if (!id || !type) {
            return { statusCode: 400, body: JSON.stringify({ message: 'Missing employee ID or type.' }) };
        }

        let employeeDetails = null;

        if (type === 'regular') {
            const { data: employee, error } = await supabaseAdmin
                .from('employees')
                .select(`
                    id,
                    employee_id,
                    name,
                    department_id,
                    is_active,
                    permanent_token,
                    photo_url
                `)
                .eq('id', id)
                .single();

            if (error || !employee) {
                if (error && error.code === 'PGRST116') { // No rows found
                    return { statusCode: 404, body: JSON.stringify({ message: 'Regular employee not found.' }) };
                }
                throw error;
            }
            employeeDetails = { ...employee, employee_type: 'regular' };

        } else if (type === 'temp') {
            const { data: tempRequest, error } = await supabaseAdmin
                .from('temporary_coupon_requests')
                .select(`
                    id,
                    temp_employee_name,
                    temp_employee_identifier,
                    reason,
                    coupon_type,
                    issued_at,
                    expires_at,
                    status
                `)
                .eq('id', id)
                .single();
            
            if (error || !tempRequest) {
                 if (error && error.code === 'PGRST116') { // No rows found
                    return { statusCode: 404, body: JSON.stringify({ message: 'Temporary employee request not found.' }) };
                }
                throw error;
            }
            employeeDetails = { 
                id: tempRequest.id,
                employee_id: tempRequest.temp_employee_identifier || `TEMP-${tempRequest.id.substring(0,4)}`,
                name: tempRequest.temp_employee_name,
                department_id: null, // Temporary employees don't have a fixed department
                is_active: true, // Always considered active during validity
                permanent_token: null,
                photo_url: null,
                employee_type: 'temp',
                // Add other temp-specific fields if needed in modal
                reason: tempRequest.reason,
                coupon_type: tempRequest.coupon_type,
                issued_at: tempRequest.issued_at,
                expires_at: tempRequest.expires_at,
                status: tempRequest.status
            };

        } else {
            return { statusCode: 400, body: JSON.stringify({ message: 'Invalid employee type specified.' }) };
        }

        if (!employeeDetails) {
            return { statusCode: 404, body: JSON.stringify({ message: 'Employee not found.' }) };
        }

        return {
            statusCode: 200,
            body: JSON.stringify(employeeDetails),
        };

    } catch (error) {
        console.error('Get Employee Details Error:', error);
        return {
            statusCode: 500,
            body: JSON.stringify({ message: 'Failed to fetch employee details', error: error.message }),
        };
    }
};