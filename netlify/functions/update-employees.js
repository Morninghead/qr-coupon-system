import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY; // ใช้ Service Role Key เพื่อให้มีสิทธิ์อัปเดตข้อมูล
const supabaseAdmin = createClient(supabaseUrl, serviceKey);

export const handler = async (event, context) => {
    if (event.httpMethod !== 'POST') {
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
        // การแก้ไขข้อมูลพนักงานควรจำกัดเฉพาะ superuser หรือ department_admin
        // ถ้าเป็นการอัปเดต is_active ควรเป็น superuser เท่านั้น
        if (profile?.role !== 'superuser' && profile?.role !== 'department_admin') {
            return { statusCode: 403, body: JSON.stringify({ message: 'Permission denied. Superuser or Department Admin role required.' }) };
        }

        // 2. Parse Request Body
        const { id, type, name, department_id, is_active } = JSON.parse(event.body);

        if (!id || !type || !name === undefined) { // name can be empty if it's a toggle status call
            return { statusCode: 400, body: JSON.stringify({ message: 'Missing required fields: id, type, name.' }) };
        }

        let updateResult = null;

        if (type === 'regular') {
            if (profile.role !== 'superuser' && profile.role !== 'department_admin') {
                 return { statusCode: 403, body: JSON.stringify({ message: 'Permission denied for regular employee update.' }) };
            }

            const updateData = { name: name };
            if (department_id !== undefined) {
                updateData.department_id = department_id;
            }
            if (is_active !== undefined) {
                if (profile.role !== 'superuser') { // Only superuser can change active status
                    return { statusCode: 403, body: JSON.stringify({ message: 'Permission denied. Only Superuser can change employee status.' }) };
                }
                updateData.is_active = is_active;
            }

            const { data, error } = await supabaseAdmin
                .from('employees')
                .update(updateData)
                .eq('id', id)
                .select(); // Select the updated row to confirm

            if (error) throw error;
            if (!data || data.length === 0) {
                return { statusCode: 404, body: JSON.stringify({ message: 'Regular employee not found or no changes made.' }) };
            }
            updateResult = data[0];

        } else if (type === 'temp') {
            if (profile.role !== 'superuser') { // Only superuser can edit temp employee details
                return { statusCode: 403, body: JSON.stringify({ message: 'Permission denied for temporary employee update.' }) };
            }
            // For temporary employees, we mainly update their name/identifier if needed
            const updateData = { temp_employee_name: name };
            // temp_employee_identifier might also be updated if it was edited
            // Note: The UI for temp employees in manage-employees.html currently only shows 'name' for editing.
            // If temp_employee_identifier is editable, add it here.

            const { data, error } = await supabaseAdmin
                .from('temporary_coupon_requests')
                .update(updateData)
                .eq('id', id)
                .select(); // Select the updated row to confirm

            if (error) throw error;
            if (!data || data.length === 0) {
                return { statusCode: 404, body: JSON.stringify({ message: 'Temporary employee request not found or no changes made.' }) };
            }
            updateResult = data[0];

        } else {
            return { statusCode: 400, body: JSON.stringify({ message: 'Invalid employee type for update.' }) };
        }

        return {
            statusCode: 200,
            body: JSON.stringify({ success: true, message: 'Employee updated successfully.', data: updateResult }),
        };

    } catch (error) {
        console.error('Update Employee Error:', error);
        return {
            statusCode: 500,
            body: JSON.stringify({ message: 'Failed to update employee', error: error.message }),
        };
    }
};