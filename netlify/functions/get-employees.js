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
        if (profile?.role !== 'superuser' && profile?.role !== 'department_admin') {
            return { statusCode: 403, body: JSON.stringify({ message: 'Permission denied. Superuser or Department Admin role required.' }) };
        }

        const { page = 1, limit = 20, search = '', department = 'all', status = 'all' } = event.queryStringParameters;
        const pageNum = parseInt(page);
        const limitNum = parseInt(limit);
        const offset = (pageNum - 1) * limitNum;
        const searchTerm = search.toLowerCase();

        let query = supabaseAdmin
            .from('combined_employees_view') // <<< ดึงจาก View แทน
            .select('*', { count: 'exact' });

        // Apply filters
        if (searchTerm) {
            query = query.or(`employee_id.ilike.%${searchTerm}%,name.ilike.%${searchTerm}%`);
        }
        if (department !== 'all') {
            query = query.eq('department_id', department);
        }
        if (status !== 'all') { // Apply status filter to combined view
            query = query.eq('is_active', status === 'active');
        }

        // Ordering, Pagination
        query = query.order('employee_id', { ascending: true }) // Order by employee_id for consistency
                     .range(offset, offset + limitNum - 1);

        const { data: combinedData, error: combinedError, count: totalCount } = await query;
        if (combinedError) throw combinedError;

        // Map data to expected format (mostly already done by View)
        const employees = combinedData.map(emp => ({
            id: emp.id,
            employee_id: emp.employee_id,
            name: emp.name,
            department_id: emp.department_id,
            department_name: emp.department_name,
            is_active: emp.is_active,
            permanent_token: emp.permanent_token,
            photo_url: emp.photo_url,
            qr_code_url: emp.qr_code_url, // Make sure qr_code_url is in the view too if needed
            employee_type: emp.employee_type,
            source_table: emp.source_table // Useful for debugging or specific frontend logic
        }));
        
        return {
            statusCode: 200,
            body: JSON.stringify({
                employees: employees,
                totalCount: totalCount,
                currentPage: pageNum,
                totalPages: Math.ceil(totalCount / limitNum),
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