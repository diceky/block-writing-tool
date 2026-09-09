exports.handler = async (event) => {
    // Only allow POST requests
    if (event.httpMethod !== 'POST') {
        return {
            statusCode: 405,
            body: JSON.stringify({ error: 'Method not allowed' })
        };
    }

    try {
        // Parse the request body
        const {
            prompt,
            model,
            maxTokens,
            temperature,
            messages
        } = JSON.parse(event.body);

        const apiKey = process.env.OPENAI_API_KEY;
        if (!apiKey) {
            return { statusCode: 500, body: JSON.stringify({ error: "OPENAI_API_KEY not set" }) };
        }

        const hasMessages = Array.isArray(messages) && messages.length > 0;
        if (!hasMessages && !prompt) {
            return {
                statusCode: 400,
                body: JSON.stringify({ error: 'Prompt or messages is required' })
            };
        }

        // Make the OpenAI API call
        const requestBody = {
            model: model || 'gpt-4o',
            messages: hasMessages
                ? messages
                : [
                    {
                        role: 'user',
                        content: prompt
                    }
                ],
            temperature: temperature,
            max_tokens: maxTokens,
        };

        // Search-enabled models require web_search_options and reject temperature
        if (model === 'gpt-4o-search-preview' || model === 'gpt-5-search-api') {
            requestBody["web_search_options"] = {};
            delete requestBody.temperature;
        }

        const response = await fetch('https://api.openai.com/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(requestBody),
        });

        if (!response.ok) {
            // Capture OpenAI's raw response body so the client can see the real reason
            const rawBody = await response.text();
            let openaiError = null;
            try { openaiError = JSON.parse(rawBody); } catch { openaiError = null; }

            console.error('OpenAI API error', {
                status: response.status,
                statusText: response.statusText,
                model: requestBody.model,
                body: rawBody,
            });

            let errorMessage;
            if (response.status === 401) {
                errorMessage = 'Invalid OpenAI API key. Please check your API key and try again.';
            } else if (response.status === 403) {
                errorMessage = 'Access denied to OpenAI API. Please check your API key permissions and billing status.';
            } else if (response.status === 429) {
                errorMessage = 'OpenAI API rate limit exceeded. Please try again later.';
            } else if (response.status === 500) {
                errorMessage = 'OpenAI API server error. Please try again later.';
            } else {
                const detail = openaiError?.error?.message || openaiError?.error || rawBody;
                errorMessage = `OpenAI API error: ${response.status} ${response.statusText}${detail ? ` — ${detail}` : ''}`;
            }

            return {
                statusCode: response.status,
                body: JSON.stringify({
                    error: errorMessage,
                    openai: openaiError,
                    raw: rawBody,
                })
            };
        }

        const data = await response.json();

        return {
            statusCode: 200,
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(data)
        };

    } catch (error) {
        console.error('Error in chat-completion function:', error);

        return {
            statusCode: 500,
            body: JSON.stringify({
                error: error.message || 'Internal server error'
            })
        };
    }
};