import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY; // ใช้ Service Role Key เพื่อให้มีสิทธิ์ INSERT/UPDATE
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
        // การบันทึก/แก้ไข Template ควรจำกัดเฉพาะ superuser เท่านั้น
        if (profile?.role !== 'superuser') {
            return { statusCode: 403, body: JSON.stringify({ message: 'Permission denied. Superuser role required to manage card templates.' }) };
        }

        // 2. Parse Request Body
        const { 
            id, // จะมีค่าเมื่อเป็นการแก้ไข, ไม่มีค่าเมื่อเป็นการสร้างใหม่
            template_name, 
            company_name, 
            logo_url, 
            background_front_url, 
            background_back_url, 
            layout_config 
        } = JSON.parse(event.body);

        if (!template_name) {
            return { statusCode: 400, body: JSON.stringify({ message: 'Template name is required.' }) };
        }

        const templateData = {
            template_name,
            company_name: company_name || null,
            logo_url: logo_url || null,
            background_front_url: background_front_url || null,
            background_back_url: background_back_url || null,
            layout_config: layout_config || {} // ใช้ object เปล่าถ้าไม่มีการกำหนด
        };

        let result = null;
        let error = null;

        if (id) {
            // Update existing template
            templateData.updated_at = new Date().toISOString(); // อัปเดต timestamp
            const { data, error: updateError } = await supabaseAdmin
                .from('card_templates')
                .update(templateData)
                .eq('id', id)
                .select()
                .single();
            result = data;
            error = updateError;
            if (error && error.code === 'PGRST116') { // No rows found to update
                return { statusCode: 404, body: JSON.stringify({ message: 'Card template not found for update.' }) };
            }
        } else {
            // Insert new template
            templateData.created_at = new Date().toISOString();
            templateData.updated_at = new Date().toISOString();
            const { data, error: insertError } = await supabaseAdmin
                .from('card_templates')
                .insert(templateData)
                .select()
                .single();
            result = data;
            error = insertError;
        }

        if (error) throw error;

        return {
            statusCode: 200,
            body: JSON.stringify({ success: true, message: 'Card template saved successfully.', template: result }),
        };

    } catch (error) {
        console.error('Save Card Template Error:', error);
        return {
            statusCode: 500,
            body: JSON.stringify({ message: 'Failed to save card template', error: error.message }),
        };
    }
};