import { createClient } from '@supabase/supabase-js';
import { randomUUID } from 'crypto'; // Node.js built-in module for UUID

// Use the Admin client to check roles and insert data
const supabaseUrl = process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabaseAdmin = createClient(supabaseUrl, serviceKey);

export const handler = async (event, context) => {
    if (event.httpMethod !== 'POST') {
        return { statusCode: 405, body: 'Method Not Allowed' };
    }

    try {
        // 1. Authenticate user (but don't check role)
        const { user } = context.clientContext;
        if (!user) {
            return { statusCode: 401, body: JSON.stringify({ message: 'Authentication required' }) };
        }

        // --- AUTHORIZATION CHECK DISABLED FOR TESTING ---
        /*
        const { data: profile, error: profileError } = await supabaseAdmin
            .from('profiles')
            .select('role')
            .eq('id', user.sub)
            .single();

        if (profileError || profile.role !== 'superuser') {
            return { statusCode: 403, body: JSON.stringify({ message: 'Permission denied. Superuser access required.' }) };
        }
        */
        // ----------------------------------------------

        // 2. Parse incoming data
        const { employee_id, name } = JSON.parse(event.body);
        if (!employee_id || !name) {
            return { statusCode: 400, body: JSON.stringify({ message: 'Employee ID and Name are required.' }) };
        }

        // 3. Check if employee_id already exists
        const { data: existingEmployee, error: checkError } = await supabaseAdmin
            .from('Employees')
            .select('employee_id')
            .eq('employee_id', employee_id)
            .maybeSingle();
        
        if (checkError) throw checkError;

        if (existingEmployee) {
            return { statusCode: 409, body: JSON.stringify({ message: `Employee ID ${employee_id} already exists.` }) };
        }

        // 4. Prepare new employee data
        const newEmployee = {
            employee_id: employee_id.trim(),
            name: name.trim(),
            permanent_token: randomUUID(), // Generate a new unique token
            is_active: true // New employees are active by default
        };

        // 5. Insert the new employee
        const { error: insertError } = await supabaseAdmin
            .from('Employees')
            .insert(newEmployee);

        if (insertError) throw insertError;

        return {
            statusCode: 200,
            body: JSON.stringify({ message: `Successfully added employee: ${name}` }),
        };

    } catch (error) {
        console.error('Add Employee Error:', error);
        return {
            statusCode: 500,
            body: JSON.stringify({ message: 'An internal server error occurred.', error: error.message }),
        };
    }
};
