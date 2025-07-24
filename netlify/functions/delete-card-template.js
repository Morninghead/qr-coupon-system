import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY; // ใช้ Service Role Key เพื่อให้มีสิทธิ์ DELETE
const supabaseAdmin = createClient(supabaseUrl, serviceKey);

export const handler = async (event, context) => {
    if (event.httpMethod !== 'POST') {
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
        // การลบ Template ควรจำกัดเฉพาะ superuser เท่านั้น
        if (profile?.role !== 'superuser') {
            return { statusCode: 403, body: JSON.stringify({ message: 'Permission denied. Superuser role required to delete card templates.' }) };
        }

        // 2. Parse Request Body
        const { id } = JSON.parse(event.body);

        if (!id) {
            return { statusCode: 400, body: JSON.stringify({ message: 'Template ID is required for deletion.' }) };
        }

        // 3. Delete the template
        const { error } = await supabaseAdmin
            .from('card_templates')
            .delete()
            .eq('id', id);

        if (error) {
            if (error.code === 'PGRST116') { // No rows found to delete
                return { statusCode: 404, body: JSON.stringify({ message: 'Card template not found for deletion.' }) };
            }
            throw error;
        }

        return {
            statusCode: 200,
            body: JSON.stringify({ success: true, message: `Card template with ID ${id} deleted successfully.` }),
        };

    } catch (error) {
        console.error('Delete Card Template Error:', error);
        return {
            statusCode: 500,
            body: JSON.stringify({ message: 'Failed to delete card template', error: error.message }),
        };
    }
};