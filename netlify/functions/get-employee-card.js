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

    // The main logic block, now correctly structured.
    try {
        const {
            page = 1,
            limit = 10,
            search = '',
            department = 'all',
            status = 'all' // This comes from the frontend as 'active', 'inactive', or 'all'
        } = event.queryStringParameters;

        const pageNum = parseInt(page, 10);
        const limitNum = parseInt(limit, 10);
        const offset = (pageNum - 1) * limitNum;

        // --- Build the base query for both counting and selecting ---
        // This ensures the count and the data are based on the exact same filters.
        let query = supabaseAdmin
            .from('employees')
            .select('*, departments(name)', { count: 'exact' });

        // --- Apply shared filters ---
        if (search) {
            query = query.or(`name.ilike.%${search}%,employee_id.ilike.%${search}%`);
        }
        if (department && department !== 'all') {
            query = query.eq('department_id', department);
        }

        // --- Correctly handle the status filter ---
        // This logic handles 'active', 'inactive', and 'all' correctly.
        // It assumes your 'employees' table has a boolean column named 'is_active'.
        if (status === 'active') {
            query = query.eq('is_active', true);
        } else if (status === 'inactive') {
            query = query.eq('is_active', false);
        }
        // If status is 'all', we simply don't add any 'is_active' filter.

        // --- Execute the final query with pagination ---
        const { data: employees, error, count } = await query
            .order('created_at', { ascending: false })
            .range(offset, offset + limitNum - 1);

        if (error) {
            console.error('Error fetching employees:', error);
            throw new Error(`Supabase query failed: ${error.message}`);
        }

        // --- Prepare the response in the expected format for the frontend ---
        const formattedEmployees = employees.map(emp => ({
            ...emp,
            department_name: emp.departments ? emp.departments.name : 'N/A'
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
