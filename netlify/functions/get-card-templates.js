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

        const { data: templates, error } = await supabaseAdmin
            .from('card_templates')
            .select('*, orientation') // <<< เพิ่ม orientation ที่นี่
            .order('template_name', { ascending: true });

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