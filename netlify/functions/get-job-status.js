// get-job-status.js

const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

exports.handler = async (event) => {
    const { jobId } = event.queryStringParameters;
    if (!jobId) {
        return { statusCode: 400, body: JSON.stringify({ message: 'jobId is required.' }) };
    }

    try {
        const { data, error } = await supabase
            .from('pdf_generation_jobs')
            .select('status, result_url, error_message')
            .eq('id', jobId)
            .maybeSingle(); // <-- FIX IS HERE

        // This error now only triggers for real problems, not "not found".
        if (error) throw error;
        
        // If data is null, the job is not yet visible in the DB.
        // This is an expected state during the first few polls.
        if (!data) {
            return { 
                statusCode: 200, // Return 200 OK because this is not a server error
                body: JSON.stringify({ status: 'pending', message: 'Job not found yet, still processing...' }) 
            };
        }

        // If data is found, return it as normal.
        return {
            statusCode: 200,
            body: JSON.stringify(data)
        };

    } catch (error) {
        console.error('Error fetching job status:', error);
        return { statusCode: 500, body: JSON.stringify({ message: 'Could not fetch job status.', error: error.message }) };
    }
};