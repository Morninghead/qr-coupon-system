/**
 * This function retrieves the public Supabase URL and Anon Key 
 * from the Netlify environment variables and sends them to the client.
 * This is a secure way to provide client-side code with the necessary credentials
 * without hardcoding them in the HTML file.
 */
export const handler = async () => {
    return {
        statusCode: 200,
        body: JSON.stringify({
            supabaseUrl: process.env.SUPABASE_URL,
            supabaseKey: process.env.SUPABASE_KEY, // This should be the ANON_KEY
        }),
    };
};
