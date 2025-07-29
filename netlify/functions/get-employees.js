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

        // --- Build a dynamic filter string ---
        // This is the most robust way to handle multiple optional filters.
        const filters = [];
        
        // 1. Add department filter if specified
        if (department && department !== 'all') {
            filters.push(`department_id.eq.${department}`);
        }

        // 2. Add status filter if specified
        if (status === 'active') {
            filters.push('is_active.eq.true');
        } else if (status === 'inactive') {
            filters.push('is_active.eq.false');
        }
        
        // 3. Add search filter if specified
        if (search) {
            // This creates a sub-condition for the search term
            filters.push(`or(employee_id.eq.${search},name.ilike.%${search}%)`);
        }

        // --- Build the final query ---
        let query = supabaseAdmin
            .from('combined_employees_view')
            .select('*', { count: 'exact' });

        // Apply all collected filters with AND logic
        if (filters.length > 0) {
            query = query.and(filters.join(','));
        }

        // --- Execute the final query with pagination ---
        const { data: employees, error, count } = await query
            .order('name', { ascending: true })
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
