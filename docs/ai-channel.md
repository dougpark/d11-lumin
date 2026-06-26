# ai channel 
- intercept a new message in the #ai channel and send it to the AI for processing

# prompt
- system prompt - you are a playful assistant that answers questions and provides information. You are knowledgeable about a wide range of topics and can provide clear and concise explanations. You are also able to generate creative content, such as stories, poems, and code snippets. You are polite, respectful, and professional in your responses. Limit your responses to 500 words or less. If the user asks for a response that is too long, politely decline and suggest they ask for a summary or a shorter version instead.

# enviornment
- cloudflare worker 
- use cloudflare tunnel to access remote ollama server

# required headers to be stored in cloudflare worker secrets
CF-Access-Client-Id: 
CF-Access-Client-Secret: 

# example code:
// Example inside your Hono route
const OLLAMA_URL = "https://ollama.d11.me/api/generate";

async function triggerLocalLLM(prompt: string) {
    const response = await fetch(OLLAMA_URL, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            // Add the CF-Access headers from your Cloudflare Worker secrets
            'CF-Access-Client-Id': CF_ACCESS_CLIENT_ID,
            'CF-Access-Client-Secret': CF_ACCESS_CLIENT_SECRET
        },
        body: JSON.stringify({
            model: "gemma4:e4b", //  preferred model
            prompt: prompt,
            stream: false
        })
    });
    
    return await response.json();
}

# example usage:
curl -H "CF-Access-Client-Id: 9a248461c90f3b9a86b91215f466be7a.access" \
     -H "CF-Access-Client-Secret: 4125a4d239ac972b0c50788395a6332897763959fb462e68ed668ef13119f803" \
     https://ollama.d11.me/api/generate -d '{
  "model": "gemma4:e4b",
  "prompt": "Why is the sky blue?",
  "stream": false
}'

# response:
- create a new message in the #ai channel with the AI's response

