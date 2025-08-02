// /netlify/functions/request-bulk-pdf.js
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
        // Authenticate the user making the request
        const token = event.headers.authorization?.split('Bearer ')[1];
        if (!token) {
            return { statusCode: 401, body: JSON.stringify({ message: 'Authentication required' }) };
        }
        const { data: { user } } = await supabaseAdmin.auth.getUser(token);
        if (!user) {
            return { statusCode: 401, body: JSON.stringify({ message: 'Invalid token' }) };
        }

        const jobPayload = JSON.parse(event.body);
        const jobId = randomUUID();

        // Insert a new job into the queue table
        const { error } = await supabaseAdmin
            .from('pdf_generation_jobs')
            .insert({
                id: jobId,
                status: 'pending',
                payload: jobPayload, // Save the template and employee list
                created_by: user.id
            });

        if (error) {
            throw error;
        }

        // Return the Job ID to the frontend immediately
        return {
            statusCode: 202, // 202 Accepted: The request has been accepted for processing
            body: JSON.stringify({ jobId: jobId })
        };

    } catch (error) {
        console.error('Error creating PDF job:', error);
        return {
            statusCode: 500,
            body: JSON.stringify({ message: 'Could not create PDF generation job.', error: error.message })
        };
    }
};