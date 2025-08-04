// /netlify/functions/request-employee-import.js
const { createClient } = require('@supabase/supabase-js');
const { randomUUID } = require('crypto');

const supabaseUrl = process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabaseAdmin = createClient(supabaseUrl, serviceKey);

exports.handler = async (event) => {
    if (event.httpMethod !== 'POST') {
        return { statusCode: 405, body: 'Method Not Allowed' };
    }
    try {
        const token = event.headers.authorization?.split('Bearer ')[1];
        if (!token) return { statusCode: 401, body: JSON.stringify({ message: 'Authentication required' }) };
        
        const { data: { user } } = await supabaseAdmin.auth.getUser(token);
        if (!user) return { statusCode: 401, body: JSON.stringify({ message: 'Invalid token' }) };

        const { filePath } = JSON.parse(event.body);
        if (!filePath) return { statusCode: 400, body: JSON.stringify({ message: 'File path is required.' }) };

        const jobId = randomUUID();

        const { error } = await supabaseAdmin
            .from('employee_import_jobs')
            .insert({
                id: jobId,
                status: 'pending',
                payload: { filePath: filePath },
                created_by: user.id
            });

        if (error) throw error;

        return {
            statusCode: 202, // Accepted
            body: JSON.stringify({ jobId: jobId })
        };
    } catch (error) {
        console.error('Error creating import job:', error);
        return {
            statusCode: 500,
            body: JSON.stringify({ message: 'Could not create import job.', error: error.message })
        };
    }
};