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

        // --- Build Query using Method Chaining (The Stable & Correct Way) ---
        let query = supabaseAdmin
            .from('combined_employees_view')
            .select('*', { count: 'exact' });

        // Filter 1: Department
        if (department && department !== 'all') {
            query = query.eq('department_id', department);
        }

        // Filter 2: Status (is_active)
        if (status === 'active') {
            query = query.eq('is_active', true);
        } else if (status === 'inactive') {
            query = query.eq('is_active', false);
        }
        
        // Filter 3: Search (with smart logic for ID or Name)
        if (search) {
            // Check if the search term consists only of digits
            if (/^\d+$/.test(search)) {
                // If it's all numbers, search in employee_id
                query = query.eq('employee_id', search);
            } else {
                // Otherwise, search in name
                query = query.ilike('name', `%${search}%`);
            }
        }

        // --- Execute the final query with pagination and ordering ---
        const { data: employees, error, count } = await query
            .order('name', { ascending: true }) // Order by a column that exists
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
