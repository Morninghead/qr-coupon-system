import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY; 
const supabaseAdmin = createClient(supabaseUrl, serviceKey);

export const handler = async (event, context) => {
    if (event.httpMethod !== 'GET') {
        return { statusCode: 405, body: 'Method Not Allowed' };
    }

    try {
        const token = event.headers.authorization?.split('Bearer ')[1];
        if (!token) {
            return { statusCode: 401, body: JSON.stringify({ message: 'Authentication required' }) };
        }
        const { data: { user }, error: userError } = await supabaseAdmin.auth.getUser(token);
        if (userError || !user) {
            return { statusCode: 401, body: JSON.stringify({ message: 'Invalid token' }) };
        }

        const { data: profile } = await supabaseAdmin.from('profiles').select('role').eq('id', user.id).single();
        if (!['superuser', 'department_admin'].includes(profile?.role)) {
            return { statusCode: 403, body: JSON.stringify({ message: 'Permission denied.' }) };
        }

        const { page = 1, limit = 20, search = '', department = 'all', status = 'all', employee_type } = event.queryStringParameters;
        const pageNum = parseInt(page);
        const limitNum = parseInt(limit);
        const offset = (pageNum - 1) * limitNum;
        
        let query = supabaseAdmin
            .from('employees') // Query the 'employees' table directly
            .select('*, departments(name)', { count: 'exact' });

        if (search) {
            query = query.or(`employee_id.ilike.%${search}%,name.ilike.%${search}%`);
        }
        if (department !== 'all') {
            query = query.eq('department_id', department);
        }
        if (status !== 'all') {
            query = query.eq('is_active', status === 'active');
        }
        
        // FIX: This was the missing filter on the backend
        if (employee_type === 'regular') {
            // This is a placeholder as your main table is already regular employees.
            // If you add an 'employee_type' column to your 'employees' table, you can filter here.
            // For now, we assume this table is only for 'regular' employees.
        }

        query = query.order('employee_id', { ascending: true })
                     .range(offset, offset + limitNum - 1);

        const { data, error, count } = await query;
        if (error) throw error;
        
        const employees = data.map(emp => ({
            ...emp,
            department_name: emp.departments?.name || 'N/A' // Handle joined data
        }));

        return {
            statusCode: 200,
            body: JSON.stringify({
                employees: employees,
                totalCount: count,
                currentPage: pageNum,
                totalPages: Math.ceil(count / limitNum),
            }),
        };

    } catch (error) {
        console.error('Get Employees Error:', error);
        return {
            statusCode: 500,
            body: JSON.stringify({ message: 'Failed to fetch employees', error: error.message }),
        };
    }
};