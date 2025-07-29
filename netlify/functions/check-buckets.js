// /netlify/functions/check-buckets.js

import { createClient } from '@supabase/supabase-js';

// These are the same environment variables your other functions use
const supabaseUrl = process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabaseAdmin = createClient(supabaseUrl, serviceKey);

export const handler = async (event) => {
    try {
        // This command asks Supabase: "List all storage buckets you have"
        const { data: buckets, error } = await supabaseAdmin.storage.listBuckets();

        if (error) {
            // If there's an error connecting or listing, we'll see it
            throw error;
        }

        // Return the list of buckets as a JSON response
        return {
            statusCode: 200,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                message: "Successfully listed buckets.",
                buckets: buckets
            }),
        };

    } catch (error) {
        console.error('Check Buckets Function Error:', error);
        return {
            statusCode: 500,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                message: 'Failed to list buckets.',
                error: {
                    name: error.name,
                    message: error.message,
                    details: error.details || null,
                }
            }),
        };
    }
};
