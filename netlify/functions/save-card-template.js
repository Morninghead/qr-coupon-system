const { createClient } = require('@supabase/supabase-js');

exports.handler = async (event, context) => {
    // ตรวจสอบ method
    if (event.httpMethod !== 'POST') {
        return { 
            statusCode: 405, 
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ error: 'Method Not Allowed' })
        };
    }

    // ตรวจสอบ CORS
    const headers = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Content-Type': 'application/json'
    };

    if (event.httpMethod === 'OPTIONS') {
        return { statusCode: 200, headers, body: '' };
    }

    try {
        // สร้าง Supabase client
        const supabase = createClient(
            process.env.SUPABASE_URL,
            process.env.SUPABASE_SERVICE_ROLE_KEY
        );

        // ตรวจสอบ Authorization
        const authHeader = event.headers.authorization;
        if (!authHeader) {
            return { 
                statusCode: 401, 
                headers,
                body: JSON.stringify({ error: 'Missing authorization header' }) 
            };
        }

        const token = authHeader.replace('Bearer ', '');
        const { data: { user }, error: userError } = await supabase.auth.getUser(token);
        
        if (userError || !user) {
            console.error('Auth error:', userError);
            return { 
                statusCode: 401, 
                headers,
                body: JSON.stringify({ error: 'Invalid token' }) 
            };
        }

        // Parse request body
        const body = JSON.parse(event.body);
        const { 
            template_name, 
            company_name, 
            layout_config, 
            orientation = 'landscape',
            logo_url = null,
            background_front_url = null,
            background_back_url = null
        } = body;

        // Validate required fields
        if (!template_name || !template_name.trim()) {
            return { 
                statusCode: 400, 
                headers,
                body: JSON.stringify({ error: 'Template name is required' }) 
            };
        }

        if (!layout_config) {
            return { 
                statusCode: 400, 
                headers,
                body: JSON.stringify({ error: 'Layout configuration is required' }) 
            };
        }

        // บันทึกลง database
        const { data, error } = await supabase
            .from('card_templates')
            .insert({
                template_name: template_name.trim(),
                company_name: company_name ? company_name.trim() : null,
                layout_config,
                orientation,
                logo_url,
                background_front_url,
                background_back_url,
                created_by: user.id,
                created_at: new Date().toISOString()
            })
            .select()
            .single();

        if (error) {
            console.error('Database error:', error);
            return { 
                statusCode: 500, 
                headers,
                body: JSON.stringify({ 
                    error: 'Failed to save template',
                    details: error.message 
                }) 
            };
        }

        console.log('Template saved successfully:', data);

        return {
            statusCode: 200,
            headers,
            body: JSON.stringify({ 
                success: true, 
                template: data,
                message: `Template "${template_name}" saved successfully` 
            })
        };

    } catch (error) {
        console.error('Error in save-card-template:', error);
        return { 
            statusCode: 500, 
            headers,
            body: JSON.stringify({ 
                error: 'Internal server error',
                details: error.message 
            }) 
        };
    }
};
