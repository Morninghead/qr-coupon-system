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

        let regularEmployees = [];
        let temporaryEmployees = [];

        // 3. Fetch Regular Employees
        let regularQuery = supabaseAdmin
            .from('employees')
            .select(`
                id,
                employee_id,
                name,
                department_id,
                departments(name),
                is_active,
                permanent_token,
                photo_url
            `, { count: 'exact' });

        if (searchTerm) {
            regularQuery = regularQuery.or(`employee_id.ilike.%${searchTerm}%,name.ilike.%${searchTerm}%`);
        }
        if (department !== 'all') {
            regularQuery = regularQuery.eq('department_id', department);
        }
        if (status !== 'all') {
            regularQuery = regularQuery.eq('is_active', status === 'active');
        }

        const { data: regularData, error: regularError, count: regCount } = await regularQuery;
        if (regularError) throw regularError;
        regularEmployees = regularData.map(emp => ({
            id: emp.id, 
            employee_id: emp.employee_id,
            name: emp.name,
            department_id: emp.department_id,
            department_name: emp.departments ? emp.departments.name : 'ไม่ระบุ',
            is_active: emp.is_active,
            permanent_token: emp.permanent_token,
            photo_url: emp.photo_url,
            employee_type: 'regular' 
        }));

        // 4. Fetch Temporary Employees (only new/unknown individuals, not those linked to regular employee_id)
        let tempQuery = supabaseAdmin
            .from('temporary_coupon_requests')
            .select(`
                id,
                temp_employee_name,
                temp_employee_identifier,
                employee_id, 
                reason,
                issued_token,
                expires_at,
                status
            `, { count: 'exact' }) // <--- ลบคอมเมนต์นี้ออกไป
            .is('employee_id', null); 

        if (searchTerm) {
            tempQuery = tempQuery.or(`temp_employee_name.ilike.%${searchTerm}%,temp_employee_identifier.ilike.%${searchTerm}%`);
        }

        const { data: tempData, error: tempError, count: tempCount } = await tempQuery;
        if (tempError) throw tempError;
        temporaryEmployees = tempData.map(temp => ({
            id: temp.id, 
            employee_id: temp.temp_employee_identifier || `TEMP-${temp.id.substring(0,4)}`, 
            name: temp.temp_employee_name,
            department_id: null,
            department_name: 'ชั่วคราว',
            is_active: true, 
            permanent_token: null, 
            photo_url: null, 
            employee_type: 'temp' 
        }));

        let allFilteredEmployees = regularEmployees.concat(temporaryEmployees);
        
        allFilteredEmployees.sort((a, b) => {
            const idA = a.employee_id || '';
            const idB = b.employee_id || '';
            return idA.localeCompare(idB);
        });

        const totalFilteredCount = allFilteredEmployees.length;
        const paginatedEmployees = allFilteredEmployees.slice(offset, offset + limitNum);

        return {
            statusCode: 200,
            body: JSON.stringify({
                employees: paginatedEmployees,
                totalCount: totalFilteredCount,
                currentPage: pageNum,
                totalPages: Math.ceil(totalFilteredCount / limitNum),
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