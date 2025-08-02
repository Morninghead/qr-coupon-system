// /netlify/functions/get-job-status.js
const { createClient } = require('@supabase/supabase-js');

// IMPORTANT: Use the SERVICE_ROLE_KEY for admin-level access, just like the worker.
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
            .maybeSingle();

        if (error) {
            // This now only triggers for real database errors.
            throw error;
        }

        if (!data) {
            // If the job isn't found yet (race condition), this is fine.
            // The frontend will continue polling.
            return {
                statusCode: 200,
                body: JSON.stringify({ status: 'pending', message: 'Job not yet found, polling continues...' })
            };
        }

        // If the job is found, return its current status.
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