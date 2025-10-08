exports.handler = async function (event, context) {
    const apiKey = process.env.OPENAI_API_KEY; // Use environment variables for sensitive data
    if (!apiKey) {
            return { statusCode: 500, body: JSON.stringify({ error: "OPENAI_API_KEY not set" }) };
        }

    try {
        const response = await fetch('https://api.openai.com/v1/models', {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json',
            },
        });

        if (!response.ok) {
            if (response.status === 401) {
                return {
                    statusCode: 401,
                    body: JSON.stringify({ error: 'Invalid OpenAI API key' }),
                };
            } else if (response.status === 403) {
                return {
                    statusCode: 403,
                    body: JSON.stringify({ error: 'Access denied - please check API key permissions' }),
                };
            } else if (response.status === 429) {
                return {
                    statusCode: 429,
                    body: JSON.stringify({ error: 'Rate limit exceeded' }),
                };
            } else {
                return {
                    statusCode: response.status,
                    body: JSON.stringify({ error: `Connection failed: ${response.status}` }),
                };
            }
        }

        const data = await response.json();
        return {
            statusCode: 200,
            body: JSON.stringify(data),
        };
    } catch (error) {
        return {
            statusCode: 500,
            body: JSON.stringify({ error: error.message }),
        };
    }
};