There is no direct Wrangler command (like wrangler r2 info or wrangler r2 status) that returns a quick aggregate summary of a bucket's total byte size or total object count.
Wrangler’s native R2 toolset is designed for CRUD operations on buckets and individual files (wrangler r2 bucket create or wrangler r2 object put). Because of how Cloudflare's underlying storage architecture handles petabyte-scale data distribution across global regions, calculating total sizes via traditional CLI loops is intentionally separated from runtime commands.
However, since your ultimate goal is to pull these stats into your dashboard UI (like your Lumin project), you have a much better native option. Cloudflare exposes all R2 storage data via a GraphQL Analytics API, which updates asynchronously behind the scenes.
You can query this endpoint directly from your Cloudflare Worker using a simple fetch() payload, allowing your dashboard to display live Payload Size (Bytes), Metadata Size, and Object Count.
The Solution: Querying the GraphQL API from Your Worker
To supply data to your dashboard interface, you can add an admin route to your existing Cloudflare Worker. The Worker makes an authenticated POST request to Cloudflare's global API graph.
1. The GraphQL Payload Structure
Cloudflare registers metrics under the r2StorageAdaptiveGroups dataset. The request requests the max aggregate fields for your target bucket:
const query = `
  query R2StorageMetrics($accountID: String!, $bucketName: String!) {
    viewer {
      accounts(filter: { accountTag: $accountID }) {
        r2StorageAdaptiveGroups(
          limit: 1,
          filter: { bucketName: $bucketName },
          orderBy: [datetime_DESC]
        ) {
          max {
            objectCount
            payloadSize
            metadataSize
            uploadCount
          }
          dimensions {
            datetime
          }
        }
      }
    }
  }
`;

2. Implementing the Worker Endpoint Route
You can drop this logic straight into your Worker's router. It requires your Cloudflare Account ID and an API Token with Analytics:Read privileges stored securely in your .env variables:
interface Env {
    CF_ACCOUNT_ID: string;
    CF_ANALYTICS_TOKEN: string; // Inject via wrangler secrets
}

async function getBucketMetrics(bucketName: string, env: Env) {
    const response = await fetch("https://api.cloudflare.com/client/v4/graphql", {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${env.CF_ANALYTICS_TOKEN}`
        },
        body: JSON.stringify({
            query: query, // The query string from step 1
            variables: {
                accountID: env.CF_ACCOUNT_ID,
                bucketName: bucketName
            }
        })
    });

    const result: any = await response.json();
    
    // Extract the latest metrics array segment
    const metrics = result?.data?.viewer?.accounts[0]?.r2StorageAdaptiveGroups[0];
    
    if (!metrics) {
        throw new Error("Failed to resolve R2 metrics group.");
    }

    return {
        totalObjects: metrics.max.objectCount,
        storageBytes: metrics.max.payloadSize,
        metadataBytes: metrics.max.metadataSize,
        activeMultipartUploads: metrics.max.uploadCount,
        lastUpdated: metrics.dimensions.datetime
    };
}

Your dashboard UI can then make a standard fetch request down to /api/admin/metrics/r2 and display the integers cleanly inside your interface layout.
Alternative: The AWS-S3 CLI Fallback (Ad-hoc Terminal Inspection)
If you just want a quick diagnostic summary on your local system terminal or your Ubuntu server command-line stack without configuring code execution, you can bypass Wrangler entirely and target your R2 bucket endpoint via the standard AWS CLI.
Because R2 provides an exact S3-compatible API schema wrapper, you can run an ad-hoc recursive summary command:
1. Configure your local ~/.aws/credentials with your Cloudflare R2 Token Access Keys.
2. Run the s3 ls command with the --summarize and --recursive routing parameters, pointing specifically to your Cloudflare account endpoint:
aws s3 ls s3://your-lumin-bucket \
  --recursive \
  --human-readable \
  --summarize \
  --endpoint-url https://<your-cf-account-id>.r2.cloudflarestorage.com

Terminal Output:
2026-06-15 14:22:11    12.4 MiB path/to/attachment-1.pdf
2026-07-02 09:11:45     1.2 MiB images/photo-2.jpg
...
Total Objects: 1432
   Total Size: 4.8 GiB

Recommendation
For your long-term dashboard automation infrastructure, stick to the Worker GraphQL fetch route. It avoids forcing your server to sequentially download object listings to compute sizes manually, providing an instant, light performance payload explicitly designed for app telemetry tracking.