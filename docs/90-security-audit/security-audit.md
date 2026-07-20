Using Copilot’s Agent Mode or the /review command is an excellent way to perform a defensive architectural audit of your code. Because Copilot has access to your workspace context, it can trace how data flows from your API endpoints down to your Cloudflare storage and database configurations.
To get the best results, you want to instruct the model to act as a Principal Security Architect and give it a structured framework to look for specific anti-patterns, misconfigurations, and standard token-handling flaws.
Here is a comprehensive prompt you can copy, paste, and tweak for the Copilot Chat or Agent panel:
The Security Audit Prompt
Role: Act as a Principal Security Architect specializing in Cloudflare architectures (Workers, D1, R2) and modern web application security.
Task: Conduct a comprehensive, defensive security and architecture review of the current workspace. I want to ensure our session management, token handling, database interactions, and storage configurations follow industry best practices.
Focus Areas:
1. Session & API Token Logic: Examine how session tokens and API keys are generated, stored, validated, and expired. Check for proper cryptographic randomness, secure cookie attributes (HttpOnly, Secure, SameSite), token leakage in logs or URLs, and robust validation middleware.
2. API Endpoint Security: Review all API entry points. Ensure proper authentication/authorization checks are enforced consistently across all routes, and look for potential IDOR (Insecure Direct Object Reference) vulnerabilities or missing rate-limiting hooks.
3. Cloudflare D1 (SQLite) Interactions: Audit the data access layer. Ensure all SQL queries use proper parameterized bindings or type-safe ORM features to eliminate any risk of injection. Check for proper error handling that doesn't leak database schemas.
4. Cloudflare R2 Storage Settings: Review the R2 bucket interactions, binding configurations, and file upload/download logic. Verify that public access controls, signed URLs (presigned links), or custom domain access gates are implemented securely.
Output format:
Provide a structured report categorized by the focus areas above. For any areas of concern, explain the risk clearly and provide the exact, corrected code snippets or configuration patterns to remediate the issue defensively.
Tips for Running this Audit Successfully
• Use Agent Mode: If you run this in VS Code's Agent Mode, Copilot can actively open and read through your separate wrangler configuration files, database schema definitions, and middleware files sequentially to build a complete picture.
• Target Specific Directories: If your project is large, you can scope the query by referencing specific files or folders using the #file or #folder variables in the chat window (e.g., #folder:src/middleware or #file:wrangler.toml).
Would you like to refine this prompt to focus on a specific authentication strategy you are using, or are you looking to audit a specific framework's implementation?