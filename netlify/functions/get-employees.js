import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY; // ใช้ Service Role Key เพื่อให้มีสิทธิ์เข้าถึงทุกข้อมูลที่จำเป็น
const supabaseAdmin = createClient(supabaseUrl, serviceKey);

export const handler = async (event, context) => {
    if (event.httpMethod !== 'GET') {
        return { statusCode: 405, body: 'Method Not Allowed' };
    }

    try {
        // 1. Authentication and Authorization Check
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

        // 2. Parse Query Parameters
        const { page = 1, limit = 20, search = '', department = 'all', status = 'all' } = event.queryStringParameters;
        const pageNum = parseInt(page);
        const limitNum = parseInt(limit);
        const offset = (pageNum - 1) * limitNum;
        const searchTerm = search.toLowerCase();

        let regularEmployees = [];
        let temporaryEmployees = [];
        let totalRegularCount = 0;
        let totalTemporaryCount = 0;

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
            id: emp.id, // Supabase UUID
            employee_id: emp.employee_id,
            name: emp.name,
            department_id: emp.department_id,
            department_name: emp.departments ? emp.departments.name : 'ไม่ระบุ',
            is_active: emp.is_active,
            permanent_token: emp.permanent_token,
            photo_url: emp.photo_url,
            employee_type: 'regular' // Add type for differentiation in frontend
        }));
        totalRegularCount = regCount;

        // 4. Fetch Temporary Employees (only new/unknown individuals, not those linked to regular employee_id)
        // Note: For temporary employees, we only filter by search term, not department or active status as they don't have these attributes in the same way.
        let tempQuery = supabaseAdmin
            .from('temporary_coupon_requests')
            .select(`
                id,
                temp_employee_name,
                temp_employee_identifier,
                employee_id, // This should be null for new temp individuals
                reason,
                issued_token,
                expires_at,
                status
            `, { count: 'exact' })
            .is('employee_id', null); // Filter for only new/unknown temporary individuals

        if (searchTerm) {
            tempQuery = tempQuery.or(`temp_employee_name.ilike.%${searchTerm}%,temp_employee_identifier.ilike.%${searchTerm}%`);
        }
        // No department or status filter for temporary individuals

        const { data: tempData, error: tempError, count: tempCount } = await tempQuery;
        if (tempError) throw tempError;
        temporaryEmployees = tempData.map(temp => ({
            id: temp.id, // UUID of the request
            employee_id: temp.temp_employee_identifier || `TEMP-${temp.id.substring(0,4)}`, // Use identifier or a derived ID
            name: temp.temp_employee_name,
            department_id: null,
            department_name: 'ชั่วคราว',
            is_active: true, // Temporary by nature, always active during validity
            permanent_token: null, // No permanent token
            photo_url: null, // No photo for temp new employee
            employee_type: 'temp' // Add type for differentiation in frontend
        }));
        totalTemporaryCount = tempCount;

        // 5. Combine and Paginate Results
        // Decide how to combine: for simplicity now, let's just paginate regular employees
        // and add temporary employees if the search term matches their specific fields.
        // A more complex solution might involve unioning in the DB or fetching all and then sorting/paginating.
        
        let combinedResults = regularEmployees.concat(temporaryEmployees);

        // Apply search filter again on combined array if needed for temp employees not caught by initial query
        // Or if you intend to search across all fields of both types after initial query.
        // For simplicity, current logic searches separately then combines.
        // The frontend will sort and display.

        // Manual pagination on combined results if total set is needed across both tables
        // For now, let's assume filtering happens at DB level for each type, then combine for display.
        // The current 'limit' and 'offset' are applied to 'regularQuery' and 'tempQuery' separately,
        // so the 'totalCount' logic and pagination needs to be carefully handled for combined data.

        // A simpler approach for combined pagination:
        // Fetch all matching regular and temporary employees without limit/offset first,
        // then combine, then apply limit/offset on the combined array.
        // However, if the total results are very large, this can be inefficient.

        // Let's adjust to fetch all filtered results, then do client-side pagination for simplicity
        // in combining for now. For very large datasets, a more advanced backend union/pagination is needed.

        // Re-fetching (conceptually) without limit for combining:
        // (This is an illustrative concept for full result set, actual implementation below will use initial fetched `regularEmployees`, `temporaryEmployees`)
        // The current fetch `regularQuery` and `tempQuery` already include filters.
        // We will return all items that match the filters, and let frontend handle basic pagination.
        // If itemsPerPage is small (e.g. 20), this might mean only fetching 20 regular + 20 temp if both match search/filters.

        // To handle pagination correctly over a combined set:
        // Total filtered count is sum of individual counts.
        let allFilteredEmployees = regularEmployees.concat(temporaryEmployees);
        
        // Sort if you need a consistent order (e.g., by name or employee_id)
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