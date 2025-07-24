import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY; 
const supabaseAdmin = createClient(supabaseUrl, serviceKey);

export const handler = async (event, context) => {
    if (event.httpMethod !== 'POST') {
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
        if (profile?.role !== 'superuser') {
            return { statusCode: 403, body: JSON.stringify({ message: 'Permission denied. Superuser role required to manage card templates.' }) };
        }

        const { 
            id, 
            template_name, 
            company_name, 
            logo_url, 
            background_front_url, 
            background_back_url, 
            layout_config,
            orientation // <<< เพิ่ม orientation ที่นี่
        } = JSON.parse(event.body);

        if (!template_name || !orientation) { // <<< เพิ่ม orientation ในเงื่อนไขบังคับ
            return { statusCode: 400, body: JSON.stringify({ message: 'Template name and orientation are required.' }) };
        }

        const templateData = {
            template_name,
            company_name: company_name || null,
            logo_url: logo_url || null,
            background_front_url: background_front_url || null,
            background_back_url: background_back_url || null,
            layout_config: layout_config || {},
            orientation: orientation // <<< เพิ่ม orientation ใน templateData
        };

        let result = null;
        let error = null;

        if (id) {
            templateData.updated_at = new Date().toISOString();
            const { data, error: updateError } = await supabaseAdmin
                .from('card_templates')
                .update(templateData)
                .eq('id', id)
                .select()
                .single();
            result = data;
            error = updateError;
            if (error && error.code === 'PGRST116') {
                return { statusCode: 404, body: JSON.stringify({ message: 'Card template not found for update.' }) };
            }
        } else {
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