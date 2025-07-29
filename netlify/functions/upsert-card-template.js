// /netlify/functions/upsert-card-template.js

import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabaseAdmin = createClient(supabaseUrl, serviceKey);

export const handler = async (event) => {
    // 1. Authentication
    const token = event.headers.authorization?.split('Bearer ')[1];
    if (!token) {
        return { statusCode: 401, body: JSON.stringify({ message: 'Authentication required.' }) };
    }
    const { data: { user }, error: userError } = await supabaseAdmin.auth.getUser(token);
    if (userError || !user) {
        return { statusCode: 401, body: JSON.stringify({ message: 'Invalid or expired token.' }) };
    }

    // 2. Parse request body
    let payload;
    try {
        payload = JSON.parse(event.body);
    } catch (e) {
        return { statusCode: 400, body: JSON.stringify({ message: 'Invalid JSON body.' }) };
    }

    // 3. Prepare data for Supabase
    const {
        id, // This will be null for new templates, or have a value for updates
        template_name,
        company_name,
        orientation,
        background_front_url,
        logo_url,
        layout_config
    } = payload;

    if (!template_name) {
        return { statusCode: 400, body: JSON.stringify({ message: 'Template name is required.' }) };
    }

    const dataToUpsert = {
        id: id, // Pass the ID for Supabase to know if it should update
        template_name,
        company_name,
        orientation,
        background_front_url,
        logo_url,
        layout_config,
        created_by: user.id // Always stamp the user who saved it
    };
    
    // Remove id from the object if it's null, so Supabase auto-generates it on insert
    if (!dataToUpsert.id) {
        delete dataToUpsert.id;
    }

    // 4. Perform the upsert operation
    try {
        // Upsert will INSERT a new row if 'id' is missing or doesn't exist,
        // and UPDATE the row if 'id' matches an existing one.
        const { data, error } = await supabaseAdmin
            .from('card_templates')
            .upsert(dataToUpsert)
            .select() // Important: .select() returns the saved data
            .single(); // We expect only one record back

        if (error) {
            console.error('Supabase upsert error:', error);
            throw new Error(error.message);
        }

        // 5. Return success response
        return {
            statusCode: 200,
            body: JSON.stringify(data)
        };

    } catch (error) {
        return {
            statusCode: 500,
            body: JSON.stringify({ message: 'Error saving template to the database.', error: error.message })
        };
    }
};
