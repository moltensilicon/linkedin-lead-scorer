// Background service worker for LinkedIn Lead Scorer
// Handles API calls to various LLM providers and manages secure communication

// API endpoint configurations
const API_CONFIGS = {
    openai: {
        baseUrl: 'https://api.openai.com/v1/chat/completions',
        headers: (apiKey) => ({
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type': 'application/json'
        }),
        formatRequest: (model, prompt, profileData) => ({
            model: model,
            messages: [
                {
                    role: 'system',
                    content: prompt
                },
                {
                    role: 'user',
                    content: `Profile Data:\n${profileData.text}\nHas Profile Picture: ${profileData.hasProfilePic}`
                }
            ],
            max_tokens: 300,
            temperature: 0.1
        }),
        parseResponse: (response) => {
            const content = response.choices[0].message.content;
            return JSON.parse(content);
        }
    },
    gemini: {
        baseUrl: (model, apiKey) => `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
        headers: () => ({
            'Content-Type': 'application/json'
        }),
        formatRequest: (model, prompt, profileData) => ({
            contents: [{
                parts: [{
                    text: `${prompt}\n\nProfile Data:\n${profileData.text}\nHas Profile Picture: ${profileData.hasProfilePic}`
                }]
            }],
            generationConfig: {
                temperature: 0.1,
                maxOutputTokens: 300
            }
        }),
        parseResponse: (response) => {
            const content = response.candidates[0].content.parts[0].text;
            return JSON.parse(content);
        }
    },
    anthropic: {
        baseUrl: 'https://api.anthropic.com/v1/messages',
        headers: (apiKey) => ({
            'x-api-key': apiKey,
            'Content-Type': 'application/json',
            'anthropic-version': '2023-06-01'
        }),
        formatRequest: (model, prompt, profileData) => ({
            model: model,
            max_tokens: 300,
            messages: [{
                role: 'user',
                content: `${prompt}\n\nProfile Data:\n${profileData.text}\nHas Profile Picture: ${profileData.hasProfilePic}`
            }]
        }),
        parseResponse: (response) => {
            const content = response.content[0].text;
            return JSON.parse(content);
        }
    }
};

// System prompt for LLM scoring
const SCORING_PROMPT = `You are an AI assistant that evaluates LinkedIn profiles based on a strict set of rules. Analyze the following profile text and return ONLY a JSON object with two keys: "totalScore" and "reasoning".

Scoring Rules:
- Base Score: 0
- Positive Keywords (+10): Add 10 if headline contains: 'Founder', 'VC', 'Investor', 'Angel', 'Entrepreneur', 'Stealth', or 'Building'.
- Negative Keywords (-10): Subtract 10 if headline contains: 'banker', 'realtor', or 'loan'.
- Industry (+5): Add 5 if headline suggests industries like 'Startup', 'Venture Capital', 'Computer Software', or 'Internet'.
- Location (+5): Add 5 if location is 'Bangalore', 'San Francisco', or 'San Francisco Bay Area'.
- Profile Picture (+1): Add 1 point if the user has a profile picture (this will be passed as a boolean).
- Education (+5): Add 5 if the headline explicitly mentions a globally recognized top-tier university (e.g., 'Stanford', 'MIT', 'CMU', 'IIT').

Calculate the sum and provide a brief justification in the 'reasoning' string.`;

// Message listener for handling requests from popup and content scripts
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.type === 'scoreProfile') {
        handleScoreProfile(request, sendResponse);
        return true; // Keep message channel open for async response
    } else if (request.type === 'testConnection') {
        handleTestConnection(request, sendResponse);
        return true; // Keep message channel open for async response
    }
});

/**
 * Handle profile scoring request from content script
 */
async function handleScoreProfile(request, sendResponse) {
    try {
        // Get saved settings
        const settings = await chrome.storage.sync.get(['modelProvider', 'modelSelection', 'apiKey']);
        
        if (!settings.modelProvider || !settings.modelSelection || !settings.apiKey) {
            sendResponse({
                success: false,
                error: 'Extension not configured. Please set up your API key in the popup.'
            });
            return;
        }
        
        // Make API call to score the profile
        const result = await callLLMAPI(
            settings.modelProvider,
            settings.modelSelection,
            settings.apiKey,
            request.profileData
        );
        
        sendResponse({
            success: true,
            score: result.totalScore,
            reasoning: result.reasoning
        });
        
    } catch (error) {
        console.error('Error scoring profile:', error);
        sendResponse({
            success: false,
            error: error.message || 'Failed to score profile'
        });
    }
}

/**
 * Handle connection test request from popup
 */
async function handleTestConnection(request, sendResponse) {
    try {
        // Create a simple test profile data
        const testProfileData = {
            text: "John Doe\nSoftware Engineer at Tech Company\nSan Francisco, CA\n5 mutual connections",
            hasProfilePic: true
        };
        
        // Test the API connection
        const result = await callLLMAPI(
            request.provider,
            request.model,
            request.apiKey,
            testProfileData
        );
        
        // If we get here, the connection worked
        sendResponse({
            success: true,
            message: 'Connection successful'
        });
        
    } catch (error) {
        console.error('Connection test failed:', error);
        sendResponse({
            success: false,
            error: error.message || 'Connection failed'
        });
    }
}

/**
 * Make API call to the specified LLM provider
 */
async function callLLMAPI(provider, model, apiKey, profileData) {
    const config = API_CONFIGS[provider];
    if (!config) {
        throw new Error(`Unsupported provider: ${provider}`);
    }
    
    try {
        // Prepare request
        const url = typeof config.baseUrl === 'function' 
            ? config.baseUrl(model, apiKey) 
            : config.baseUrl;
            
        const headers = config.headers(apiKey);
        const body = config.formatRequest(model, SCORING_PROMPT, profileData);
        
        // Make API request
        const response = await fetch(url, {
            method: 'POST',
            headers: headers,
            body: JSON.stringify(body)
        });
        
        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`API request failed (${response.status}): ${errorText}`);
        }
        
        const responseData = await response.json();
        
        // Parse response according to provider format
        const result = config.parseResponse(responseData);
        
        // Validate response format
        if (typeof result.totalScore !== 'number' || typeof result.reasoning !== 'string') {
            throw new Error('Invalid response format from LLM');
        }
        
        return result;
        
    } catch (error) {
        if (error.name === 'SyntaxError') {
            throw new Error('LLM returned invalid JSON response');
        }
        throw error;
    }
}

// Extension installation handler
chrome.runtime.onInstalled.addListener((details) => {
    if (details.reason === 'install') {
        console.log('LinkedIn Lead Scorer extension installed');
        // Open options page on install
        chrome.runtime.openOptionsPage();
    }
});

// Keep service worker alive
chrome.runtime.onStartup.addListener(() => {
    console.log('LinkedIn Lead Scorer service worker started');
});

