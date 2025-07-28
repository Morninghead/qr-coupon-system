/**
 * This function retrieves the public Supabase URL and Anon Key 
 * from the Netlify environment variables and sends them to the client.
 * This is a secure way to provide client-side code with the necessary credentials
 * without hardcoding them in the HTML file.
 */
exports.handler = async (event, context) => {
    // CORS headers for all responses
    const headers = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
        'Content-Type': 'application/json'
    };

    // Handle preflight requests
    if (event.httpMethod === 'OPTIONS') {
        return {
            statusCode: 200,
            headers,
            body: ''
        };
    }

    try {
        // Check if the environment variables are set
        const supabaseUrl = process.env.SUPABASE_URL;
        const supabaseKey = process.env.SUPABASE_KEY || process.env.SUPABASE_ANON_KEY;

        console.log('Environment check:', {
            hasUrl: !!supabaseUrl,
            hasKey: !!supabaseKey,
            urlPrefix: supabaseUrl ? supabaseUrl.substring(0, 30) + '...' : 'undefined',
            keyPrefix: supabaseKey ? supabaseKey.substring(0, 30) + '...' : 'undefined'
        });

        if (!supabaseUrl || !supabaseKey) {
            console.error('Missing Supabase environment variables:', {
                SUPABASE_URL: !!supabaseUrl,
                SUPABASE_KEY: !!supabaseKey,
                SUPABASE_ANON_KEY: !!process.env.SUPABASE_ANON_KEY
            });

            return {
                statusCode: 500,
                headers,
                body: JSON.stringify({
                    error: "Supabase environment variables are not set on the server",
                    details: {
                        SUPABASE_URL: !!supabaseUrl,
                        SUPABASE_KEY: !!supabaseKey,
                        SUPABASE_ANON_KEY: !!process.env.SUPABASE_ANON_KEY
                    }
                })
            };
        }

        // Validate URL format
        if (!supabaseUrl.includes('supabase.co')) {
            console.error('Invalid Supabase URL format:', supabaseUrl.substring(0, 50) + '...');
            return {
                statusCode: 500,
                headers,
                body: JSON.stringify({
                    error: "Invalid Supabase URL format",
                    details: "URL should contain 'supabase.co'"
                })
            };
        }

        // Validate key format (should be a JWT-like string)
        if (!supabaseKey.startsWith('eyJ')) {
            console.error('Invalid Supabase key format - should start with eyJ');
            return {
                statusCode: 500,
                headers,
                body: JSON.stringify({
                    error: "Invalid Supabase key format",
                    details: "Key should be a valid JWT token"
                })
            };
        }

        // Return the config in the format expected by the frontend
        return {
            statusCode: 200,
            headers,
            body: JSON.stringify({
                url: supabaseUrl,        // Frontend expects 'url'
                key: supabaseKey,        // Frontend expects 'key'
                // Also include alternative names for compatibility
                supabaseUrl: supabaseUrl,
                supabaseKey: supabaseKey
            })
        };

    } catch (error) {
        console.error('Error in get-config function:', error);
        return {
            statusCode: 500,
            headers,
            body: JSON.stringify({
                error: "Internal server error",
                details: error.message
            })
        };
    }
};
