import { createClient } from '@supabase/supabase-js';
import { randomUUID } from 'crypto';

// Use the Admin client to bypass RLS for role checking and insertion
const supabaseUrl = process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabaseAdmin = createClient(supabaseUrl, serviceKey);

export const handler = async (event, context) => {
    if (event.httpMethod !== 'POST') {
        return { statusCode: 405, body: 'Method Not Allowed' };
    }

    try {
        // 1. Authorize: only superusers can add employees
        const { user } = context.clientContext;
        if (!user) {
            return { statusCode: 401, body: JSON.stringify({ message: 'Authentication required' }) };
        }
        const { data: profile } = await supabaseAdmin.from('profiles').select('role').eq('id', user.sub).single();
        if (profile?.role !== 'superuser') {
            return { statusCode: 403, body: JSON.stringify({ message: 'Permission denied.' }) };
        }

        // 2. Parse incoming data
        const { employees, department_id } = JSON.parse(event.body);
        if (!employees || !department_id || employees.length === 0) {
            return { statusCode: 400, body: JSON.stringify({ message: 'Employee data and department ID are required.' }) };
        }

        const incomingIds = employees.map(emp => emp.employee_id);

        // 3. Check for existing employee_ids
        const { data: existingEmployees, error: checkError } = await supabaseAdmin
            .from('Employees')
            .select('employee_id')
            .in('employee_id', incomingIds);
        
        if (checkError) throw checkError;

        const existingIds = new Set(existingEmployees.map(e => e.employee_id));
        const duplicateIds = incomingIds.filter(id => existingIds.has(id));
        
        // 4. Filter out duplicates to get only new employees
        const newEmployeesToInsert = employees
            .filter(emp => !existingIds.has(emp.employee_id))
            .map(emp => ({
                employee_id: emp.employee_id.trim(),
                name: emp.name.trim(),
                department_id: department_id,
                permanent_token: randomUUID(),
                is_active: true
            }));

        if (newEmployeesToInsert.length > 0) {
            const { error: insertError } = await supabaseAdmin
                .from('Employees')
                .insert(newEmployeesToInsert);

            if (insertError) throw insertError;
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
