import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY; // Use the public ANON_KEY
const supabase = createClient(supabaseUrl, supabaseKey);

/**
 * Fetches all departments from the database.
 * Accessible by any authenticated user.
 */
export const handler = async (event, context) => {
    // Ensure the user is authenticated
    const { user } = context.clientContext;
    if (!user) {
        return { statusCode: 401, body: JSON.stringify({ message: 'Authentication required' }) };
    }

    try {
        const { data, error } = await supabase
            .from('Departments')
            .select('id, name')
            .order('name', { ascending: true });

        if (error) throw error;

        return {
            statusCode: 200,
            body: JSON.stringify(data),
        };
    } catch (error) {
        console.error('Get Departments Error:', error);
        return {
            statusCode: 500,
            body: JSON.stringify({ message: 'Failed to fetch departments', error: error.message }),
        };
    }
};
