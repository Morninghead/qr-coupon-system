/**
 * This function retrieves the public Supabase URL and Anon Key 
 * from the Netlify environment variables and sends them to the client.
 * This is a secure way to provide client-side code with the necessary credentials
 * without hardcoding them in the HTML file.
 */
export const handler = async () => {
    // Check if the environment variables are set
    if (!process.env.SUPABASE_URL || !process.env.SUPABASE_KEY) {
        return {
            statusCode: 500,
            body: JSON.stringify({
                message: "Supabase environment variables are not set on the server."
            })
        };
    }

    return {
        statusCode: 200,
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            supabaseUrl: process.env.SUPABASE_URL,
            supabaseKey: process.env.SUPABASE_KEY, // This is the ANON_KEY
        }),
    };
};
