// netlify/functions/get-job-status.js
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
            .single();

        if (error) throw error;
        if (!data) return { statusCode: 404, body: JSON.stringify({ message: 'Job not found.' }) };

        return {
            statusCode: 200,
            body: JSON.stringify(data)
        };

    } catch (error) {
        console.error('Error fetching job status:', error);
        return { statusCode: 500, body: JSON.stringify({ message: 'Could not fetch job status.', error: error.message }) };
    }
};
