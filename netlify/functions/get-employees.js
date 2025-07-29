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
            status = 'all'
        } = event.queryStringParameters;

        const pageNum = parseInt(page, 10);
        const limitNum = parseInt(limit, 10);
        const offset = (pageNum - 1) * limitNum;

        // Query from the view you provided
        let query = supabaseAdmin
            .from('combined_employees_view')
            .select('*', { count: 'exact' });

        // --- Apply filters ---
        if (search) {
            // *** THE DEFINITIVE FIX: Use precise filters for each column type ***
            // This searches for an EXACT match on 'employee_id' OR a partial match on 'name'.
            // This avoids data type issues with ILIKE on a numeric column.
            query = query.or(`employee_id.eq.${search},name.ilike.%${search}%`);
        }
        if (department && department !== 'all') {
            query = query.eq('department_id', department);
        }
        if (status === 'active') {
            query = query.eq('is_active', true);
        } else if (status === 'inactive') {
            query = query.eq('is_active', false);
        }

        // --- Execute the final query with pagination ---
        const { data: employees, error, count } = await query
            .order('name', { ascending: true }) // Order by name for consistent results
            .range(offset, offset + limitNum - 1);

        if (error) {
            console.error('Error fetching employees:', error);
            throw new Error(`Supabase query failed: ${error.message}`);
        }

        const totalPages = Math.ceil(count / limitNum);

        return {
            statusCode: 200,
            body: JSON.stringify({
                employees: employees,
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
