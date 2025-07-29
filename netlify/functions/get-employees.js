// /netlify/functions/get-employees.js

import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabaseAdmin = createClient(supabaseUrl, serviceKey);

export const handler = async (event) => {
    // --- Authentication (Don't touch) ---
    const token = event.headers.authorization?.split('Bearer ')[1];
    if (!token) {
        return { statusCode: 401, body: JSON.stringify({ message: 'Authentication required' }) };
    }
    const { data: { user }, error: userError } = await supabaseAdmin.auth.getUser(token);
    if (userError || !user) {
        return { statusCode: 401, body: JSON.stringify({ message: 'Invalid or expired token' }) };
    }

    try {
        const {
            page = 1,
            limit = 10,
            search = '',
            department = 'all',
            status = 'all' // Receives 'active', 'inactive', or 'all'
        } = event.queryStringParameters;

        const pageNum = parseInt(page, 10);
        const limitNum = parseInt(limit, 10);
        const offset = (pageNum - 1) * limitNum;

        // --- Build the base query from the combined_employees_view ---
        // Now directly selecting from the view, which already has department_name and is_active.
        let query = supabaseAdmin
            .from('combined_employees_view') // *** FIX: Use combined_employees_view ***
            .select('*', { count: 'exact' }); // Select all columns from the view

        // --- Apply shared filters ---
        if (search) {
            query = query.or(`name.ilike.%${search}%,employee_id.ilike.%${search}%`);
        }
        if (department && department !== 'all') {
            query = query.eq('department_id', department);
        }

        // *** FIX: Correctly filter by 'is_active' (boolean) based on 'status' parameter (string) ***
        if (status === 'active') {
            query = query.eq('is_active', true);
        } else if (status === 'inactive') {
            query = query.eq('is_active', false);
        }
        // If status is 'all', no 'is_active' filter is applied. This is the correct behavior.

        // --- Execute the final query with pagination ---
        const { data: employees, error, count } = await query
            .order('created_at', { ascending: false }) // Assuming 'created_at' exists in your view for ordering
            .range(offset, offset + limitNum - 1);

        if (error) {
            console.error('Error fetching employees:', error);
            throw new Error(`Supabase query failed: ${error.message}`);
        }

        // --- Prepare the response in the expected format for the frontend ---
        // No need to map department_name or is_active as they come directly from the view.
        // We ensure all necessary fields for the frontend are present.
        const formattedEmployees = employees.map(emp => ({
            id: emp.id,
            employee_id: emp.employee_id,
            name: emp.name,
            department_id: emp.department_id,
            department_name: emp.department_name, // Directly from view
            is_active: emp.is_active, // Directly from view
            permanent_token: emp.permanent_token,
            photo_url: emp.photo_url,
            qr_code_url: emp.qr_code_url,
            employee_type: emp.employee_type,
            source_table: emp.source_table,
            created_at: emp.created_at // Assuming created_at exists and is used for ordering
        }));


        const totalPages = Math.ceil(count / limitNum);

        return {
            statusCode: 200,
            body: JSON.stringify({
                employees: formattedEmployees,
                currentPage: pageNum,
                totalPages: totalPages,
                totalCount: count
            }),
        };

    } catch (error) {
        console.error('Get Employees Function Error:', error);
        return {
            statusCode: 500,
            body: JSON.stringify({ message: 'Internal Server Error', error: error.message }),
        };
    }
};
