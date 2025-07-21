import { createClient } from '@supabase/supabase-js';
import { randomUUID } from 'crypto'; // This is for Node.js environments like Netlify Functions

// ใช้ Admin client เพื่อตรวจสอบสิทธิ์และเพิ่มข้อมูล
const supabaseUrl = process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabaseAdmin = createClient(supabaseUrl, serviceKey);

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

        // 2. ตรวจสอบบทบาท (role) จากตาราง profiles
        // Assumes 'profiles' table has 'id' matching user.id and a 'role' column.
        const { data: profile } = await supabaseAdmin.from('profiles').select('role').eq('id', user.id).single();
        if (profile?.role !== 'superuser') {
            return { statusCode: 403, body: JSON.stringify({ message: 'Permission denied. Superuser role required.' }) };
        }

        // 3. ดำเนินการเพิ่มพนักงาน (โค้ดเดิม)
        const { employees, department_id } = JSON.parse(event.body);
        if (!employees || !department_id || employees.length === 0) {
            return { statusCode: 400, body: JSON.stringify({ message: 'Employee data and department ID are required.' }) };
        }

        // Get existing employee_ids to check for duplicates
        const incomingIds = employees.map(emp => emp.employee_id);
        const { data: existingEmployees, error: checkError } = await supabaseAdmin
            .from('Employees')
            .select('employee_id')
            .in('employee_id', incomingIds);

        if (checkError) {
            console.error("Error checking existing employees:", checkError);
            throw new Error(`Database error during duplicate check: ${checkError.message}`);
        }

        const existingIds = new Set(existingEmployees.map(e => e.employee_id));
        const duplicateIds = incomingIds.filter(id => existingIds.has(id));

        // Filter out duplicates and prepare new employees for insertion
        const newEmployeesToInsert = employees
            .filter(emp => !existingIds.has(emp.employee_id))
            .map(emp => ({
                employee_id: emp.employee_id.trim(),
                name: emp.name.trim(),
                department_id: department_id,
                permanent_token: randomUUID(), // Generates a UUID for permanent_token
                is_active: true, // Sets is_active to true
                // created_at will be automatically handled by Supabase if it's a `timestampz` column with default `now()`
            }));

        if (newEmployeesToInsert.length > 0) {
            const { error: insertError } = await supabaseAdmin.from('Employees').insert(newEmployeesToInsert);
            if (insertError) {
                console.error("Error inserting new employees:", insertError);
                throw new Error(`Database error during insertion: ${insertError.message}`);
            }
        }

        return {
            statusCode: 200,
            body: JSON.stringify({
                message: `Successfully added ${newEmployeesToInsert.length} new employees.`,
                duplicates: duplicateIds
            }),
        };

    } catch (error) {
        console.error('Add Employees Error:', error);
        return {
            statusCode: 500,
            body: JSON.stringify({ message: 'An internal server error occurred.', error: error.message }),
        };
    }
};