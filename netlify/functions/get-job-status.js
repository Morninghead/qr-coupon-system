// /netlify/functions/get-job-status.js
const { createClient } = require('@supabase/supabase-js');

// Use the Service Role Key for admin-level access to read job status
const supabaseUrl = process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY; 

// Initialize the admin client
const supabaseAdmin = createClient(supabaseUrl, serviceKey);

exports.handler = async (event) => {
    const { jobId } = event.queryStringParameters;
    if (!jobId) {
        return { statusCode: 400, body: JSON.stringify({ message: 'jobId is required.' }) };
    }

    try {
        // Use the admin client to query the table, bypassing RLS.
        const { data, error } = await supabaseAdmin
            .from('pdf_generation_jobs')
            .select('status, result_url, error_message')
            .eq('id', jobId)
            .maybeSingle(); // Use maybeSingle() to handle "not found" gracefully

        // This error now only triggers for real problems (like bad connection), not "not found".
        if (error) {
            throw error;
        }
        
        // If data is null, the job is not yet visible in the DB.
        // This is an expected state during the first few polls.
        if (!data) {
            return { 
                statusCode: 200, // It's not a server error, it's an expected state
                body: JSON.stringify({ status: 'pending', message: 'Job not yet visible, polling continues...' }) 
            };
        }

        // If data is found, return it as normal.
        return {
            statusCode: 200,
            body: JSON.stringify(data)
        };

    } catch (error) {
        console.error('Error fetching job status:', error);
        return { 
            statusCode: 500, 
            body: JSON.stringify({ message: 'Could not fetch job status.', error: error.message }) 
        };
    }
};