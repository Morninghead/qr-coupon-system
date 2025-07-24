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
        // อนุญาตให้ superuser หรือ department_admin ดูได้
        if (profile?.role !== 'superuser' && profile?.role !== 'department_admin') {
            return { statusCode: 403, body: JSON.stringify({ message: 'Permission denied. Superuser or Department Admin role required.' }) };
        }

        // 2. ดึงข้อมูล Card Templates ทั้งหมด
        const { data: templates, error } = await supabaseAdmin
            .from('card_templates')
            .select('*') // ดึงทุกคอลัมน์
            .order('template_name', { ascending: true }); // เรียงตามชื่อ Template

        if (error) throw error;

        return {
            statusCode: 200,
            body: JSON.stringify(templates),
        };

    } catch (error) {
        console.error('Get Card Templates Error:', error);
        return {
            statusCode: 500,
            body: JSON.stringify({ message: 'Failed to fetch card templates', error: error.message }),
        };
    }
};